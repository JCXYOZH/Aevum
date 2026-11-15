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


def robust_search(query: str, max_results: int = 8, fetch_top: int = 3,
                  max_chars_per_page: int = 3000,
                  progress_cb: Optional[Callable] = None) -> Dict:
    """
    统一搜索接口：搜索 + 自动抓取前N个页面。
    永不返回空结果——即使页面全部抓取失败，也返回标题+摘要。

    返回:
    {
        "query": str,
        "results": [{"title", "url", "snippet", "page_content"}],
        "total": int,
        "fetched": int,
        "error": str (optional)
    }
    """
    def _notify(step, **kw):
        if progress_cb:
            try:
                progress_cb(step, **kw)
            except Exception:
                pass

    # 检查缓存
    cache_key = _cache_key(f"search:{query}:{max_results}:{fetch_top}")
    cached = _cache_get(cache_key)
    if cached:
        _notify("search_done", query=query, count=cached.get("total", 0), cached=True)
        return cached

    _notify("search_start", keyword=query)
    _notify("searching", query=query)

    # 执行搜索（8个后端自动回退）
    search_results = web_search(query, max_results=max_results)

    if not search_results or ("error" in search_results[0]):
        err = search_results[0].get("error", "未知错误") if search_results else "无结果"
        _notify("search_error", query=query, error=err)
        result = {"query": query, "results": [], "total": 0, "fetched": 0, "error": err}
        _cache_set(cache_key, result)
        return result

    _notify("search_results", query=query, count=len(search_results),
            urls=[r.get("url", "") for r in search_results[:5]],
            titles=[r.get("title", "") for r in search_results[:5]])

    # 抓取前N个页面
    fetched_count = 0
    output_results = []
    for i, r in enumerate(search_results):
        item = {
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "snippet": r.get("snippet", ""),
            "page_content": ""
        }
        if i < fetch_top and r.get("url"):
            _notify("fetching_page", url=r["url"], title=item["title"][:50])
            page = robust_fetch(r["url"], max_chars=max_chars_per_page, progress_cb=progress_cb)
            if page.get("content"):
                _pc = page["content"]
                if isinstance(_pc, bytes):
                    _pc = _pc.decode('utf-8', errors='replace')
                item["page_content"] = _pc
                fetched_count += 1
                _notify("page_fetched", url=r["url"], title=page.get("title", "")[:50],
                        chars=len(page["content"]))
            else:
                _notify("page_error", url=r["url"], error=page.get("error", ""))
        output_results.append(item)

    _notify("search_done", query=query, count=len(output_results), fetched=fetched_count)

    result = {
        "query": query,
        "results": output_results,
        "total": len(output_results),
        "fetched": fetched_count
    }
    _cache_set(cache_key, result)
    return result

def format_search_results(search_data: Dict) -> str:
    """将搜索结果格式化为模型可读的文本"""
    if not search_data.get("results"):
        err = search_data.get("error", "未知错误")
        return f"【网络搜索暂时不可用: {err}】"

    query = search_data["query"]
    results = search_data["results"]
    fetched = search_data.get("fetched", 0)
    lines = [f"【网络搜索结果: {query}（共{len(results)}条，已抓取{fetched}个页面正文）】"]

    for i, r in enumerate(results, 1):
        lines.append(f"{i}. {r['title']}\n   URL: {r['url']}\n   {r.get('snippet', '')}")
        if r.get("page_content"):
            _pc = r["page_content"]
            if isinstance(_pc, bytes):
                _pc = _pc.decode('utf-8', errors='replace')
            lines.append(f"   📄 页面正文:\n{_pc[:2500].strip()}")
        elif r.get("snippet"):
            lines.append("   ℹ️ 页面正文抓取失败，以上摘要信息可用")

    return "\n\n".join(lines)

def quick_search(query: str, max_results: int = 8, progress_cb: Optional[Callable] = None) -> Dict:
    """
    Layer 2: 快速搜索——只获取标题+摘要，不抓取页面正文。
    速度快（1-3秒），结果用于注入上下文。
    页面正文由 Layer 3（模型按需调用 web_fetch）获取。
    """
    def _notify(step, **kw):
        if progress_cb:
            try:
                progress_cb(step, **kw)
            except Exception:
                pass

    cache_key = _cache_key(f"quick:{query}:{max_results}")
    cached = _cache_get(cache_key)
    if cached:
        _notify("search_done", query=query, count=cached.get("total", 0), cached=True)
        return cached

    _notify("searching", query=query)
    results = web_search(query, max_results=max_results)

    if not results or ("error" in results[0]):
        err = results[0].get("error", "未知错误") if results else "无结果"
        _notify("search_error", query=query, error=err)
        result = {"query": query, "results": [], "total": 0, "error": err}
        _cache_set(cache_key, result)
        return result

    output = []
    for r in results:
        output.append({
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "snippet": r.get("snippet", ""),
        })

    _notify("search_results", query=query, count=len(output),
            urls=[r["url"] for r in output[:5]],
            titles=[r["title"] for r in output[:5]])
    _notify("search_done", query=query, count=len(output))

    result = {"query": query, "results": output, "total": len(output)}
    _cache_set(cache_key, result)
    return result

def format_quick_results(search_data: Dict) -> str:
    """格式化快速搜索结果（标题+摘要，无正文）"""
    if not search_data.get("results"):
        err = search_data.get("error", "未知错误")
        return f"【搜索暂时不可用: {err}】"
    query = search_data["query"]
    results = search_data["results"]
    lines = [f"【搜索结果: {query}（共{len(results)}条）】"]
    lines.append("如需查看某个网页的完整内容，请调用 web_fetch 工具传入URL。")
    for i, r in enumerate(results, 1):
        lines.append(f"{i}. {r['title']}\n   URL: {r['url']}\n   {r.get('snippet', '')}")
    return "\n".join(lines)
