"""P2P 传输职责：models。"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import socket
import ssl
import struct
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


class ConnectionState(Enum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    HANDSHAKING = "handshaking"
    CONNECTED = "connected"
    CLOSING = "closing"
    CLOSED = "closed"
    ERROR = "error"

class ChannelType(Enum):
    CONTROL = 0      # 控制消息（握手/心跳）
    DHT = 1          # DHT路由消息
    SCAN = 2         # 扫描任务/结果
    DATA = 3         # 数据同步
    REPUTATION = 4   # 信誉消息
    SYNC = 5

@dataclass
class NodeInfo:
    """节点信息"""
    node_id: str  # 160位十六进制字符串（40字符）
    address: str
    port: int
    capabilities: Dict = field(default_factory=dict)
    bandwidth: str = ""
    location: str = ""
    version: str = "1.0.0"
    first_seen: float = 0.0
    last_seen: float = 0.0

    def to_dict(self) -> Dict:
        return {
            "node_id": self.node_id,
            "address": self.address,
            "port": self.port,
            "capabilities": self.capabilities,
            "bandwidth": self.bandwidth,
            "location": self.location,
            "version": self.version,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "NodeInfo":
        return cls(
            node_id=data["node_id"],
            address=data.get("address", ""),
            port=data.get("port", 0),
            capabilities=data.get("capabilities", {}),
            bandwidth=data.get("bandwidth", ""),
            location=data.get("location", ""),
            version=data.get("version", "1.0.0"),
        )

@dataclass
class Message:
    """P2P消息"""
    channel: int  # ChannelType值
    message_type: str  # 消息类型（如PING/SCAN_TASK）
    payload: Dict = field(default_factory=dict)
    message_id: str = ""
    timestamp: float = field(default_factory=time.time)
    ttl: int = 3  # 生存跳数
    source_node: str = ""  # 源节点ID

    def to_dict(self) -> Dict:
        return {
            "channel": self.channel,
            "type": self.message_type,
            "payload": self.payload,
            "message_id": self.message_id,
            "timestamp": self.timestamp,
            "ttl": self.ttl,
            "source": self.source_node,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "Message":
        return cls(
            channel=data.get("channel", 0),
            message_type=data.get("type", ""),
            payload=data.get("payload", {}),
            message_id=data.get("message_id", ""),
            timestamp=data.get("timestamp", time.time()),
            ttl=data.get("ttl", 3),
            source_node=data.get("source", ""),
        )

@dataclass
class ConnectionStats:
    """连接统计"""
    bytes_sent: int = 0
    bytes_received: int = 0
    messages_sent: int = 0
    messages_received: int = 0
    connected_at: float = 0.0
    latency_ms: float = 0.0
    errors: int = 0
