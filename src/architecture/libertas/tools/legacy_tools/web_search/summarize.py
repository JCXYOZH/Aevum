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
from .search import *


def search_and_summarize(query: str, max_results: int = 8, fetch_top: int = 3, max_chars_per_page: int = 4000, progress_cb=None,
                         total_timeout: Optional[float] = None) -> Dict:
    """搜索并自动抓取前N个结果页面的正文，返回丰富的搜索结果

    total_timeout: 整次调用的墙钟预算（秒）。默认 None 表示不设预算，行为与改动前
    一致（每页各用 fetch_page_content 的默认 20s，最坏 3 页约 60s）。给定预算后：
    搜索阶段与本函数共享同一个起始时刻（搜索耗掉的预算会让后续抓取更早被跳过），
    但它本身没有超时、无法被打断；逐页抓取的超时取 min(20, 剩余预算)，预算不足则
    跳过剩余页面。返回值在"确实被预算截断"时带 budget_truncated / budget_note
    （包括单页抓取自身超出剩余预算、导致总耗时越过预算的情形）。
    """
    def _cb(step, **kw):
        if progress_cb:
            try:
                progress_cb(step, **kw)
            except Exception:
                pass

    from .web_engine import _MIN_TIMEOUT
    _deadline = (None if not total_timeout or total_timeout <= 0
                 else time.time() + float(total_timeout))

    def _left() -> float:
        return float("inf") if _deadline is None else _deadline - time.time()

    def _has_budget(margin: float = _MIN_TIMEOUT) -> bool:
        return _left() > margin

    _cb("searching", query=query)
    search_results = web_search(query, max_results=max_results)
    budget_skipped = 0
    if "error" not in search_results[0] if search_results else True:
        for i, r in enumerate(search_results[:fetch_top]):
            if "error" in r or not r.get("url"):
                continue
            if not _has_budget():
                # 预算不足：跳过剩余页正文抓取（不再发起新的网络请求）
                budget_skipped += 1
                continue
            try:
                _cb("fetching_page", url=r["url"], title=r.get("title", ""), index=i+1, total=min(fetch_top, len(search_results)))
                page = fetch_page_content(r["url"], max_chars=max_chars_per_page,
                                          timeout=max(1, int(min(_PAGE_FETCH_TIMEOUT, _left()))))
                r["page_content"] = page.get("content", "")
                if isinstance(r["page_content"], bytes):
                    r["page_content"] = r["page_content"].decode('utf-8', errors='replace')
                if page.get("title"):
                    r["title"] = page["title"]
                _cb("page_fetched", url=r["url"], title=r.get("title", ""), chars=len(r["page_content"]), index=i+1)
                time.sleep(min(0.3, max(0.0, _left())))
            except Exception as e:
                r["page_content"] = ""
                _cb("page_error", url=r["url"], error=str(e), index=i+1)
    out = {"query": query, "results": search_results, "count": len(search_results)}
    if budget_skipped:
        out["budget_truncated"] = True
        out["budget_note"] = (f"因预算截断，跳过 {budget_skipped} 页正文抓取"
                              f"（总预算 {total_timeout}s 已用尽）")
    elif _deadline is not None and _left() < 0:
        # 没有任何页面被跳过，但单页 fetch_page_content 自己超出了剩余预算（例如
        # "慢速滴数据"响应），总耗时已经越过预算——如实标注，不要静默装作没超。
        out["budget_truncated"] = True
        out["budget_note"] = (f"总预算 {total_timeout}s 已被单页抓取超出"
                              f"（页面抓取自身耗时超出剩余预算）")
    return out

def multi_query_search(queries: list, max_results_per_query: int = 5, fetch_top: int = 2) -> List[Dict]:
    """多关键词搜索，合并去重结果。用于范围搜索，不局限于单一关键词"""
    all_results = []
    seen_urls = set()
    for query in queries:
        try:
            results = web_search(query, max_results=max_results_per_query)
            for r in results:
                if "error" in r:
                    continue
                url = r.get("url", "")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    r["matched_query"] = query
                    all_results.append(r)
            time.sleep(0.2)
        except Exception:
            continue
    # 自动抓取前N个页面的正文
    for r in all_results[:fetch_top]:
        try:
            page = fetch_page_content(r["url"], max_chars=3000)
            r["page_content"] = page.get("content", "")
            if isinstance(r["page_content"], bytes):
                r["page_content"] = r["page_content"].decode('utf-8', errors='replace')
            time.sleep(0.3)
        except Exception:
            r["page_content"] = ""
    return all_results
