"""包入口：公共符号重新导出。"""

from .constants import T, _MISSING
from .state import _initialized, _init_lock, _timers, _counters, _stats_lock, _http_session, _http_session_lock, _thread_pool, _thread_pool_lock, _sqlite_patched
from .cache import _caches, _caches_lock, LRUCache, get_cache, cached
from .http import LazyLoader, lazy, get_http_session
from .workers import get_thread_pool, run_in_thread, parallel_map
from .database import optimize_sqlite, patch_sqlite
from .profiling import Timer, timed, Profiler, StartupTracer, profiler, startup_tracer, get_performance_snapshot, reset_stats
from .middleware import GzipMiddleware, add_cache_headers
from .pooling import Batcher, ObjectPool, Debouncer, Throttler, MemoryGuard
from .io import ensure_dir, atomic_write, read_file_fast
from .runtime import initialize, is_initialized, instrument_flask_app, fast_request, auto_optimize, tune_gc

__all__ = [
    "Batcher",
    "Debouncer",
    "GzipMiddleware",
    "LRUCache",
    "LazyLoader",
    "MemoryGuard",
    "ObjectPool",
    "Profiler",
    "StartupTracer",
    "T",
    "Throttler",
    "Timer",
    "_MISSING",
    "_caches",
    "_caches_lock",
    "_counters",
    "_http_session",
    "_http_session_lock",
    "_init_lock",
    "_initialized",
    "_sqlite_patched",
    "_stats_lock",
    "_thread_pool",
    "_thread_pool_lock",
    "_timers",
    "add_cache_headers",
    "atomic_write",
    "auto_optimize",
    "cached",
    "ensure_dir",
    "fast_request",
    "get_cache",
    "get_http_session",
    "get_performance_snapshot",
    "get_thread_pool",
    "initialize",
    "instrument_flask_app",
    "is_initialized",
    "lazy",
    "optimize_sqlite",
    "parallel_map",
    "patch_sqlite",
    "profiler",
    "read_file_fast",
    "reset_stats",
    "run_in_thread",
    "startup_tracer",
    "timed",
    "tune_gc",
]
