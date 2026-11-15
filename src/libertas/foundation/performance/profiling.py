"""职责模块：profiling。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple, TypeVar
from collections import OrderedDict, deque
import functools
import gc
import os
import threading
import time

from .constants import T
from .cache import _caches
from .cache import _caches_lock
from .state import _counters
from .state import _initialized
from .state import _stats_lock
from .state import _thread_pool
from .state import _timers

class Timer:
    """上下文管理器 / 装饰器：记录函数执行时间。"""
    def __init__(self, label: str):
        self.label = label
        self.start = 0.0
        self.elapsed = 0.0

    def __enter__(self):
        self.start = time.perf_counter()
        return self

    def __exit__(self, *exc):
        self.elapsed = time.perf_counter() - self.start
        with _stats_lock:
            _timers[self.label] = _timers.get(self.label, 0.0) + self.elapsed
            _counters[self.label + ":calls"] = _counters.get(self.label + ":calls", 0) + 1

    def __call__(self, func: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            with Timer(self.label or f"{func.__module__}.{func.__qualname__}"):
                return func(*args, **kwargs)
        return wrapper

def timed(label: str = ""):
    """装饰器：记录函数执行时间。"""
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        tag = label or f"{func.__module__}.{func.__qualname__}"
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            with Timer(tag):
                return func(*args, **kwargs)
        return wrapper
    return decorator

class Profiler:
    """轻量性能分析：记录热点函数和慢请求。"""
    def __init__(self, slow_threshold: float = 1.0):
        self.slow_threshold = slow_threshold
        self.slow_events: deque = deque(maxlen=200)
        self._lock = threading.Lock()

    def record(self, label: str, elapsed: float, **extra):
        if elapsed >= self.slow_threshold:
            with self._lock:
                self.slow_events.append({
                    "label": label,
                    "elapsed_ms": round(elapsed * 1000, 1),
                    "time": time.strftime("%H:%M:%S"),
                    **extra,
                })

    def get_slow_events(self) -> List[Dict]:
        with self._lock:
            return list(self.slow_events)

    def get_hotspots(self, top: int = 10) -> List[Dict]:
        with _stats_lock:
            items = []
            for k, v in _timers.items():
                calls = _counters.get(k + ":calls", 1)
                items.append({
                    "function": k,
                    "total_ms": round(v * 1000, 1),
                    "calls": calls,
                    "avg_ms": round(v / calls * 1000, 2) if calls else 0,
                })
            items.sort(key=lambda x: x["total_ms"], reverse=True)
            return items[:top]

class StartupTracer:
    """追踪启动各阶段耗时。"""
    def __init__(self):
        self.phases: List[Tuple[str, float]] = []
        self._current = ""
        self._t0 = 0.0

    def begin(self, phase: str):
        self._current = phase
        self._t0 = time.perf_counter()

    def end(self):
        if self._current:
            elapsed = time.perf_counter() - self._t0
            self.phases.append((self._current, elapsed))
            self._current = ""

    def report(self) -> List[Dict]:
        return [{"phase": p, "ms": round(t * 1000, 1)} for p, t in self.phases]

profiler = Profiler()

startup_tracer = StartupTracer()

def get_performance_snapshot() -> Dict[str, Any]:
    """获取当前性能指标快照。"""
    snapshot: Dict[str, Any] = {
        "initialized": _initialized,
        "caches": {},
        "hotspots": profiler.get_hotspots(10),
        "slow_events": profiler.get_slow_events()[-20:],
        "startup_phases": startup_tracer.report(),
        "timers": {},
    }

    # 缓存统计
    with _caches_lock:
        for name, cache in _caches.items():
            snapshot["caches"][name] = cache.stats()

    # 计时器统计
    with _stats_lock:
        for k, v in _timers.items():
            calls = _counters.get(k + ":calls", 0)
            snapshot["timers"][k] = {
                "total_ms": round(v * 1000, 1),
                "calls": calls,
                "avg_ms": round(v / calls * 1000, 2) if calls else 0,
            }

    # 系统资源
    try:
        import psutil
        proc = psutil.Process(os.getpid())
        mem = proc.memory_info()
        snapshot["system"] = {
            "rss_mb": round(mem.rss / 1024 / 1024, 1),
            "vms_mb": round(mem.vms / 1024 / 1024, 1),
            "cpu_percent": proc.cpu_percent(interval=None),
            "threads": proc.num_threads(),
            "cpu_count": os.cpu_count(),
        }
        vm = psutil.virtual_memory()
        snapshot["system"]["system_mem_percent"] = vm.percent
    except ImportError:
        snapshot["system"] = {"cpu_count": os.cpu_count()}

    # 线程池统计
    global _thread_pool
    if _thread_pool:
        snapshot["thread_pool"] = {
            "max_workers": _thread_pool._max_workers,
        }

    return snapshot

def reset_stats():
    """重置性能统计。"""
    with _stats_lock:
        _timers.clear()
        _counters.clear()
    with _caches_lock:
        for cache in _caches.values():
            cache.clear()
    gc.collect(2)
