"""职责模块：models。"""

from __future__ import annotations

from typing import Optional, Dict, List, Tuple, Set, Callable, Any
from dataclasses import dataclass, field
import time

from .constants import CACHE_TTL

@dataclass
class VersionVector:
    """版本向量"""
    counters: Dict[str, int] = field(default_factory=dict)

    def increment(self, node_id: str):
        self.counters[node_id] = self.counters.get(node_id, 0) + 1

    def get(self, node_id: str) -> int:
        return self.counters.get(node_id, 0)

    def merge(self, other: "VersionVector") -> "VersionVector":
        """合并两个版本向量（取最大值）"""
        merged = VersionVector()
        all_nodes = set(self.counters.keys()) | set(other.counters.keys())
        for node in all_nodes:
            merged.counters[node] = max(self.get(node), other.get(node))
        return merged

    def dominates(self, other: "VersionVector") -> bool:
        """判断当前版本向量是否支配另一个（所有计数器>=）"""
        all_nodes = set(self.counters.keys()) | set(other.counters.keys())
        for node in all_nodes:
            if self.get(node) < other.get(node):
                return False
        return True

    def concurrent(self, other: "VersionVector") -> bool:
        """判断是否并发（互不支配）"""
        return not self.dominates(other) and not other.dominates(self)

    def to_dict(self) -> Dict:
        return dict(self.counters)

    @classmethod
    def from_dict(cls, data: Dict) -> "VersionVector":
        vv = cls()
        vv.counters = dict(data)
        return vv

@dataclass
class SyncSession:
    """同步会话"""
    session_id: str
    peer_node_id: str
    direction: str  # "push" / "pull" / "both"
    started_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    items_synced: int = 0
    items_total: int = 0
    bytes_transferred: int = 0
    status: str = "active"  # active/completed/failed
    error: str = ""
    checkpoint: str = ""  # 断点续传检查点

    def to_dict(self) -> Dict:
        return {
            "session_id": self.session_id,
            "peer_node_id": self.peer_node_id,
            "direction": self.direction,
            "started_at": self.started_at,
            "items_synced": self.items_synced,
            "items_total": self.items_total,
            "bytes_transferred": self.bytes_transferred,
            "status": self.status,
            "checkpoint": self.checkpoint,
        }

@dataclass
class CacheEntry:
    """缓存条目"""
    key: str
    value: Any
    created_at: float = field(default_factory=time.time)
    access_count: int = 0
    last_accessed: float = field(default_factory=time.time)

    def is_expired(self) -> bool:
        return time.time() - self.created_at > CACHE_TTL
