"""搜索编排器（SearchOrchestrator）

统一管理多引擎并行搜索、结果合并、容错重试。
解决单引擎失败/超时导致搜索不可用的问题。

策略：
1. 并行发起多个搜索引擎请求（线程池）
2. 谁先成功且结果足够就用谁，其他引擎结果作为补充
3. 结果去重（按URL标准化）
4. 全部失败时尝试 Wikipedia API + DuckDuckGo Instant Answer
5. 硬超时保护，不卡住主流程
"""

from __future__ import annotations

import re
import time
import logging
from .constants import *


def _search_one_engine(engine_name: str, query: str, max_results: int) -> Dict[str, Any]:
    """在单个引擎上搜索，返回结果或错误"""
    try:
        from .web_search import SEARCH_BACKENDS
        search_fn = SEARCH_BACKENDS.get(engine_name)
        if not search_fn:
            return {"engine": engine_name, "results": [], "error": "unknown engine"}
        start = time.time()
        # 高级搜索语法先按引擎规范化（ext:→filetype:、百度不支持的操作符剔除）。
        # 各引擎对 dork 的支持差别很大，原样透传经常白搜。
        _engine_query = query
        try:
            from .dork_parser import is_dork_query, parse_dork, build_engine_query
            if is_dork_query(query):
                _engine_query = build_engine_query(parse_dork(query), engine_name)
        except Exception:
            _engine_query = query
        results = search_fn(_engine_query, max_results)
        elapsed = time.time() - start
        if results and "error" not in results[0]:
            return {"engine": engine_name, "results": results, "elapsed": elapsed}
        err = results[0].get("error", "no results") if results else "no results"
        return {"engine": engine_name, "results": [], "error": err, "elapsed": elapsed}
    except Exception as e:
        return {"engine": engine_name, "results": [], "error": str(e)[:200]}

def _ddg_instant_answer(query: str) -> List[Dict]:
    """DuckDuckGo Instant Answer API（无需密钥，无反爬）"""
    try:
        import requests
        url = "https://api.duckduckgo.com/"
        params = {"q": query, "format": "json", "no_html": 1, "skip_disambig": 1}
        resp = requests.get(url, params=params, timeout=ENGINE_TIMEOUT,
                           headers={"User-Agent": "Mozilla/5.0"})
        data = resp.json()
        results = []
        # AbstractText
        if data.get("AbstractText") and data.get("AbstractURL"):
            results.append({
                "title": data.get("Heading", query),
                "url": data["AbstractURL"],
                "snippet": data["AbstractText"][:300],
            })
        # RelatedTopics
        for topic in data.get("RelatedTopics", [])[:8]:
            if isinstance(topic, dict) and topic.get("FirstURL") and topic.get("Text"):
                results.append({
                    "title": topic["Text"][:80],
                    "url": topic["FirstURL"],
                    "snippet": topic["Text"][:300],
                })
            elif isinstance(topic, dict) and "Topics" in topic:
                for sub in topic.get("Topics", [])[:3]:
                    if isinstance(sub, dict) and sub.get("FirstURL"):
                        results.append({
                            "title": sub.get("Text", "")[:80],
                            "url": sub["FirstURL"],
                            "snippet": sub.get("Text", "")[:300],
                        })
        return results
    except Exception:
        return []

def _wikipedia_api_search(query: str, max_results: int = 5) -> List[Dict]:
    """Wikipedia API 搜索（最可靠的兜底）"""
    try:
        import requests
        url = "https://en.wikipedia.org/w/api.php"
        # 先搜索中文
        for lang in ["zh", "en"]:
            api_url = f"https://{lang}.wikipedia.org/w/api.php"
            params = {
                "action": "query", "list": "search", "srsearch": query,
                "format": "json", "srlimit": max_results,
            }
            resp = requests.get(api_url, params=params, timeout=ENGINE_TIMEOUT,
                               headers={"User-Agent": "MrHua/1.0"})
            data = resp.json()
            results = []
            for item in data.get("query", {}).get("search", []):
                title = item.get("title", "")
                snippet = re.sub(r"<[^>]+>", "", item.get("snippet", ""))
                page_url = f"https://{lang}.wikipedia.org/wiki/{title.replace(' ', '_')}"
                results.append({
                    "title": title,
                    "url": page_url,
                    "snippet": snippet[:300],
                })
            if results:
                return results
        return []
    except Exception:
        return []
