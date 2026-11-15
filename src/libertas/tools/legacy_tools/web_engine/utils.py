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


def format_fetch_result(page: Dict, url: str) -> str:
    """将抓取结果格式化为模型可读的文本"""
    if page.get("content"):
        src = page.get("source", "") or page.get("engine", "")
        src_note = f"（通过{src}获取）" if src else ""
        return f"【网页内容: {page.get('title', url)}{src_note}】\nURL: {url}\n\n{page['content']}"
    err = page.get("error", "未知错误")
    return f"【网页抓取失败: {err}】\nURL: {url}"

def extract_url(text: str) -> Optional[str]:
    """从文本中提取URL"""
    m = re.search(r'https?://[\w\-./?=&%#:@+~]+', text)
    if m:
        return m.group(0).rstrip('，。、；：！？）】》」\')')
    return None

def is_url(text: str) -> bool:
    """判断文本是否主要是一个URL"""
    text = text.strip()
    if re.match(r'^https?://\S+$', text):
        return True
    if re.match(r'^[\w\-]+\.(com|cn|org|net|io|gov|edu|ai|dev|app|tech|me|co)\S*$', text, re.IGNORECASE):
        return True
    return False
