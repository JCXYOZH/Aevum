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


def _get_browser():
    """获取或复用 Playwright 浏览器实例

    Playwright sync API 基于 greenlet，绑定到首次创建它的线程。
    如果从其他线程访问，必须关闭旧实例并在当前线程重新创建。
    """
    global _playwright_instance, _playwright_browser, _playwright_owner_thread
    if not HAS_PLAYWRIGHT:
        return None
    current_thread = _threading_mod.current_thread()
    try:
        if _playwright_browser is not None:
            # 检查浏览器是否还活着且属于当前线程
            if _playwright_owner_thread is not current_thread:
                # 跨线程访问，关闭旧实例在当前线程重建
                _cleanup_browser()
            else:
                try:
                    _playwright_browser.version
                    return _playwright_browser
                except Exception:
                    _cleanup_browser()
        _playwright_instance = sync_playwright().start()
        _playwright_browser = _playwright_instance.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-extensions",
                "--disable-blink-features=AutomationControlled",
            ]
        )
        _playwright_owner_thread = current_thread
        return _playwright_browser
    except Exception as e:
        logger.warning(f"Playwright 浏览器启动失败: {e}")
        _cleanup_browser()
        return None

def _cleanup_browser():
    """清理浏览器实例"""
    global _playwright_instance, _playwright_browser, _playwright_owner_thread
    try:
        if _playwright_browser:
            _playwright_browser.close()
    except Exception:
        pass
    try:
        if _playwright_instance:
            _playwright_instance.stop()
    except Exception:
        pass
    _playwright_browser = None
    _playwright_instance = None
    _playwright_owner_thread = None

def fetch_with_playwright(url: str, timeout: int = 20000, wait_until: str = "domcontentloaded",
                          intercept_api: bool = True, deadline: Optional[float] = None) -> Optional[Dict]:
    """使用 Playwright 真实浏览器渲染页面，能过大部分反爬
    intercept_api: 拦截XHR/fetch请求，从API响应中提取数据（过数据层）
    deadline: 可选的绝对截止时间戳（time.time() 基准）。传入后，取锁等待与页面
              内部的固定等待都会收敛到剩余预算内，保证整体不超调用方预算。"""
    if not HAS_PLAYWRIGHT:
        return None
    if deadline is not None and _remaining_budget(deadline) <= 0:
        logger.debug(f"Playwright 预算已耗尽，跳过: {url}")
        return None
    # Playwright sync API 不支持跨线程，加锁串行化
    _lock_wait = 30 if deadline is None else max(1.0, _remaining_budget(deadline))
    if not _playwright_global_lock.acquire(timeout=_lock_wait):
        logger.warning("Playwright 忙，跳过")
        return None
    try:
        return _fetch_with_playwright_impl(url, timeout, wait_until, intercept_api, deadline)
    finally:
        _playwright_global_lock.release()

def _fetch_with_playwright_impl(url: str, timeout: int = 20000, wait_until: str = "domcontentloaded",
                                intercept_api: bool = True, deadline: Optional[float] = None) -> Optional[Dict]:
    """Playwright 抓取实现（调用方必须持有 _playwright_global_lock）
    intercept_api: 拦截XHR/fetch请求，从API响应中提取数据（过数据层）
    deadline: 可选的绝对截止时间戳；内部固定等待按剩余预算收敛。"""
    browser = _get_browser()
    if browser is None:
        return None
    page = None
    try:
        # 使用经过验证的反检测UA
        _ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        context = browser.new_context(
            user_agent=_ua,
            viewport={"width": 1920, "height": 1080},
            locale="zh-CN",
            color_scheme="light",
            extra_http_headers={
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            }
        )
        # 反自动化检测
        context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
            Object.defineProperty(navigator, 'languages', {get: () => ['zh-CN', 'zh']});
            window.chrome = { runtime: {} };
        """)
        page = context.new_page()

        # ===== API请求拦截（过数据层） =====
        api_requests = []
        if intercept_api:
            def _on_request(request):
                try:
                    if request.resource_type in ("xhr", "fetch"):
                        api_requests.append({
                            "url": request.url,
                            "method": request.method,
                            "headers": dict(request.headers),
                            "post_data": request.post_data,
                            "resource_type": request.resource_type,
                        })
                except Exception:
                    pass
            def _on_response(response):
                try:
                    if response.request.resource_type in ("xhr", "fetch"):
                        for req in api_requests:
                            if req["url"] == response.url and "response_status" not in req:
                                req["response_status"] = response.status
                                req["response_headers"] = dict(response.headers)
                                try:
                                    ct = response.headers.get("content-type", "")
                                    if "json" in ct or "javascript" in ct:
                                        body = response.text()
                                        if body and len(body) < 500000:
                                            req["response_body"] = body
                                except Exception:
                                    pass
                                break
                except Exception:
                    pass
            page.on("request", _on_request)
            page.on("response", _on_response)

        resp = page.goto(url, timeout=_within_timeout_ms(timeout, deadline),
                         wait_until="domcontentloaded")
        if resp is None:
            return None
        # 等待JS渲染和反爬挑战（不阻塞资源加载，某些网站JS依赖资源事件）
        _within_sleep(3.0, deadline)
        # 额外等待API请求完成
        if intercept_api and api_requests:
            try:
                page.wait_for_load_state("networkidle",
                                         timeout=_within_timeout_ms(5000, deadline))
            except Exception:
                pass
            _within_sleep(1.0, deadline)
        title = page.title()
        html = page.content()
        context.close()
        if not html or len(html) < 200:
            return None
        # 检测是否被拦截
        if HAS_BS4:
            soup = BeautifulSoup(html, "html.parser")
            body_text = soup.get_text(strip=True)
            block_keywords = ["请求已被拦截", "访问被拒绝", "Access Denied", "blocked", "验证码", "captcha"]
            if any(kw in body_text[:500].lower() for kw in [k.lower() for k in block_keywords]):
                logger.debug(f"Playwright 检测到拦截页面: {url}")
                return None
            for tag in soup(["script", "style", "nav", "footer", "header", "aside",
                             "iframe", "noscript", "form", "button", "svg", "img"]):
                tag.decompose()
            text = _extract_text(soup)
            lines = [l.strip() for l in text.splitlines() if l.strip()]
            text = "\n".join(lines)
            text = re.sub(r'\n{3,}', '\n\n', text)
        else:
            text = re.sub(r'<[^>]+>', ' ', html)
            text = re.sub(r'\s+', ' ', text).strip()
        # 内容过少时，尝试从拦截的API响应中提取数据（过数据层）
        extracted_from_api = ""
        if len(text.strip()) < 200 and intercept_api and api_requests:
            for req in api_requests:
                body = req.get("response_body", "")
                if not body:
                    continue
                try:
                    import json as _json
                    data = _json.loads(body)
                    extracted = _extract_data_from_json(data)
                    if extracted and len(extracted) > 50:
                        extracted_from_api += f"\n[来自API: {req['url']}]\n{extracted}\n"
                except Exception:
                    # 非JSON，尝试提取文本
                    if len(body) > 50 and len(body) < 100000:
                        cleaned = re.sub(r'<[^>]+>', ' ', body)
                        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
                        if len(cleaned) > 50:
                            extracted_from_api += f"\n[来自API: {req['url']}]\n{cleaned[:5000]}\n"
            if extracted_from_api:
                text = (text + "\n" + extracted_from_api).strip()

        if len(text.strip()) < 50:
            return None

        result = {
            "title": title or url,
            "url": url,
            "content": text,
            "status": resp.status,
            "engine": "playwright",
            "content_length": len(text)
        }
        # 附加API请求信息（供调试和后续使用）
        if intercept_api and api_requests:
            result["api_requests"] = [
                {
                    "url": r.get("url", ""),
                    "method": r.get("method", ""),
                    "status": r.get("response_status", 0),
                    "has_body": bool(r.get("response_body")),
                    "post_data": r.get("post_data", "")[:500] if r.get("post_data") else "",
                }
                for r in api_requests[:50]  # 最多记录50个
            ]
            result["api_request_count"] = len(api_requests)
        return result
    except Exception as e:
        logger.debug(f"Playwright 抓取失败 {url}: {e}")
        return None
    finally:
        if page:
            try:
                page.context.close()
            except Exception:
                pass

def _extract_data_from_json(data, depth: int = 0) -> str:
    """从JSON数据中递归提取有意义的文本内容"""
    if depth > 5:
        return ""
    result_parts = []
    if isinstance(data, dict):
        for key, value in data.items():
            key_lower = str(key).lower()
            # 跳过明显的元数据字段
            if key_lower in ("code", "status", "success", "msg", "message", "timestamp", "time", "id", "uuid"):
                if isinstance(value, (str, int, float)) and len(str(value)) < 100:
                    continue
            if isinstance(value, str) and len(value) > 10:
                result_parts.append(f"{key}: {value}")
            elif isinstance(value, (dict, list)):
                sub = _extract_data_from_json(value, depth + 1)
                if sub:
                    result_parts.append(sub)
    elif isinstance(data, list):
        for item in data[:20]:  # 最多处理20项
            if isinstance(item, str) and len(item) > 10:
                result_parts.append(item)
            elif isinstance(item, (dict, list)):
                sub = _extract_data_from_json(item, depth + 1)
                if sub:
                    result_parts.append(sub)
    return "\n".join(result_parts)[:10000]

def _extract_text(soup) -> str:
    """从 BeautifulSoup 提取正文"""
    for selector in ["article", "main", "[role=main]", ".post-content", ".article-content",
                     ".entry-content", "#content", ".content", "#main", ".main"]:
        el = soup.select_one(selector)
        if el and len(el.get_text(strip=True)) > 100:
            return el.get_text(separator="\n", strip=True)
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
    return soup.get_text(separator="\n", strip=True)

def cleanup():
    """清理浏览器实例（程序退出时调用）"""
    _cleanup_browser()
