"""职责模块：models。"""

from __future__ import annotations

from typing import Optional, Dict, List, Tuple, Set, Callable, Any
from dataclasses import dataclass, field
import time

from .constants import DATA_TTL

@dataclass
class DHTNodeInfo:
    """DHT 路由表中的节点描述。"""
    node_id: str
    address: str
    port: int
    last_seen: float = field(default_factory=time.time)
    capabilities: Dict = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "node_id": self.node_id,
            "address": self.address,
            "port": self.port,
            "last_seen": self.last_seen,
            "capabilities": self.capabilities,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "DHTNodeInfo":
        return cls(
            node_id=data["node_id"],
            address=data.get("address", ""),
            port=data.get("port", 0),
            last_seen=data.get("last_seen", time.time()),
            capabilities=data.get("capabilities", {}),
        )

@dataclass
class DHTData:
    """DHT存储的数据"""
    key: str
    value: Any
    publisher: str  # 发布者节点ID
    timestamp: float = field(default_factory=time.time)
    ttl: int = DATA_TTL

    def is_expired(self) -> bool:
        return time.time() - self.timestamp > self.ttl

    def to_dict(self) -> Dict:
        return {
            "key": self.key,
            "value": self.value,
            "publisher": self.publisher,
            "timestamp": self.timestamp,
            "ttl": self.ttl,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "DHTData":
        return cls(
            key=data["key"],
            value=data["value"],
            publisher=data.get("publisher", ""),
            timestamp=data.get("timestamp", time.time()),
            ttl=data.get("ttl", DATA_TTL),
        )
