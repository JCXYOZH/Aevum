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
from libertas.foundation.config import get_data_dir
from .constants import *


_CACHE_DIR = os.path.join(get_data_dir(), r"web_cache")
_CACHE_TTL = 1800  # 30分钟


def _cache_key(query: str) -> str:
    return hashlib.md5(query.encode("utf-8")).hexdigest()

def _cache_get(key: str) -> Optional[dict]:
    try:
        path = os.path.join(_CACHE_DIR, key + ".json")
        if not os.path.exists(path):
            return None
        if time.time() - os.path.getmtime(path) > _CACHE_TTL:
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def _cache_set(key: str, data: dict):
    try:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        path = os.path.join(_CACHE_DIR, key + ".json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception:
        pass
