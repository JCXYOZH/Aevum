"""职责模块：storage。"""

from __future__ import annotations

from typing import Optional, Dict, List, Tuple, Set, Callable, Any
from ..paths import DEFAULT_DHT_DIR
import asyncio
import json
import os
import time

from .constants import DATA_TTL
from .models import DHTData
from .functions import compute_key
from .constants import logger

class DHTStorage:
    """
    DHT本地存储
    存储内容键值对，支持过期和重发布
    """

    def __init__(self, storage_dir: str = DEFAULT_DHT_DIR):
        self.storage_dir = storage_dir
        self.data: Dict[str, DHTData] = {}
        self._lock = asyncio.Lock()
        os.makedirs(storage_dir, exist_ok=True)
        self._load()

    async def store(self, key: str, value: Any, publisher: str, ttl: int = DATA_TTL) -> bool:
        """存储数据"""
        data_key = compute_key(key)
        data = DHTData(
            key=data_key,
            value=value,
            publisher=publisher,
            ttl=ttl,
        )
        async with self._lock:
            self.data[data_key] = data
        self._save()
        return True

    async def retrieve(self, key: str) -> Optional[Any]:
        """检索数据"""
        data_key = compute_key(key)
        async with self._lock:
            data = self.data.get(data_key)
            if data and not data.is_expired():
                return data.value
            if data and data.is_expired():
                del self.data[data_key]
        return None

    async def remove(self, key: str) -> bool:
        """删除数据"""
        data_key = compute_key(key)
        async with self._lock:
            if data_key in self.data:
                del self.data[data_key]
                self._save()
                return True
        return False

    async def get_keys(self) -> List[str]:
        """获取所有存储的键"""
        async with self._lock:
            return list(self.data.keys())

    async def get_data_count(self) -> int:
        """获取存储数据条数"""
        async with self._lock:
            return len(self.data)

    async def cleanup_expired(self) -> int:
        """清理过期数据"""
        expired = []
        async with self._lock:
            for key, data in self.data.items():
                if data.is_expired():
                    expired.append(key)
            for key in expired:
                del self.data[key]
        if expired:
            self._save()
        return len(expired)

    async def get_data_for_republish(self) -> List[DHTData]:
        """获取需要重发布的数据"""
        now = time.time()
        result = []
        async with self._lock:
            for data in self.data.values():
                # 超过一半TTL的数据需要重发布
                if not data.is_expired() and (now - data.timestamp) > data.ttl / 2:
                    result.append(data)
        return result

    def _save(self):
        """持久化到磁盘"""
        try:
            filepath = os.path.join(self.storage_dir, "dht_store.json")
            data_list = [d.to_dict() for d in self.data.values()]
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data_list, f, ensure_ascii=False)
        except Exception as e:
            logger.error(f"DHT存储持久化失败: {e}")

    def _load(self):
        """从磁盘加载"""
        try:
            filepath = os.path.join(self.storage_dir, "dht_store.json")
            if os.path.exists(filepath):
                with open(filepath, "r", encoding="utf-8") as f:
                    data_list = json.load(f)
                for d in data_list:
                    data = DHTData.from_dict(d)
                    if not data.is_expired():
                        self.data[data.key] = data
        except Exception as e:
            logger.error(f"DHT存储加载失败: {e}")
