"""职责模块：cache。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple, TypeVar
from collections import OrderedDict, deque
import functools
import threading
import time

from .constants import T
from .constants import _MISSING

_caches: Dict[str, LRUCache] = {}

_caches_lock = threading.Lock()

class LRUCache:
    """带 TTL 的线程安全 LRU 缓存。"""
    __slots__ = ("_cache", "_lock", "_max", "_ttl", "_hits", "_misses")

    def __init__(self, maxsize: int = 512, ttl: float = 300.0):
        self._cache: OrderedDict = OrderedDict()
        self._lock = threading.RLock()
        self._max = maxsize
        self._ttl = ttl
        self._hits = 0
        self._misses = 0

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            item = self._cache.get(key)
            if item is None:
                self._misses += 1
                return default
            value, expire_at = item
            if expire_at and time.monotonic() > expire_at:
                self._cache.pop(key, None)
                self._misses += 1
                return default
            self._cache.move_to_end(key)
            self._hits += 1
            return value

    def set(self, key: str, value: Any, ttl: Optional[float] = None) -> None:
        expire = time.monotonic() + (ttl if ttl is not None else self._ttl)
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
            self._cache[key] = (value, expire)
            while len(self._cache) > self._max:
                self._cache.popitem(last=False)

    def delete(self, key: str) -> None:
        with self._lock:
            self._cache.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()
            self._hits = 0
            self._misses = 0

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            total = self._hits + self._misses
            return {
                "size": len(self._cache),
                "maxsize": self._max,
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate": round(self._hits / total, 3) if total else 0.0,
            }

def get_cache(name: str = "default", maxsize: int = 512, ttl: float = 300.0) -> LRUCache:
    with _caches_lock:
        if name not in _caches:
            _caches[name] = LRUCache(maxsize=maxsize, ttl=ttl)
        return _caches[name]

def cached(ttl: float = 300.0, maxsize: int = 256, cache_name: str = "default"):
    """装饰器：缓存函数返回值。"""
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        cache = get_cache(cache_name, maxsize=maxsize, ttl=ttl)
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            key = f"{func.__module__}.{func.__qualname__}:{args}:{sorted(kwargs.items())}"
            result = cache.get(key, _MISSING)
            if result is not _MISSING:
                return result
            result = func(*args, **kwargs)
            cache.set(key, result)
            return result
        wrapper.cache_clear = cache.clear
        wrapper.cache_stats = cache.stats
        return wrapper
    return decorator
