"""职责模块：cache。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, Union
import hashlib
import json
import threading
import time

class ToolResultCache:
    """工具执行结果缓存 - 避免重复执行相同参数的工具"""

    def __init__(self, max_entries: int = 100, ttl_seconds: float = 300.0):
        self.max_entries = max_entries
        self.ttl_seconds = ttl_seconds
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()
        self.hits = 0
        self.misses = 0

    def _make_key(self, tool_name: str, parameters: Dict) -> str:
        """生成缓存键"""
        import hashlib
        param_str = json.dumps(parameters, sort_keys=True, default=str)
        raw = f"{tool_name}:{param_str}"
        return hashlib.md5(raw.encode()).hexdigest()

    def get(self, tool_name: str, parameters: Dict) -> Optional["ToolResult"]:
        """获取缓存结果，过期返回None"""
        key = self._make_key(tool_name, parameters)
        with self._lock:
            entry = self._cache.get(key)
            if not entry:
                self.misses += 1
                return None
            age = time.time() - entry["timestamp"]
            if age > self.ttl_seconds:
                del self._cache[key]
                self.misses += 1
                return None
            self.hits += 1
            result = entry["result"]
            result.from_cache = True
            result.cache_age_seconds = age
            return result

    def put(self, tool_name: str, parameters: Dict, result: "ToolResult"):
        """存入缓存"""
        if result.status != "success":
            return
        key = self._make_key(tool_name, parameters)
        with self._lock:
            if len(self._cache) >= self.max_entries:
                oldest_key = min(self._cache, key=lambda k: self._cache[k]["timestamp"])
                del self._cache[oldest_key]
            self._cache[key] = {"result": result, "timestamp": time.time()}

    def invalidate(self, tool_name: str = "", parameters: Dict = None):
        """失效缓存"""
        with self._lock:
            if tool_name and parameters:
                key = self._make_key(tool_name, parameters)
                self._cache.pop(key, None)
            elif tool_name:
                keys_to_remove = [k for k, v in self._cache.items()
                                  if v["result"].tool_name == tool_name]
                for k in keys_to_remove:
                    del self._cache[k]
            else:
                self._cache.clear()

    def get_stats(self) -> Dict[str, Any]:
        """获取缓存统计"""
        with self._lock:
            total = self.hits + self.misses
            return {
                "total_requests": total,
                "hits": self.hits,
                "misses": self.misses,
                "hit_rate": self.hits / total if total > 0 else 0,
                "cached_entries": len(self._cache),
                "max_entries": self.max_entries,
                "ttl_seconds": self.ttl_seconds,
            }

    def clear_expired(self):
        """清理过期缓存"""
        now = time.time()
        with self._lock:
            expired = [k for k, v in self._cache.items()
                       if now - v["timestamp"] > self.ttl_seconds]
            for k in expired:
                del self._cache[k]
            return len(expired)
