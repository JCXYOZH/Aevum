"""
core/cache.py - TTL/LRU 双层缓存系统

提供内存 LRU 缓存 + TTL 过期 + 缓存预热 + 命中率统计 + 缓存失效事件。
"""
import time
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple
from collections import OrderedDict
from libertas.foundation.event_bus import publish
from libertas.foundation.terminal import terminal


# ================================================================
# LRU 缓存
# ================================================================
class LRUCache:
    """LRU（最近最少使用）缓存"""

    def __init__(self, max_size: int = 1000, ttl: float = 300.0):
        self.max_size = max_size
        self.ttl = ttl
        self._cache: OrderedDict[str, Tuple[Any, float]] = OrderedDict()
        self._lock = threading.RLock()
        self._hits = 0
        self._misses = 0
        self._evictions = 0

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            if key not in self._cache:
                self._misses += 1
                return None
            value, expire_at = self._cache[key]
            if expire_at > 0 and time.time() > expire_at:
                del self._cache[key]
                self._misses += 1
                return None
            self._cache.move_to_end(key)
            self._hits += 1
            return value

    def set(self, key: str, value: Any, ttl: Optional[float] = None):
        with self._lock:
            expire_at = time.time() + (ttl if ttl is not None else self.ttl)
            if key in self._cache:
                self._cache.move_to_end(key)
            self._cache[key] = (value, expire_at)
            while len(self._cache) > self.max_size:
                self._cache.popitem(last=False)
                self._evictions += 1

    def delete(self, key: str) -> bool:
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                return True
            return False

    def has(self, key: str) -> bool:
        with self._lock:
            if key not in self._cache:
                return False
            _, expire_at = self._cache[key]
            if expire_at > 0 and time.time() > expire_at:
                del self._cache[key]
                return False
            return True

    def clear(self):
        with self._lock:
            self._cache.clear()

    def keys(self) -> List[str]:
        with self._lock:
            return list(self._cache.keys())

    def size(self) -> int:
        with self._lock:
            return len(self._cache)

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            total = self._hits + self._misses
            return {
                "size": len(self._cache),
                "max_size": self.max_size,
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate": self._hits / total if total > 0 else 0,
                "evictions": self._evictions,
            }

    def purge_expired(self):
        """清理过期条目"""
        now = time.time()
        with self._lock:
            expired = [k for k, (_, exp) in self._cache.items() if exp > 0 and now > exp]
            for k in expired:
                del self._cache[k]
            return len(expired)


# ================================================================
# TTL 缓存（带命名空间）
# ================================================================
class TTLCache:
    """带命名空间的 TTL 缓存"""

    def __init__(self, default_ttl: float = 300.0, max_entries: int = 10000):
        self.default_ttl = default_ttl
        self.max_entries = max_entries
        self._store: Dict[str, Tuple[Any, float]] = {}
        self._lock = threading.RLock()
        self._hits = 0
        self._misses = 0

    def _make_key(self, namespace: str, key: str) -> str:
        return f"{namespace}:{key}"

    def get(self, namespace: str, key: str) -> Optional[Any]:
        full_key = self._make_key(namespace, key)
        with self._lock:
            item = self._store.get(full_key)
            if item is None:
                self._misses += 1
                return None
            value, expire_at = item
            if time.time() > expire_at:
                del self._store[full_key]
                self._misses += 1
                return None
            self._hits += 1
            return value

    def set(self, namespace: str, key: str, value: Any, ttl: Optional[float] = None):
        full_key = self._make_key(namespace, key)
        expire_at = time.time() + (ttl if ttl is not None else self.default_ttl)
        with self._lock:
            self._store[full_key] = (value, expire_at)
            if len(self._store) > self.max_entries:
                self._purge_oldest()

    def delete(self, namespace: str, key: str) -> bool:
        full_key = self._make_key(namespace, key)
        with self._lock:
            return self._store.pop(full_key, None) is not None

    def invalidate_namespace(self, namespace: str):
        """失效整个命名空间"""
        prefix = f"{namespace}:"
        with self._lock:
            keys_to_delete = [k for k in self._store if k.startswith(prefix)]
            for k in keys_to_delete:
                del self._store[k]
        publish("cache.invalidated", {"namespace": namespace}, "cache")

    def _purge_oldest(self):
        """淘汰最旧的条目"""
        with self._lock:
            sorted_keys = sorted(self._store.keys(), key=lambda k: self._store[k][1])
            to_remove = sorted_keys[:len(self._store) // 4]
            for k in to_remove:
                del self._store[k]

    def clear(self):
        with self._lock:
            self._store.clear()

    def purge_expired(self) -> int:
        now = time.time()
        with self._lock:
            expired = [k for k, (_, exp) in self._store.items() if now > exp]
            for k in expired:
                del self._store[k]
            return len(expired)

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            total = self._hits + self._misses
            return {
                "entries": len(self._store),
                "max_entries": self.max_entries,
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate": self._hits / total if total > 0 else 0,
            }


# ================================================================
# 缓存装饰器
# ================================================================
def cached(namespace: str = "default", ttl: float = 300.0, max_size: int = 1000,
           key_func: Optional[Callable[..., str]] = None):
    """函数结果缓存装饰器"""
    cache = LRUCache(max_size=max_size, ttl=ttl)

    def decorator(func: Callable) -> Callable:
        import functools

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            if key_func:
                key = key_func(*args, **kwargs)
            else:
                key = f"{func.__name__}:{str(args)}:{str(sorted(kwargs.items()))}"
            result = cache.get(key)
            if result is not None:
                return result
            result = func(*args, **kwargs)
            cache.set(key, result, ttl)
            return result

        wrapper._cache = cache
        wrapper._namespace = namespace
        return wrapper
    return decorator


# ================================================================
# 全局缓存管理器
# ================================================================
class CacheManager:
    """全局缓存管理器"""

    def __init__(self):
        self._caches: Dict[str, LRUCache] = {}
        self._ttl_cache = TTLCache()
        self._lock = threading.Lock()
        self._cleanup_interval = 60.0
        self._last_cleanup = 0.0

    def get_cache(self, name: str, max_size: int = 1000, ttl: float = 300.0) -> LRUCache:
        with self._lock:
            if name not in self._caches:
                self._caches[name] = LRUCache(max_size=max_size, ttl=ttl)
            return self._caches[name]

    def get(self, namespace: str, key: str) -> Optional[Any]:
        return self._ttl_cache.get(namespace, key)

    def set(self, namespace: str, key: str, value: Any, ttl: Optional[float] = None):
        self._ttl_cache.set(namespace, key, value, ttl)

    def delete(self, namespace: str, key: str) -> bool:
        return self._ttl_cache.delete(namespace, key)

    def invalidate(self, namespace: str):
        self._ttl_cache.invalidate_namespace(namespace)

    def clear_all(self):
        with self._lock:
            for cache in self._caches.values():
                cache.clear()
        self._ttl_cache.clear()

    def cleanup(self):
        """清理所有缓存中的过期条目"""
        now = time.time()
        if now - self._last_cleanup < self._cleanup_interval:
            return
        self._last_cleanup = now
        with self._lock:
            for name, cache in self._caches.items():
                purged = cache.purge_expired()
                if purged > 0:
                    terminal.debug(f"缓存清理 [{name}]: 清除 {purged} 条过期数据", "cache")
        self._ttl_cache.purge_expired()

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            lru_stats = {name: cache.get_stats() for name, cache in self._caches.items()}
        return {
            "lru_caches": lru_stats,
            "ttl_cache": self._ttl_cache.get_stats(),
        }

    def warmup(self, namespace: str, items: Dict[str, Any], ttl: Optional[float] = None):
        """缓存预热"""
        for key, value in items.items():
            self.set(namespace, key, value, ttl)
        terminal.info(f"缓存预热 [{namespace}]: {len(items)} 条", "cache")


# 全局缓存管理器
_cache_manager = CacheManager()


def get_cache_manager() -> CacheManager:
    return _cache_manager


def cache_get(namespace: str, key: str) -> Optional[Any]:
    return _cache_manager.get(namespace, key)


def cache_set(namespace: str, key: str, value: Any, ttl: Optional[float] = None):
    _cache_manager.set(namespace, key, value, ttl)


def cache_delete(namespace: str, key: str) -> bool:
    return _cache_manager.delete(namespace, key)


def cache_invalidate(namespace: str):
    _cache_manager.invalidate(namespace)


def cache_stats() -> Dict[str, Any]:
    return _cache_manager.get_stats()
