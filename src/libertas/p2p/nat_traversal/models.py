"""NAT 穿透职责：models。"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import random
import socket
import struct
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from .constants import (
    STUN_PORT, TURN_PORT, STUN_TIMEOUT, HOLE_PUNCH_TIMEOUT,
    HOLE_PUNCH_ATTEMPTS, UPNP_TIMEOUT, RELAY_BUFFER_SIZE, logger,
)


class NATType(Enum):
    UNKNOWN = "unknown"
    OPEN_INTERNET = "open_internet"      # 公网IP，无NAT
    FULL_CONE = "full_cone"              # 全锥型NAT
    RESTRICTED_CONE = "restricted_cone"  # 受限锥型NAT
    PORT_RESTRICTED_CONE = "port_restricted_cone"  # 端口受限锥型NAT
    SYMMETRIC = "symmetric"              # 对称型NAT（最难穿透）
    BLOCKED = "blocked"

@dataclass
class NATTypeDetectionResult:
    """NAT信息"""
    nat_type: str = NATType.UNKNOWN.value
    public_ip: str = ""
    public_port: int = 0
    mapped_ip: str = ""
    mapped_port: int = 0
    filtering_behavior: str = ""  # endpoint-independent/address-dependent/address-port-dependent
    mapping_behavior: str = ""    # endpoint-independent/address-dependent/address-port-dependent
    detected_at: float = 0.0
    stun_server: str = ""

    def to_dict(self) -> Dict:
        return {
            "nat_type": self.nat_type,
            "public_ip": self.public_ip,
            "public_port": self.public_port,
            "filtering_behavior": self.filtering_behavior,
            "mapping_behavior": self.mapping_behavior,
            "detected_at": self.detected_at,
        }

@dataclass
class RelaySession:
    """TURN中继会话"""
    session_id: str
    client_node_id: str
    client_address: Tuple[str, int]
    peer_address: Tuple[str, int]
    allocated_port: int = 0
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    bytes_relayed: int = 0
    packets_relayed: int = 0
    expires_at: float = 0.0

    def is_expired(self) -> bool:
        return time.time() > self.expires_at

    def to_dict(self) -> Dict:
        return {
            "session_id": self.session_id,
            "client_node_id": self.client_node_id,
            "client_address": self.client_address,
            "peer_address": self.peer_address,
            "allocated_port": self.allocated_port,
            "created_at": self.created_at,
            "bytes_relayed": self.bytes_relayed,
            "packets_relayed": self.packets_relayed,
        }

@dataclass
class HolePunchAttempt:
    """打洞尝试记录"""
    target_node_id: str
    target_address: Tuple[str, int]
    local_port: int = 0
    attempts: int = 0
    max_attempts: int = HOLE_PUNCH_ATTEMPTS
    started_at: float = field(default_factory=time.time)
    success: bool = False
    connected_address: Optional[Tuple[str, int]] = None
