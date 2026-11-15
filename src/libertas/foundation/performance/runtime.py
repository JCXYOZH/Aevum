"""职责模块：runtime。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple, TypeVar
import gc
import os
import time

from .middleware import GzipMiddleware
from .pooling import MemoryGuard
from .state import _counters
from .state import _init_lock
from .state import _initialized
from .state import _stats_lock
from .state import _timers
from .middleware import add_cache_headers
from .cache import get_cache
from .http import get_http_session
from .workers import get_thread_pool
from .database import patch_sqlite
from .profiling import profiler

def initialize(enable_gzip: bool = True, enable_mem_guard: bool = True,
               mem_threshold_mb: int = 1024) -> Dict[str, Any]:
    """初始化所有性能优化。幂等。"""
    global _initialized
    with _init_lock:
        if _initialized:
            return {"status": "already_initialized"}
        t0 = time.perf_counter()

        # GC 调优
        tune_gc()

        # SQLite 全局优化
        patch_sqlite()

        # 预热 HTTP 连接池
        get_http_session()

        # 预热线程池
        get_thread_pool()

        # 内存守卫
        if enable_mem_guard:
            guard = MemoryGuard(threshold_mb=mem_threshold_mb)
            guard.register_cleanup(lambda: get_cache("default").clear())
            guard.start()

        elapsed = round((time.perf_counter() - t0) * 1000, 1)
        _initialized = True
        return {
            "status": "initialized",
            "init_ms": elapsed,
            "gc_tuned": True,
            "http_pool": True,
            "thread_pool": True,
            "mem_guard": enable_mem_guard,
        }

def is_initialized() -> bool:
    return _initialized

def instrument_flask_app(app, enable_gzip: bool = False):
    """给 Flask 应用注入性能优化。

    注意：gzip 默认关闭，因为本应用运行在 localhost，压缩收益极小，
    且 WSGI 中间件容易干扰 SSE 流式响应。如需启用，显式传 enable_gzip=True。
    """
    try:
        from flask import request as _flask_request, g as _flask_g
    except ImportError:
        return app

    # gzip 压缩（默认关闭：localhost 场景收益小，且容易干扰流式响应）
    if enable_gzip:
        app.wsgi_app = GzipMiddleware(app.wsgi_app)

    # 请求计时
    @app.before_request
    def _perf_before():
        try:
            _flask_g._perf_start = time.perf_counter()
        except Exception:
            pass

    @app.after_request
    def _perf_after(response):
        try:
            start = getattr(_flask_g, "_perf_start", None)
            if start:
                elapsed = time.perf_counter() - start
                path = _flask_request.path
                profiler.record(f"HTTP {_flask_request.method} {path}", elapsed,
                                status=response.status_code)
                with _stats_lock:
                    key = f"http:{path}"
                    _timers[key] = _timers.get(key, 0.0) + elapsed
                    _counters[key + ":calls"] = _counters.get(key + ":calls", 0) + 1
        except Exception:
            pass
        return response

    # 静态文件缓存
    @app.after_request
    def _cache_static(response):
        try:
            if _flask_request.path.startswith("/static/") or "/assets/" in _flask_request.path:
                return add_cache_headers(response, max_age=86400 * 7)
        except Exception:
            pass
        return response

    return app

def fast_request(method: str, url: str, timeout: float = 15.0,
                 retries: int = 2, **kwargs) -> Any:
    """带连接池和重试的 HTTP 请求。"""
    session = get_http_session()
    if session is None:
        import requests
        session = requests
    last_err = None
    for attempt in range(retries + 1):
        try:
            resp = session.request(method, url, timeout=timeout, **kwargs)
            return resp
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(0.3 * (attempt + 1))
    raise last_err

def auto_optimize():
    """根据环境自动选择优化策略。"""
    initialize(
        enable_gzip=True,
        enable_mem_guard=True,
        mem_threshold_mb=2048 if (os.cpu_count() or 4) >= 8 else 1024,
    )
    # 磁盘 I/O 优化：确保数据目录在快速文件系统上
    data_dir = os.path.join(os.path.expanduser("~"), "LibertasData")
    if os.path.isdir(data_dir):
        # 提示：如果在机械硬盘上，建议迁移到 SSD
        pass

def tune_gc() -> None:
    """调整 Python GC 参数，减少暂停时间。"""
    try:
        # 提高第0代阈值，减少频繁 GC
        gc.set_threshold(700, 10, 10)
        # 禁用交互式 GC（避免在关键路径触发）
        # gc.freeze() 在 fork 前调用可加速子进程
        gc.collect(2)
    except Exception:
        pass
