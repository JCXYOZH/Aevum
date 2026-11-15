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
from .engines import *
from .engines import (_search_baidu, _search_bing, _search_brave, _search_ddg_html, _search_duckduckgo, _search_ecosia, _search_google, _search_mojeek, _search_qwant, _search_startpage, _search_wikipedia, _search_yahoo, _search_yandex)


SEARCH_BACKENDS = {
    "bing": _search_bing,
    "google": _search_google,
    "duckduckgo": _search_duckduckgo,
    "baidu": _search_baidu,
    "brave": _search_brave,
    "yandex": _search_yandex,
    "startpage": _search_startpage,
    "wikipedia": _search_wikipedia,
    "mojeek": _search_mojeek,
    "qwant": _search_qwant,
    "ecosia": _search_ecosia,
    "ddg_html": _search_ddg_html,
    "yahoo": _search_yahoo,
}
