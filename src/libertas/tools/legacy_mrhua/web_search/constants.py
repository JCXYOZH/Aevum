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

HAS_DEPS = HAS_REQUESTS and HAS_BS4

BROWSER_PRESETS = {
    "chrome": {
        "name": "Chrome",
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
    },
    "firefox": {
        "name": "Firefox",
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0",
        "sec_ch_ua": None,
    },
    "safari": {
        "name": "Safari",
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
        "sec_ch_ua": None,
    },
    "edge": {
        "name": "Edge",
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
        "sec_ch_ua": '"Microsoft Edge";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
    },
    "mobile_chrome": {
        "name": "手机Chrome",
        "ua": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1",
        "sec_ch_ua": None,
    },
}

SEARCH_ENGINES = {
    "bing": {"name": "Bing", "url": "https://www.bing.com/search", "param": "q"},
    "google": {"name": "Google", "url": "https://www.google.com/search", "param": "q"},
    "duckduckgo": {"name": "DuckDuckGo", "url": "https://html.duckduckgo.com/html/", "param": "q"},
    "ddg_html": {"name": "DDG HTML", "url": "https://html.duckduckgo.com/html/", "param": "q"},
    "baidu": {"name": "百度", "url": "https://www.baidu.com/s", "param": "wd"},
    "brave": {"name": "Brave", "url": "https://search.brave.com/search", "param": "q"},
    "mojeek": {"name": "Mojeek", "url": "https://www.mojeek.com/search", "param": "q"},
    "qwant": {"name": "Qwant", "url": "https://www.qwant.com/", "param": "q"},
    "yahoo": {"name": "Yahoo", "url": "https://search.yahoo.com/search", "param": "p"},
    "ecosia": {"name": "Ecosia", "url": "https://www.ecosia.org/search", "param": "q"},
    "yandex": {"name": "Yandex", "url": "https://yandex.com/search/", "param": "text"},
    "startpage": {"name": "Startpage", "url": "https://www.startpage.com/sp/search", "param": "query"},
}

_REDIRECT_DOMAINS = [
    "baidu.com/link", "www.baidu.com/link",
    "baidu.com/baidu.php", "www.baidu.com/baidu.php",
    "google.com/url", "www.google.com/url",
    "bing.com/ck/a", "www.bing.com/ck/a",
]

_PAGE_FETCH_TIMEOUT = 20
