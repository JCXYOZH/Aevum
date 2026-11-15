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
from .parallel import parallel_search, format_parallel_results


class SearchOrchestrator:
    """搜索编排器单例，带缓存"""

    def __init__(self):
        self._cache: Dict[str, Dict] = {}
        self._cache_ttl = 300  # 5分钟缓存
        self._cache_time: Dict[str, float] = {}
        self._lock = threading.Lock()

    def search(self, query: str, max_results: int = 8,
               progress_cb: Optional[Callable] = None,
               fast_only: bool = False,
               use_cache: bool = True) -> Dict[str, Any]:
        """带缓存的并行搜索"""
        cache_key = f"{query}:{max_results}:{fast_only}"

        if use_cache:
            with self._lock:
                cached = self._cache.get(cache_key)
                cached_time = self._cache_time.get(cache_key, 0)
                if cached and (time.time() - cached_time) < self._cache_ttl:
                    if progress_cb:
                        try:
                            progress_cb("search_done", query=query,
                                       count=cached.get("total", 0), cached=True)
                        except Exception:
                            pass
                    return cached

        result = parallel_search(query, max_results, progress_cb, fast_only)

        if use_cache and result.get("results"):
            with self._lock:
                self._cache[cache_key] = result
                self._cache_time[cache_key] = time.time()

        return result

    def clear_cache(self):
        with self._lock:
            self._cache.clear()
            self._cache_time.clear()


def get_search_orchestrator():
    global _orchestrator_instance
    if _orchestrator_instance is None:
        _orchestrator_instance = SearchOrchestrator()
    return _orchestrator_instance
