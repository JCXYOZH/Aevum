"""
web_engine.py — 本地 Web 访问引擎（控制平面）

职责：
- 在模型调用之前完成所有网络访问（搜索、抓取）
- 模型只拿到结果，不参与"是否搜索"的决策
- 多层抓取策略：Playwright 真实浏览器 → requests 多引擎轮换 → Wayback Machine → 本地代理
- 永不返回空：即使所有页面抓取失败，也返回标题+摘要
- 进度回调：每个步骤都通知前端
- 结果缓存：避免重复搜索
"""

import os
import re
import json
import time
import hashlib
import logging
import urllib.parse
from typing import List, Dict, Optional, Callable

logger = logging.getLogger(__name__)

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

# Playwright 可选
try:
    from playwright.sync_api import sync_playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

from ..web_search import (
    web_search, fetch_page_content, search_and_summarize,
    get_browser_headers, set_browser_engine, set_search_engine,
    BROWSER_PRESETS, SEARCH_ENGINES, SEARCH_BACKENDS
)
from .constants import *
from .budget import *
from .cache import *


def robust_fetch_html(url: str, timeout: int = 20, session=None) -> Optional[Dict]:
    """多层策略抓取网页完整HTML（供代理iframe显示）。
    策略顺序：requests多引擎+SSL容错（快）→ Playwright真实浏览器（慢但能过反爬）
    → HTTP回退 → CORS代理 → Wayback。
    总时间预算不超过 timeout 秒。
    session: 可选的requests.Session，用于cookie持久化。
    返回 {"title","url","html","status","source"} 或 None。"""
    import requests as _req
    import ssl as _ssl_mod
    from urllib.parse import quote as _quote
    # 禁用InsecureRequestWarning
    try:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except Exception:
        pass

    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    _start_time = time.time()
    _deadline = _start_time + max(1.0, float(timeout))

    def _elapsed():
        return time.time() - _start_time
    def _remaining(default=5):
        r = timeout - _elapsed()
        return max(_MIN_TIMEOUT, min(r, default))
    def _has_budget(margin=0.0):
        """是否还有可用预算（margin 为本策略至少需要的余量）。"""
        return (timeout - _elapsed()) > margin

    headers_pool = []
    try:
        from .web_search import get_browser_headers
        for eng in ["chrome", "firefox", "safari", "edge", "mobile_chrome"]:
            headers_pool.append(get_browser_headers(eng))
    except Exception:
        headers_pool.append({
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        })

    no_proxy = {"http": None, "https": None}

    def _try_requests(target_url, connect_timeout=3, read_timeout=6):
        """用requests多引擎+SSL容错尝试抓取。
        返回 (result_dict_or_None, connection_failed_bool)"""
        _getter = session.get if session is not None else _req.get
        attempts = [
            (headers_pool[0], True),
            (headers_pool[1] if len(headers_pool) > 1 else headers_pool[0], False),
        ]
        _conn_failed = False
        for hdrs, verify in attempts:
            if _elapsed() > timeout - 2:
                return None, _conn_failed
            try:
                resp = _getter(
                    target_url, headers=hdrs,
                    timeout=_split_timeout(connect_timeout, read_timeout,
                                           max(0.0, timeout - _elapsed())),
                    allow_redirects=True, proxies=no_proxy, verify=verify,
                    stream=False
                )
                if resp.status_code in (403, 429, 503, 567):
                    continue
                if resp.status_code == 404:
                    return None, False
                if resp.status_code >= 500:
                    continue
                resp.raise_for_status()
                ct = resp.headers.get("Content-Type", "")
                if isinstance(ct, bytes):
                    ct = ct.decode('utf-8', errors='replace')
                if "text/html" in ct or "application/xhtml" in ct or not ct:
                    if resp.encoding and resp.encoding.lower() in ("iso-8859-1", "ascii"):
                        resp.encoding = resp.apparent_encoding or "utf-8"
                    html = resp.text
                    if html and len(html) > 200:
                        title = ""
                        try:
                            from bs4 import BeautifulSoup as _Bs
                            _s = _Bs(html, "html.parser")
                            if _s.title:
                                title = _s.title.get_text(strip=True)
                        except Exception:
                            pass
                        # 检测软404/错误页（HTTP 200但内容是错误页）
                        _combined = (title + " " + html[:2000]).lower()
                        _error_markers = ["404", "not found", "页面不存在", "页面已被删除",
                                          "访问的页面", "oops", "页面走丢了", "找不到页面",
                                          "页面无法找到", "该页面已", "链接可能已损坏"]
                        _is_error_page = any(m in _combined for m in _error_markers)
                        if _is_error_page and len(html) < 5000:
                            # 疑似错误页，不返回，让后续策略尝试
                            continue
                        return {"title": title or target_url, "url": resp.url,
                                "html": html, "status": resp.status_code, "source": "requests"}, False
                elif "text/" in ct or "json" in ct:
                    return {"title": target_url, "url": resp.url,
                            "html": f"<html><body><pre>{resp.text[:50000]}</pre></body></html>",
                            "status": resp.status_code, "source": "requests"}, False
            except _req.exceptions.SSLError:
                continue
            except _req.exceptions.Timeout:
                break
            except _req.exceptions.ConnectionError:
                _conn_failed = True
                return None, True
            except Exception:
                continue
        return None, _conn_failed

    # 检测session中是否有反爬cookie（cf_clearance等绑定TLS指纹，requests的TLS指纹不匹配会403）
    _has_antibot_cookie = False
    if session is not None:
        _antibot_names = ('cf_clearance', 'cf_chl_rc', 'cf_use_ob', '__cf_bm',
                          'incap_ses', 'visid_incap', 'nlbi_', 'ASP.NET_SessionId',
                          'JSESSIONID', 'ph_phs', 'Akamai-Edge')
        try:
            for _ck in session.cookies:
                if any(_ck.name.startswith(_n) or _ck.name == _n for _n in _antibot_names):
                    if _ck.name in ('cf_clearance',) or _ck.name.startswith(('incap_ses', 'visid_incap', 'nlbi_')):
                        _has_antibot_cookie = True
                        break
        except Exception:
            pass

    # 策略1: requests多引擎+SSL容错（快，通常1-3秒）
    _requests_conn_failed = False
    if not _has_antibot_cookie and _elapsed() < timeout - 3:
        result, _requests_conn_failed = _try_requests(url, connect_timeout=2, read_timeout=5)
        if result:
            return result

    # 策略2: Playwright真实浏览器（慢，但能过反爬和执行JS）
    # 仅在requests不是连接失败时尝试（连接失败时Playwright也连不上）
    if HAS_PLAYWRIGHT and not _requests_conn_failed and _has_budget(5):
        try:
            pw_timeout = min(_remaining(10), 10)
            # 把session cookie传给Playwright（cf_clearance绑定TLS指纹，requests的TLS指纹不匹配会403）
            _sess_cookies = list(session.cookies) if session is not None else None
            _sess_ua = None
            if session is not None:
                _sess_ua = session.headers.get('User-Agent', '')
            result = fetch_html_with_playwright(url, timeout=int(pw_timeout * 1000),
                                                cookies=_sess_cookies, user_agent=_sess_ua,
                                                deadline=_deadline)
            if result and result.get("html") and len(result["html"]) > 200:
                # Playwright返回的cookie回写到session
                if session is not None and result.get("cookies"):
                    try:
                        for _pwck in result["cookies"]:
                            session.cookies.set(
                                _pwck.get("name", ""), _pwck.get("value", ""),
                                domain=_pwck.get("domain", ""), path=_pwck.get("path", "/")
                            )
                    except Exception:
                        pass
                return result
        except Exception:
            pass

    # 策略3: HTTP回退（HTTPS连接失败时）
    if url.startswith("https://") and _has_budget(3):
        http_url = "http://" + url[8:]
        result, _ = _try_requests(http_url, connect_timeout=2, read_timeout=4)
        if result:
            result["url"] = url
            return result

    # 策略4: CORS公共代理（本地无法直连的网站）
    if _has_budget(3):
        for cors_base in ["https://api.allorigins.win/raw?url=",
                          "https://api.codetabs.com/v1/proxy/?quest="]:
            if not _has_budget(2):
                break
            try:
                cors_url = cors_base + _quote(url, safe="")
                resp = _req.get(cors_url, headers=headers_pool[0],
                               timeout=_within_timeout(8, max(0.0, timeout - _elapsed())),
                               allow_redirects=True, proxies=no_proxy)
                if resp.status_code == 200 and len(resp.text) > 200:
                    if resp.encoding and resp.encoding.lower() in ("iso-8859-1", "ascii"):
                        resp.encoding = resp.apparent_encoding or "utf-8"
                    return {"title": url, "url": url, "html": resp.text,
                            "status": 200, "source": f"cors"}
            except Exception:
                continue

    # 策略5: Wayback Machine
    if _has_budget(2):
        try:
            wb_url = f"https://web.archive.org/web/2024/{url}"
            resp = _req.get(wb_url, headers=headers_pool[0],
                           timeout=_within_timeout(8, max(0.0, timeout - _elapsed())),
                           allow_redirects=True, proxies=no_proxy)
            if resp.status_code == 200 and len(resp.text) > 500:
                if resp.encoding and resp.encoding.lower() in ("iso-8859-1", "ascii"):
                    resp.encoding = resp.apparent_encoding or "utf-8"
                return {"title": url, "url": url, "html": resp.text,
                        "status": 200, "source": "wayback"}
        except Exception:
            pass

    return None

def robust_fetch(url: str, max_chars: int = 5000, timeout: int = 20,
                 progress_cb: Optional[Callable] = None) -> Dict:
    """
    统一网页抓取接口，多层策略，永不返回空。

    策略顺序：
    1. Playwright 真实浏览器（能过反爬）
    2. requests 多引擎轮换（5种浏览器UA）
    3. Wayback Machine 缓存
    4. 本地 Flask 代理
    5. 只返回URL（最外层会有搜索摘要补充）

    总时间预算不超过 timeout 秒：每个策略进入前先判剩余预算，不足即跳过，
    避免"抓不到页面时把各层固定超时串起来"导致界面长时间无响应。
    """
    def _notify(step, **kw):
        if progress_cb:
            try:
                progress_cb(step, **kw)
            except Exception:
                pass

    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    _deadline = time.time() + max(1.0, float(timeout))

    def _left() -> float:
        return _deadline - time.time()

    def _has_budget() -> bool:
        return _left() >= _MIN_STRATEGY_BUDGET

    _notify("fetch_start", url=url)
    result = {"title": url, "url": url, "content": "", "error": "抓取失败"}

    # 策略1: Playwright
    if HAS_PLAYWRIGHT and _has_budget():
        _notify("fetching_page", url=url, method="playwright")
        try:
            _pw_result = fetch_with_playwright(url, timeout=int(max(1.0, _left()) * 1000),
                                               deadline=_deadline)
        except Exception as e:
            logger.debug(f"Playwright 抓取失败: {e}")
            _pw_result = None
        if _pw_result and _pw_result.get("content") and len(_pw_result["content"].strip()) >= 50:
            result = _pw_result
            text = result["content"]
            if isinstance(text, bytes):
                text = text.decode('utf-8', errors='replace')
            if len(text) > max_chars:
                text = text[:max_chars] + "..."
            result["content"] = text
            _notify("page_fetched", url=url, title=result.get("title", ""),
                    chars=len(text), method="playwright")
            return result

    # 策略2: requests 多引擎（fetch_page_content 已有5引擎轮换+Wayback+代理）
    if _has_budget():
        _notify("fetching_page", url=url, method="requests")
        try:
            result = fetch_page_content(url, max_chars=max_chars,
                                        timeout=max(2, int(_left())))
        except Exception as e:
            logger.debug(f"requests 抓取失败: {e}")
            result = {"title": url, "url": url, "content": "", "error": f"抓取失败: {e}"}
        if result.get("content") and len(result["content"].strip()) >= 50:
            # 防御：确保 content 是 str
            if isinstance(result["content"], bytes):
                result["content"] = result["content"].decode('utf-8', errors='replace')
            _notify("page_fetched", url=url, title=result.get("title", ""),
                    chars=len(result["content"]), method=result.get("source", "requests"))
            return result

    # 策略3: 尝试 HTTP（如果原URL是HTTPS）
    if url.startswith("https://") and _has_budget():
        http_url = "http://" + url[8:]
        _notify("fetching_page", url=http_url, method="http_fallback")
        try:
            result = fetch_page_content(http_url, max_chars=max_chars,
                                        timeout=max(2, int(_left())))
        except Exception as e:
            logger.debug(f"HTTP 回退抓取失败: {e}")
            result = {"title": url, "url": url, "content": "", "error": f"抓取失败: {e}"}
        if result.get("content") and len(result["content"].strip()) >= 50:
            result["url"] = url
            _notify("page_fetched", url=url, title=result.get("title", ""),
                    chars=len(result["content"]), method="http_fallback")
            return result

    # 策略4: 增强抓取（curl HTTP/2 + httpx H2 + 文本代理 + 缓存 + 原始socket）
    # enhanced_fetch 现在自身就按调用方 deadline 收敛（内部的 curl/httpx/文本代理/
    # 缓存/原始socket 都取剩余预算），因此这里直接调用即可。原来用守护线程
    # _call_within_budget 从外部兜预算，超时后会留下"被放弃的线程继续运行并在本函数
    # 返回之后回调 progress_cb"的副作用，现已不需要。
    if _left() >= _ENHANCED_MIN_BUDGET:
        _notify("fetching_page", url=url, method="enhanced")
        _enhanced = None
        try:
            from .content_fetcher import enhanced_fetch
            _enhanced = enhanced_fetch(
                url, max_chars=max_chars,
                timeout=max(1, min(int(_left()), 15)), progress_cb=progress_cb)
        except Exception as e:
            logger.debug(f"增强抓取不可用: {e}")
        if _enhanced and _enhanced.get("content") and len(_enhanced["content"].strip()) >= 50:
            result = _enhanced
            _notify("page_fetched", url=url, title=result.get("title", ""),
                    chars=len(result["content"]), method=result.get("source", "enhanced"))
            return result

    _notify("page_error", url=url, error=result.get("error", "所有抓取策略均失败"))
    return {"title": url, "url": url, "content": "", "error": result.get("error", "抓取失败")}
