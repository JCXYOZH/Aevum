"""职责模块：workers。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple, TypeVar
import os

from .state import _thread_pool
from .state import _thread_pool_lock

def get_thread_pool(max_workers: int = 0):
    global _thread_pool
    if _thread_pool is not None:
        return _thread_pool
    with _thread_pool_lock:
        if _thread_pool is None:
            from concurrent.futures import ThreadPoolExecutor
            if max_workers <= 0:
                max_workers = min(32, (os.cpu_count() or 4) * 4)
            _thread_pool = ThreadPoolExecutor(
                max_workers=max_workers,
                thread_name_prefix="libertas-worker",
            )
    return _thread_pool

def run_in_thread(func: Callable, *args, **kwargs):
    """在线程池中提交任务，返回 Future。"""
    return get_thread_pool().submit(func, *args, **kwargs)

def parallel_map(func: Callable, items: list, max_workers: int = 0,
                 timeout: Optional[float] = None) -> list:
    """并行执行 map，保持顺序。

    timeout 到点时：未完成的任务按 TimeoutError 记入对应位置（返回值仍是与 items
    等长的列表），as_completed 抛出的 TimeoutError 不再冒到调用方；同时不再等待
    仍在执行的任务，使 timeout 对调用方真正生效（被放弃的任务在后台自行结束）。
    """
    from concurrent.futures import (ThreadPoolExecutor, as_completed,
                                    TimeoutError as FuturesTimeoutError)
    if not items:
        return []
    if max_workers <= 0:
        max_workers = min(32, len(items), (os.cpu_count() or 4) * 2)
    results = [None] * len(items)
    filled = set()  # 已写入结果的下标（func 合法返回 None 时也能区分）
    ex = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="libertas-par")
    try:
        future_to_idx = {ex.submit(func, item): i for i, item in enumerate(items)}
        try:
            for future in as_completed(future_to_idx, timeout=timeout):
                idx = future_to_idx[future]
                try:
                    results[idx] = future.result()
                except Exception as e:
                    results[idx] = e
                filled.add(idx)
        except FuturesTimeoutError:
            for future, idx in future_to_idx.items():
                if idx in filled:
                    continue
                future.cancel()
                results[idx] = FuturesTimeoutError(f"并行任务超时（timeout={timeout}s）")
    finally:
        # 不用 with 语句：with 退出时的 shutdown(wait=True) 会继续阻塞到慢任务跑完，
        # timeout 就形同虚设；这里放弃等待，让仍在执行的任务在后台自行结束。
        ex.shutdown(wait=False, cancel_futures=True)
    return results
