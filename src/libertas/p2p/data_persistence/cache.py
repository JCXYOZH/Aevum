"""职责模块：cache。"""

from __future__ import annotations

from typing import Optional, Dict, List, Tuple, Set, Callable, Any
import asyncio
import time

from .constants import CACHE_MAX_ENTRIES
from .models import CacheEntry

class DHTCache:
    """
    DHT查询缓存
    加速重复查询，减少网络流量
    """

    def __init__(self, max_entries: int = CACHE_MAX_ENTRIES):
        self.max_entries = max_entries
        self._cache: Dict[str, CacheEntry] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Optional[Any]:
        """获取缓存"""
        async with self._lock:
            entry = self._cache.get(key)
            if entry and not entry.is_expired():
                entry.access_count += 1
                entry.last_accessed = time.time()
                return entry.value
            if entry and entry.is_expired():
                del self._cache[key]
            return None

    async def set(self, key: str, value: Any):
        """设置缓存"""
        async with self._lock:
            if len(self._cache) >= self.max_entries:
                # 淘汰最久未访问的
                oldest_key = min(self._cache.keys(),
                                 key=lambda k: self._cache[k].last_accessed)
                del self._cache[oldest_key]
            self._cache[key] = CacheEntry(key=key, value=value)

    async def invalidate(self, key: str):
        """使缓存失效"""
        async with self._lock:
            self._cache.pop(key, None)

    async def clear(self):
        """清空缓存"""
        async with self._lock:
            self._cache.clear()

    def get_stats(self) -> Dict:
        return {
            "entries": len(self._cache),
            "max_entries": self.max_entries,
            "hit_rate": 0.0,  # 需要统计
        }
