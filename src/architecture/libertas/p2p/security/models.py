"""P2P 安全数据结构。"""

import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from .constants import SESSION_KEY_TTL

@dataclass
class SessionKey:
    """会话密钥"""
    peer_node_id: str
    key: bytes
    created_at: float = field(default_factory=time.time)
    last_used: float = field(default_factory=time.time)
    message_count: int = 0

    def is_expired(self) -> bool:
        return time.time() - self.created_at > SESSION_KEY_TTL

    def should_rotate(self) -> bool:
        return self.is_expired() or self.message_count > 100000

@dataclass
class SecurityEvent:
    """安全事件"""
    event_type: str  # sybil_attack/eclipse_attack/ddos/data_poisoning/spoofing
    source_node_id: str
    severity: str  # low/medium/high/critical
    description: str
    timestamp: float = field(default_factory=time.time)
    evidence: Dict = field(default_factory=dict)
    action_taken: str = ""
