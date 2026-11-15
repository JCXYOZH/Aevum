# tools/web_search.py
"""
外部网页搜索与抓取工具 - 多后端支持，高可靠性
"""
import re
import time
import threading
import concurrent.futures
import urllib.parse
from typing import List, Dict, Optional

# 独立导入 requests，确保即使 BeautifulSoup 导入失败，requests 也能正常使用
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

HAS_DEPS = HAS_REQUESTS and HAS_BS4

# 禁用urllib3不安全HTTPS警告
if HAS_REQUESTS:
    try:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except Exception:
        pass
from .constants import *
from .session import *
from .redirects import *


def web_search(query: str, max_results: int = 8, backend: str = "auto") -> List[Dict]:
    if not HAS_DEPS:
        return [{"error": "缺少 requests 或 beautifulsoup4 依赖"}]
    backends = []
    if backend == "auto":
        # 优先使用用户选择的搜索引擎，然后依次回退
        primary = SEARCH_BACKENDS.get(_current_search_engine, _search_bing)
        fallback_order = [primary]
        for fn in [_search_bing, _search_ddg_html, _search_mojeek, _search_google,
                   _search_duckduckgo, _search_qwant, _search_yahoo,
                   _search_brave, _search_ecosia, _search_startpage, _search_yandex,
                   _search_baidu,  # 百度放最后：中文拆词问题严重
                   _search_wikipedia]:
            if fn not in fallback_order:
                fallback_order.append(fn)
        backends = fallback_order
    elif backend in SEARCH_BACKENDS:
        backends = [SEARCH_BACKENDS[backend]]
    else:
        backends = [_search_bing, _search_duckduckgo, _search_wikipedia]

    # 总时间预算5秒，最多尝试3个后端，防止逐个超时导致卡死
    import time as _time
    _t_start = _time.time()
    _TIME_BUDGET = 5.0
    _MAX_ATTEMPTS = 3
    errors = []
    for idx, search_fn in enumerate(backends[:_MAX_ATTEMPTS]):
        _elapsed = _time.time() - _t_start
        if _elapsed >= _TIME_BUDGET:
            errors.append(f"{search_fn.__name__}: 时间预算耗尽")
            break
        try:
            results = search_fn(query, max_results)
            if results:
                return results
        except Exception as e:
            errors.append(f"{search_fn.__name__}: {e}")
            continue
    if errors:
        return [{"error": f"搜索超时或失败（已尝试{min(len(backends), _MAX_ATTEMPTS)}个引擎，耗时{_time.time()-_t_start:.1f}s）"}]
    return [{"error": "未找到结果"}]

def _extract_text(soup) -> str:
    """从 BeautifulSoup 对象中提取正文，多种策略回退"""
    # 策略1: 语义化标签
    for selector in ["article", "main", "[role=main]", ".post-content", ".article-content",
                     ".entry-content", "#content", ".content", "#main", ".main"]:
        el = soup.select_one(selector)
        if el and len(el.get_text(strip=True)) > 100:
            return el.get_text(separator="\n", strip=True)
    # 策略2: 找最长的 div
    all_divs = soup.find_all(["div", "section", "td"])
    best = None
    best_len = 0
    for d in all_divs:
        t = d.get_text(strip=True)
        if len(t) > best_len:
            best_len = len(t)
            best = d
    if best and best_len > 50:
        return best.get_text(separator="\n", strip=True)
    # 策略3: 全部文本
    return soup.get_text(separator="\n", strip=True)

def fetch_page_content(url: str, max_chars: int = 5000, timeout: int = 20) -> Dict:
    """抓取网页正文，带多策略重试和反检测。
    策略：
    1. 多浏览器引擎轮换（Chrome → Firefox → Safari → Edge）
    2. Session保持cookies
    3. 完整浏览器头（Referer、Sec-Fetch-*等）
    4. Wayback Machine回退
    5. Google Cache回退

    timeout 是整个函数的墙钟预算：首页预热、各引擎/SSL 组合、以及全部回退策略
    都按剩余预算收敛，抓不到页面时也不会把各段固定超时串起来拖死调用方。
    """
    if not HAS_DEPS:
        return {"error": "缺少依赖"}
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    from .web_engine import _MIN_TIMEOUT, _split_timeout

    _deadline = time.time() + max(1.0, float(timeout))

    def _left() -> float:
        return _deadline - time.time()

    def _has_budget(margin: float = _MIN_TIMEOUT) -> bool:
        return _left() > margin

    def _sleep(seconds: float) -> None:
        pause = min(seconds, max(0.0, _left()))
        if pause > 0:
            time.sleep(pause)

    # ===== 优先使用无头浏览器（真正打开页面、等JS渲染完成） =====
    pw_result = None
    try:
        from .web_engine import fetch_with_playwright
        if _has_budget():
            pw_result = fetch_with_playwright(url, timeout=int(max(1.0, _left()) * 1000),
                                              wait_until="networkidle", deadline=_deadline)
        if pw_result and pw_result.get("content") and len(pw_result["content"].strip()) >= 50:
            text = pw_result["content"]
            truncated = len(text) > max_chars
            if truncated:
                text = text[:max_chars] + "..."
            return {"title": pw_result.get("title", url), "url": url, "content": text,
                    "status": pw_result.get("status", 200), "truncated": truncated,
                    "content_length": len(text), "engine": "playwright",
                    "source": "Playwright真实浏览器（JS渲染完成）"}
    except Exception:
        pass

    engines_to_try = ["chrome", "firefox"]
    last_err = None
    parsed = urllib.parse.urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    # SSL容错：创建自定义SSL上下文
    import ssl as _ssl_mod
    _ssl_ctx = _ssl_mod.create_default_context()
    _ssl_ctx.check_hostname = False
    _ssl_ctx.verify_mode = _ssl_mod.CERT_NONE
    # 尝试兼容旧TLS
    _ssl_ctx.minimum_version = _ssl_mod.TLSVersion.TLSv1_2
    _ssl_legacy_ctx = _ssl_mod.create_default_context()
    _ssl_legacy_ctx.check_hostname = False
    _ssl_legacy_ctx.verify_mode = _ssl_mod.CERT_NONE
    try:
        _ssl_legacy_ctx.minimum_version = _ssl_mod.TLSVersion.TLSv1
    except Exception:
        pass
    _ssl_ctxs = [None, _ssl_ctx]  # None=默认验证，然后宽松

    for engine in engines_to_try:
        if not _has_budget():
            break
        for _ssl_try_ctx in _ssl_ctxs:
            if not _has_budget():
                break
            try:
                session = requests.Session()
                headers = get_browser_headers(engine)
                headers["Referer"] = origin
                headers["Sec-Fetch-User"] = "?1"
                headers["DNT"] = "1"
                session.headers.update(headers)
                _req_verify = _ssl_try_ctx is None
                _req_proxies = _get_proxies()
                # 先访问首页获取cookies
                try:
                    session.get(origin, timeout=_split_timeout(5, 8, _left()),
                                allow_redirects=True, proxies=_req_proxies, verify=_req_verify)
                    _sleep(0.3)
                except Exception:
                    pass
                if not _has_budget():
                    break
                resp = session.get(url, timeout=_split_timeout(8, timeout, _left()),
                                   allow_redirects=True, proxies=_req_proxies, verify=_req_verify)
                if resp.status_code in (403, 429, 503, 567):
                    last_err = f"HTTP {resp.status_code}（网站反爬拦截，已尝试{engine}引擎）"
                    continue
                if resp.status_code == 404:
                    last_err = "HTTP 404（页面不存在）"
                    continue
                resp.raise_for_status()
                content_type = resp.headers.get("Content-Type", "")
                if isinstance(content_type, bytes):
                    content_type = content_type.decode('utf-8', errors='replace')

                # ===== 响应体处理：解压 + 编码转换 + Base64解码 =====
                try:
                    from libertas.foundation.byte_stream import ResponseProcessor
                    _processor = ResponseProcessor(extract_text=False)
                    _resp_headers = dict(resp.headers)
                    _proc_result = _processor.process(resp.content, _resp_headers, url)
                    if _proc_result.content:
                        resp_text = _proc_result.content
                        resp_encoding = _proc_result.encoding
                    else:
                        resp_text = resp.text
                        resp_encoding = resp.encoding
                except Exception:
                    resp_text = resp.text
                    resp_encoding = resp.encoding

                # 非HTML内容
                if "text/html" not in content_type and "application/xhtml" not in content_type:
                    if "application/json" in content_type:
                        return {"title": url, "url": url, "content": resp_text[:max_chars],
                                "status": resp.status_code, "content_type": content_type}
                    if "text/" in content_type:
                        return {"title": url, "url": url, "content": resp_text[:max_chars],
                                "status": resp.status_code, "content_type": content_type}
                    return {"title": url, "url": url,
                            "content": f"[二进制内容: {content_type}, {len(resp.content)} 字节]",
                            "status": resp.status_code, "content_type": content_type}
                # 编码修复
                if resp_encoding and resp_encoding.lower() in ("iso-8859-1", "ascii"):
                    resp_encoding = resp.apparent_encoding or "utf-8"
                soup = BeautifulSoup(resp_text, "html.parser")
                for tag in soup(["script", "style", "nav", "footer", "header", "aside",
                                 "iframe", "noscript", "form", "button", "svg", "img"]):
                    tag.decompose()
                title = soup.title.get_text(strip=True) if soup.title else url
                text = _extract_text(soup)
                lines = [line.strip() for line in text.splitlines() if line.strip()]
                text = "\n".join(lines)
                text = re.sub(r'\n{3,}', '\n\n', text)
                if len(text.strip()) < 50:
                    last_err = f"页面内容过少（{len(text.strip())}字符），可能是反爬页面"
                    continue
                truncated = len(text) > max_chars
                if truncated:
                    text = text[:max_chars] + "..."
                return {"title": title, "url": resp.url, "content": text,
                        "status": resp.status_code, "truncated": truncated,
                        "content_length": len(text), "engine": engine}
            except requests.exceptions.Timeout:
                last_err = "连接超时（网站响应太慢）"
                break  # 超时不需要再试SSL
            except requests.exceptions.SSLError:
                last_err = "SSL握手失败，尝试宽松SSL..."
                continue  # 尝试下一个SSL上下文
            except requests.exceptions.ConnectionError:
                last_err = "无法连接到该网站（可能被墙或已下线）"
                break  # 连接失败不需要再试SSL
            except requests.exceptions.HTTPError as e:
                code = e.response.status_code if e.response is not None else "?"
                last_err = f"HTTP {code} 错误（网站拒绝访问）"
                if code in (403, 429, 503, 567):
                    continue  # 反爬，尝试下一个引擎
                break
            except Exception as e:
                last_err = str(e)
                continue
        _sleep(0.3)

    # 回退策略0: Playwright真实浏览器（能过反爬、执行JS）
    try:
        from .web_engine import fetch_with_playwright
        pw_result = None
        if _has_budget():
            pw_result = fetch_with_playwright(url, timeout=int(max(1.0, _left()) * 1000),
                                              deadline=_deadline)
        if pw_result and pw_result.get("content") and len(pw_result["content"].strip()) >= 50:
            text = pw_result["content"]
            truncated = len(text) > max_chars
            if truncated:
                text = text[:max_chars] + "..."
            return {"title": pw_result.get("title", url), "url": url, "content": text,
                    "status": 200, "truncated": truncated,
                    "content_length": len(text), "source": "Playwright浏览器"}
    except Exception:
        pass

    # 回退策略1: Wayback Machine
    try:
        wb_url = f"https://web.archive.org/web/2024/{url}"
        resp = None
        if _has_budget():
            resp = _safe_get(wb_url, headers=get_browser_headers("chrome"),
                             timeout=_split_timeout(5, 15, _left()))
        if resp is not None and resp.status_code == 200 and len(resp.text) > 500:
            if resp.encoding and resp.encoding.lower() in ("iso-8859-1", "ascii"):
                resp.encoding = resp.apparent_encoding or "utf-8"
            soup = BeautifulSoup(resp.text, "html.parser")
            for tag in soup(["script", "style", "nav", "footer", "header", "aside",
                             "iframe", "noscript", "form", "button", "svg", "img",
                             "div#wm-ipp-base", "div#wm-ipp-print"]):
                tag.decompose()
            title = soup.title.get_text(strip=True) if soup.title else url
            title = re.sub(r'^Web Archive.*?-\s*', '', title) or title
            text = _extract_text(soup)
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            text = "\n".join(lines)
            text = re.sub(r'\n{3,}', '\n\n', text)
            if len(text.strip()) >= 50:
                truncated = len(text) > max_chars
                if truncated:
                    text = text[:max_chars] + "..."
                return {"title": title, "url": url, "content": text,
                        "status": 200, "truncated": truncated,
                        "content_length": len(text), "source": "Wayback Machine"}
    except Exception:
        pass

    # 回退策略2: 通过本地代理服务器抓取（代理有重写和反反爬能力）
    try:
        proxy_url = f"http://127.0.0.1:8080/api/proxy?url={urllib.parse.quote(url, safe='')}"
        resp = None
        if _has_budget():
            resp = requests.get(proxy_url, timeout=_split_timeout(5, 15, _left()),
                                proxies={"http": None, "https": None})
        if resp is not None and resp.status_code == 200 and len(resp.text) > 500:
            if resp.encoding and resp.encoding.lower() in ("iso-8859-1", "ascii"):
                resp.encoding = resp.apparent_encoding or "utf-8"
            soup = BeautifulSoup(resp.text, "html.parser")
            for tag in soup(["script", "style", "nav", "footer", "header", "aside",
                             "iframe", "noscript", "form", "button", "svg", "img"]):
                tag.decompose()
            title = soup.title.get_text(strip=True) if soup.title else url
            text = _extract_text(soup)
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            text = "\n".join(lines)
            text = re.sub(r'\n{3,}', '\n\n', text)
            if len(text.strip()) >= 50:
                truncated = len(text) > max_chars
                if truncated:
                    text = text[:max_chars] + "..."
                return {"title": title, "url": url, "content": text,
                        "status": 200, "truncated": truncated,
                        "content_length": len(text), "source": "本地代理"}
    except Exception:
        pass

    # 回退策略3: 公共CORS代理（用于本地无法直连的网站）
    cors_proxies = [
        ("https://api.allorigins.win/raw?url=", "allorigins"),
        ("https://corsproxy.io/?", "corsproxy.io"),
        ("https://api.codetabs.com/v1/proxy/?quest=", "codetabs"),
    ]
    for cors_base, cors_name in cors_proxies:
        if not _has_budget():
            break
        try:
            cors_url = cors_base + urllib.parse.quote(url, safe='')
            resp = _safe_get(cors_url, headers=get_browser_headers("chrome"),
                             timeout=_split_timeout(4, 12, _left()))
            if resp.status_code == 200 and len(resp.text) > 200:
                if resp.encoding and resp.encoding.lower() in ("iso-8859-1", "ascii"):
                    resp.encoding = resp.apparent_encoding or "utf-8"
                soup = BeautifulSoup(resp.text, "html.parser")
                for tag in soup(["script", "style", "nav", "footer", "header", "aside",
                                 "iframe", "noscript", "form", "button", "svg", "img"]):
                    tag.decompose()
                title = soup.title.get_text(strip=True) if soup.title else url
                text = _extract_text(soup)
                lines = [line.strip() for line in text.splitlines() if line.strip()]
                text = "\n".join(lines)
                text = re.sub(r'\n{3,}', '\n\n', text)
                if len(text.strip()) >= 50:
                    truncated = len(text) > max_chars
                    if truncated:
                        text = text[:max_chars] + "..."
                    return {"title": title, "url": url, "content": text,
                            "status": 200, "truncated": truncated,
                            "content_length": len(text), "source": f"CORS代理({cors_name})"}
        except Exception:
            continue

    # 回退策略4: Google Cache
    try:
        gc_url = f"https://webcache.googleusercontent.com/search?q=cache:{url}"
        resp = None
        if _has_budget():
            resp = _safe_get(gc_url, headers=get_browser_headers("chrome"),
                             timeout=_split_timeout(4, 10, _left()))
        if resp is not None and resp.status_code == 200 and len(resp.text) > 200:
            soup = BeautifulSoup(resp.text, "html.parser")
            for tag in soup(["script", "style", "nav", "footer", "header", "aside",
                             "iframe", "noscript", "form", "button", "svg", "img"]):
                tag.decompose()
            title = soup.title.get_text(strip=True) if soup.title else url
            text = _extract_text(soup)
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            text = "\n".join(lines)
            text = re.sub(r'\n{3,}', '\n\n', text)
            if len(text.strip()) >= 50:
                truncated = len(text) > max_chars
                if truncated:
                    text = text[:max_chars] + "..."
                return {"title": title, "url": url, "content": text,
                        "status": 200, "truncated": truncated,
                        "content_length": len(text), "source": "Google Cache"}
    except Exception:
        pass

    if last_err is None:
        last_err = f"抓取超时（时间预算 {timeout}s 已用尽）"
    return {"title": url, "url": url, "content": "", "error": last_err}
