"""
security/web_scraper_enhancer.py - 网页抓取增强与反爬绕过

核心能力：
- WebScraperEnhancer: 增强型网页抓取
  - JS渲染页面抓取（模拟浏览器行为）
  - 反爬绕过（User-Agent轮换/请求间隔/代理池/Referer伪造）
  - 会话管理（Cookie持久化/CSRF Token自动处理）
  - 深度抓取（链接发现/递归爬取/内容去重）
  - 动态内容提取（AJAX/API端点发现）
  - 登录态抓取（表单自动提交/会话保持）
- ContentExtractor: 结构化内容提取
  - 正文提取（去除导航/广告/页脚）
  - 表格提取
  - 链接提取与分类
  - 元数据提取（title/description/keywords）
  - 表单提取（输入框/按钮/隐藏字段）
"""
import os
import re
import sys
import json
import time
import uuid
import random
import hashlib
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from collections import defaultdict, Counter
from html.parser import HTMLParser


# ================================================================
# User-Agent池
# ================================================================

USER_AGENTS = [
    # Chrome (Windows)
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    # Firefox (Windows)
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
    # Chrome (macOS)
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    # Safari (macOS)
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    # Chrome (Linux)
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    # Edge (Windows)
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    # Mobile
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
]

REFERERS = [
    "https://www.google.com/",
    "https://www.baidu.com/",
    "https://www.bing.com/",
    "https://duckduckgo.com/",
    "https://www.google.com/search?q=test",
    "https://t.co/",
    "https://www.facebook.com/",
    "https://twitter.com/",
]

ACCEPT_LANGUAGES = [
    "zh-CN,zh;q=0.9,en;q=0.8",
    "en-US,en;q=0.9",
    "zh-CN,zh;q=0.9",
    "ja-JP,ja;q=0.9,en;q=0.8",
    "ko-KR,ko;q=0.9,en;q=0.8",
]

@dataclass
class ScrapedPage:
    """抓取的页面"""
    url: str = ""
    status_code: int = 0
    content: str = ""
    content_type: str = ""
    content_length: int = 0
    title: str = ""
    meta_description: str = ""
    meta_keywords: str = ""
    links: List[Dict] = field(default_factory=list)
    forms: List[Dict] = field(default_factory=list)
    scripts: List[str] = field(default_factory=list)
    stylesheets: List[str] = field(default_factory=list)
    images: List[str] = field(default_factory=list)
    headers: Dict = field(default_factory=dict)
    cookies: Dict = field(default_factory=dict)
    response_time: float = 0.0
    fetched_at: float = 0.0
    content_hash: str = ""
    is_duplicate: bool = False
    error: str = ""

    def __post_init__(self):
        if not self.fetched_at:
            self.fetched_at = time.time()
        if self.content and not self.content_hash:
            self.content_hash = hashlib.md5(self.content.encode()).hexdigest()

    def to_dict(self) -> Dict:
        return {
            "url": self.url,
            "status_code": self.status_code,
            "content_type": self.content_type,
            "content_length": self.content_length,
            "title": self.title,
            "meta_description": self.meta_description[:200] if self.meta_description else "",
            "link_count": len(self.links),
            "form_count": len(self.forms),
            "script_count": len(self.scripts),
            "image_count": len(self.images),
            "response_time": round(self.response_time, 3),
            "content_hash": self.content_hash,
            "is_duplicate": self.is_duplicate,
            "error": self.error,
            "links": self.links[:50],
            "forms": self.forms,
        }

@dataclass
class CrawlSession:
    """爬取会话"""
    session_id: str = ""
    start_url: str = ""
    max_depth: int = 3
    max_pages: int = 100
    pages: List[ScrapedPage] = field(default_factory=list)
    visited_urls: set = field(default_factory=set)
    queued_urls: List[str] = field(default_factory=list)
    cookies: Dict = field(default_factory=dict)
    headers: Dict = field(default_factory=dict)
    delay_range: Tuple[float, float] = (1.0, 3.0)
    use_proxy: bool = False
    proxies: List[str] = field(default_factory=list)
    started_at: float = 0.0
    completed_at: float = 0.0
    status: str = "pending"  # pending/running/completed/failed
    errors: List[str] = field(default_factory=list)

    def __post_init__(self):
        if not self.session_id:
            self.session_id = f"crawl_{uuid.uuid4().hex[:12]}"
        if not self.started_at:
            self.started_at = time.time()

class HtmlContentParser(HTMLParser):
    """HTML内容解析器"""

    def __init__(self):
        super().__init__()
        self.title = ""
        self.meta_description = ""
        self.meta_keywords = ""
        self.links = []
        self.forms = []
        self.scripts = []
        self.stylesheets = []
        self.images = []
        self._in_title = False
        self._current_form = None
        self._text_buffer = []
        self._skip_tags = {"script", "style", "noscript"}
        self._current_skip = 0

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        tag_lower = tag.lower()

        if tag_lower in self._skip_tags:
            self._current_skip += 1
            return

        if tag_lower == "title":
            self._in_title = True

        elif tag_lower == "meta":
            name = attrs_dict.get("name", "").lower()
            content = attrs_dict.get("content", "")
            if name == "description":
                self.meta_description = content
            elif name == "keywords":
                self.meta_keywords = content

        elif tag_lower == "a":
            href = attrs_dict.get("href", "")
            if href and not href.startswith(("#", "javascript:", "mailto:", "tel:")):
                self.links.append({
                    "url": href,
                    "text": "",
                    "attrs": {k: v for k, v in attrs_dict.items() if k in ("rel", "target", "class")},
                })

        elif tag_lower == "form":
            self._current_form = {
                "action": attrs_dict.get("action", ""),
                "method": attrs_dict.get("method", "GET").upper(),
                "inputs": [],
                "buttons": [],
            }

        elif tag_lower == "input" and self._current_form:
            self._current_form["inputs"].append({
                "name": attrs_dict.get("name", ""),
                "type": attrs_dict.get("type", "text"),
                "value": attrs_dict.get("value", ""),
                "placeholder": attrs_dict.get("placeholder", ""),
                "required": "required" in attrs_dict,
            })

        elif tag_lower == "button" and self._current_form:
            self._current_form["buttons"].append({
                "name": attrs_dict.get("name", ""),
                "type": attrs_dict.get("type", "submit"),
                "text": "",
            })

        elif tag_lower == "script":
            src = attrs_dict.get("src", "")
            if src:
                self.scripts.append(src)

        elif tag_lower == "link":
            rel = attrs_dict.get("rel", "")
            href = attrs_dict.get("href", "")
            if "stylesheet" in rel and href:
                self.stylesheets.append(href)

        elif tag_lower == "img":
            src = attrs_dict.get("src", "")
            if src:
                self.images.append({
                    "src": src,
                    "alt": attrs_dict.get("alt", ""),
                    "width": attrs_dict.get("width", ""),
                    "height": attrs_dict.get("height", ""),
                })

    def handle_endtag(self, tag):
        tag_lower = tag.lower()
        if tag_lower in self._skip_tags:
            self._current_skip = max(0, self._current_skip - 1)
            return
        if tag_lower == "title":
            self._in_title = False
        elif tag_lower == "form" and self._current_form:
            self.forms.append(self._current_form)
            self._current_form = None

    def handle_data(self, data):
        if self._current_skip > 0:
            return
        if self._in_title:
            self.title += data.strip()
        # 保存链接文本
        if self.links:
            self.links[-1]["text"] += data.strip()
