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


def _is_redirect_url(url: str) -> bool:
    """判断URL是否是搜索引擎的重定向链接"""
    if not url:
        return False
    for d in _REDIRECT_DOMAINS:
        if d in url:
            return True
    return False

def _resolve_one_redirect(url: str, timeout: float = 3.0) -> str:
    """解析单个重定向URL，返回真实URL。失败则返回原URL。"""
    # 方法1：跟随HTTP重定向（百度 /link?url= 通常返回302）
    try:
        resp = _safe_get(url, timeout=(2.0, timeout), verify=False, allow_redirects=True, stream=True)
        real_url = resp.url
        resp.close()
        if real_url and real_url != url and not _is_redirect_url(real_url):
            return real_url
    except Exception:
        pass
    # 方法2：不跟随重定向，直接取 Location 头
    try:
        resp = _safe_get(url, timeout=(2.0, timeout), verify=False, allow_redirects=False)
        loc = resp.headers.get("Location", "")
        if loc:
            from urllib.parse import urljoin
            loc = urljoin(url, loc)
            if loc.startswith("http") and not _is_redirect_url(loc):
                return loc
    except Exception:
        pass
    # 方法3：从HTML/JS中提取真实URL（百度有时返回JS跳转页）
    try:
        resp = _safe_get(url, timeout=(2.0, timeout), verify=False, allow_redirects=True)
        text = resp.text[:5000] if resp.text else ""
        import re as _re
        # 百度跳转页中的 URL=xxx 或 window.location.replace
        for pat in [
            r'URL=["\']([^"\']+)["\']',
            r'window\.location\.replace\(["\']([^"\']+)["\']',
            r'window\.location\.href\s*=\s*["\']([^"\']+)["\']',
            r'<meta[^>]+http-equiv=["\']refresh["\'][^>]+content=["\'][^"\']*url=([^"\'>\s]+)',
            r'"(https?://[^"]+)"',
        ]:
            m = _re.search(pat, text, _re.IGNORECASE)
            if m:
                candidate = m.group(1)
                if candidate.startswith("http") and not _is_redirect_url(candidate):
                    return candidate
    except Exception:
        pass
    return url

def resolve_redirect_urls(results: List[Dict], timeout: float = 3.0) -> List[Dict]:
    """并行解析搜索结果中的重定向URL，替换为真实URL。"""
    if not results:
        return results
    from concurrent.futures import ThreadPoolExecutor, as_completed
    redirect_items = [(i, r) for i, r in enumerate(results)
                      if r.get("url") and _is_redirect_url(r["url"]) and "error" not in r]
    if not redirect_items:
        return results
    with ThreadPoolExecutor(max_workers=min(len(redirect_items), 6)) as ex:
        futures = {ex.submit(_resolve_one_redirect, r["url"], timeout): i
                   for i, r in redirect_items}
        try:
            for fut in as_completed(futures, timeout=timeout + 2):
                idx = futures[fut]
                try:
                    real_url = fut.result()
                    if real_url and real_url != results[idx]["url"]:
                        results[idx]["url"] = real_url
                except Exception:
                    pass
        except concurrent.futures.TimeoutError:
            # 预算内没跑完的重定向解析按"解析失败"跳过，不影响其余结果
            pass
    return results
