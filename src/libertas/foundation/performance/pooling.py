"""职责模块：pooling。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple, TypeVar
from collections import OrderedDict, deque
import gc
import os
import threading
import time

from .constants import T

class Batcher:
    """将短时间内多次调用合并为一次批量执行。"""
    def __init__(self, handler: Callable[[List[Any]], None],
                 max_wait: float = 0.5, max_size: int = 50):
        self.handler = handler
        self.max_wait = max_wait
        self.max_size = max_size
        self._items: List[Any] = []
        self._lock = threading.Lock()
        self._timer: Optional[threading.Timer] = None

    def add(self, item: Any) -> None:
        with self._lock:
            self._items.append(item)
            if len(self._items) >= self.max_size:
                self._flush_locked()
            elif self._timer is None:
                self._timer = threading.Timer(self.max_wait, self._flush)
                self._timer.daemon = True
                self._timer.start()

    def _flush_locked(self):
        if self._timer:
            self._timer.cancel()
            self._timer = None
        items = self._items
        self._items = []
        if items:
            try:
                self.handler(items)
            except Exception:
                pass

    def _flush(self):
        with self._lock:
            self._flush_locked()

    def flush(self):
        with self._lock:
            self._flush_locked()

class ObjectPool:
    """通用对象池。"""
    def __init__(self, factory: Callable[[], T], reset: Optional[Callable[[T], None]] = None,
                 max_size: int = 32):
        self._factory = factory
        self._reset = reset
        self._pool: deque = deque(maxlen=max_size)
        self._lock = threading.Lock()
        self._created = 0

    def acquire(self) -> T:
        with self._lock:
            if self._pool:
                return self._pool.popleft()
            self._created += 1
        return self._factory()

    def release(self, obj: T) -> None:
        if self._reset:
            try:
                self._reset(obj)
            except Exception:
                return
        with self._lock:
            self._pool.append(obj)

    def stats(self) -> Dict[str, int]:
        with self._lock:
            return {"pooled": len(self._pool), "created_total": self._created}

class Debouncer:
    """延迟执行，在连续调用中只执行最后一次。"""
    def __init__(self, delay: float = 0.3):
        self.delay = delay
        self._timer: Optional[threading.Timer] = None
        self._lock = threading.Lock()

    def __call__(self, func: Callable, *args, **kwargs):
        with self._lock:
            if self._timer:
                self._timer.cancel()
            self._timer = threading.Timer(self.delay, func, args=args, kwargs=kwargs)
            self._timer.daemon = True
            self._timer.start()

    def cancel(self):
        with self._lock:
            if self._timer:
                self._timer.cancel()
                self._timer = None

class Throttler:
    """节流：固定时间间隔内最多执行一次。"""
    def __init__(self, interval: float = 1.0):
        self.interval = interval
        self._last = 0.0
        self._lock = threading.Lock()

    def ready(self) -> bool:
        with self._lock:
            now = time.monotonic()
            if now - self._last >= self.interval:
                self._last = now
                return True
            return False

class MemoryGuard:
    """内存守卫：超阈值时自动清理缓存和 GC。"""
    def __init__(self, threshold_mb: int = 1024, check_interval: float = 30.0):
        self.threshold_mb = threshold_mb
        self.check_interval = check_interval
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._cleanups: List[Callable[[], None]] = []

    def register_cleanup(self, func: Callable[[], None]):
        self._cleanups.append(func)

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="mem-guard")
        self._thread.start()

    def stop(self):
        self._stop.set()

    def _run(self):
        while not self._stop.wait(self.check_interval):
            try:
                import psutil
                proc = psutil.Process(os.getpid())
                rss_mb = proc.memory_info().rss / 1024 / 1024
                if rss_mb > self.threshold_mb:
                    gc.collect(2)
                    for c in self._cleanups:
                        try:
                            c()
                        except Exception:
                            pass
            except ImportError:
                # 无 psutil 时定期 GC
                gc.collect(1)

    def current_mb(self) -> float:
        try:
            import psutil
            return round(psutil.Process(os.getpid()).memory_info().rss / 1024 / 1024, 1)
        except Exception:
            return 0.0
