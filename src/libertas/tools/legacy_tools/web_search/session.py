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


_current_engine = "chrome"
_current_search_engine = "bing"
_PROXY_CONFIG = None
_session = None
_session_lock = threading.Lock()



def set_browser_engine(engine: str):
    """设置当前浏览器引擎"""
    global _current_engine
    if engine in BROWSER_PRESETS:
        _current_engine = engine

def set_search_engine(engine: str):
    """设置当前搜索引擎"""
    global _current_search_engine
    if engine in SEARCH_ENGINES:
        _current_search_engine = engine

def get_browser_headers(engine: str = None) -> dict:
    """获取指定浏览器引擎的请求头"""
    eng = BROWSER_PRESETS.get(engine or _current_engine, BROWSER_PRESETS["chrome"])
    headers = {
        "User-Agent": eng["ua"],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Cache-Control": "max-age=0",
    }
    if eng.get("sec_ch_ua"):
        headers["Sec-CH-UA"] = eng["sec_ch_ua"]
    return headers

def set_proxy(proxies=None):
    """设置HTTP代理（如SSH隧道的socks5代理）。传None清除。"""
    global _PROXY_CONFIG
    _PROXY_CONFIG = proxies

def _get_proxies():
    """获取当前代理配置。
    优先使用SSH隧道代理；否则显式禁用代理，防止Doubao等应用的
    环境变量（DOUBAO_OFFICE_*_PROXY）被requests误当作代理。
    """
    if _PROXY_CONFIG:
        # 防御：确保代理 URL 是 str
        safe = {}
        for k, v in _PROXY_CONFIG.items():
            safe[k] = str(v) if v is not None else None
        return safe
    return {"http": None, "https": None}  # 显式禁用，绕过环境变量污染

def _get_session():
    global _session
    if _session is None:
        with _session_lock:
            if _session is None:
                s = requests.Session()
                adapter = requests.adapters.HTTPAdapter(
                    pool_connections=10, pool_maxsize=20, max_retries=0
                )
                s.mount("http://", adapter)
                s.mount("https://", adapter)
                _session = s
    return _session

def _safe_get(url, **kwargs):
    """带代理和重试的GET请求，使用连接池。"""
    url = str(url)
    kwargs.setdefault('timeout', (2.0, 3.5))  # (连接超时, 读取超时)
    kwargs.setdefault('allow_redirects', True)
    sess = _get_session()
    try:
        return sess.get(url, proxies=_get_proxies(), **kwargs)
    except requests.exceptions.SSLError:
        kwargs['verify'] = False
        return sess.get(url, proxies=_get_proxies(), **kwargs)
    except requests.exceptions.ConnectionError:
        if _PROXY_CONFIG:
            kwargs.pop('proxies', None)
            return sess.get(url, **kwargs)
        raise

def _safe_post(url, **kwargs):
    """带代理和重试的POST请求，使用连接池。"""
    url = str(url)
    kwargs.setdefault('timeout', (2.0, 3.5))
    sess = _get_session()
    try:
        return sess.post(url, proxies=_get_proxies(), **kwargs)
    except requests.exceptions.SSLError:
        kwargs['verify'] = False
        return sess.post(url, proxies=_get_proxies(), **kwargs)
    except requests.exceptions.ConnectionError:
        if _PROXY_CONFIG:
            kwargs.pop('proxies', None)
            return sess.post(url, **kwargs)
        raise


BROWSER_HEADERS = get_browser_headers()
