"""职责模块：models。"""

from __future__ import annotations

from typing import Optional, Dict, List, Tuple, Callable, Any, Set
from enum import Enum
from dataclasses import dataclass, field
import hashlib
import uuid

from .constants import CHALLENGE_DIFFICULTY
from .constants import PROTOCOL_VERSION

class MessageType(Enum):
    # 控制通道
    HELLO = "HELLO"
    HELLO_ACK = "HELLO_ACK"
    PING = "PING"
    PONG = "PONG"
    BYE = "BYE"

    # DHT通道
    FIND_NODE = "FIND_NODE"
    FIND_NODE_RESP = "FIND_NODE_RESP"
    FIND_VALUE = "FIND_VALUE"
    FIND_VALUE_RESP = "FIND_VALUE_RESP"
    STORE = "STORE"
    STORE_RESP = "STORE_RESP"

    # 扫描通道
    SCAN_TASK = "SCAN_TASK"
    SCAN_TASK_ACK = "SCAN_TASK_ACK"
    SCAN_RESULT = "SCAN_RESULT"
    TASK_COMPLETE = "TASK_COMPLETE"
    TASK_REJECT = "TASK_REJECT"

    # 数据同步通道
    ASSET_SYNC = "ASSET_SYNC"
    ASSET_SYNC_RESP = "ASSET_SYNC_RESP"
    ASSET_SYNC_REQUEST = "ASSET_SYNC_REQUEST"

    # 信誉通道
    REPUTATION_VOTE = "REPUTATION_VOTE"
    REPUTATION_QUERY = "REPUTATION_QUERY"
    REPUTATION_RESP = "REPUTATION_RESP"

    # 节点交换
    PEER_EXCHANGE = "PEER_EXCHANGE"
    PEER_EXCHANGE_RESP = "PEER_EXCHANGE_RESP"

    # 防滥用
    CHALLENGE = "CHALLENGE"
    CHALLENGE_RESP = "CHALLENGE_RESP"

@dataclass
class NodeCapabilities:
    """节点能力声明"""
    port_scan: bool = True
    service_detect: bool = True
    vuln_verify: bool = False
    weak_password: bool = False
    cdn_bypass: bool = False
    max_concurrent: int = 1000
    max_rate: int = 5000
    max_scan_targets: int = 65536
    storage_capacity_mb: int = 100
    bandwidth: str = "100Mbps"
    location: str = "CN"
    version: str = PROTOCOL_VERSION

    def to_dict(self) -> Dict:
        return {
            "port_scan": self.port_scan,
            "service_detect": self.service_detect,
            "vuln_verify": self.vuln_verify,
            "weak_password": self.weak_password,
            "cdn_bypass": self.cdn_bypass,
            "max_concurrent": self.max_concurrent,
            "max_rate": self.max_rate,
            "max_scan_targets": self.max_scan_targets,
            "storage_capacity_mb": self.storage_capacity_mb,
            "bandwidth": self.bandwidth,
            "location": self.location,
            "version": self.version,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "NodeCapabilities":
        return cls(
            port_scan=data.get("port_scan", True),
            service_detect=data.get("service_detect", True),
            vuln_verify=data.get("vuln_verify", False),
            weak_password=data.get("weak_password", False),
            cdn_bypass=data.get("cdn_bypass", False),
            max_concurrent=data.get("max_concurrent", 1000),
            max_rate=data.get("max_rate", 5000),
            max_scan_targets=data.get("max_scan_targets", 65536),
            storage_capacity_mb=data.get("storage_capacity_mb", 100),
            bandwidth=data.get("bandwidth", "100Mbps"),
            location=data.get("location", "CN"),
            version=data.get("version", PROTOCOL_VERSION),
        )

class ProofOfWork:
    """Hashcash工作量证明"""

    @staticmethod
    def create_challenge() -> str:
        """创建挑战"""
        return uuid.uuid4().hex

    @staticmethod
    def solve(challenge: str, difficulty: int = CHALLENGE_DIFFICULTY) -> Tuple[str, int]:
        """
        求解工作量证明

        Returns:
            (nonce, 尝试次数)
        """
        target = "0" * difficulty
        nonce = 0
        while True:
            data = f"{challenge}:{nonce}".encode()
            hash_result = hashlib.sha256(data).hexdigest()
            if hash_result.startswith(target):
                return str(nonce), nonce
            nonce += 1
            if nonce > 10_000_000:  # 安全上限
                return "", nonce

    @staticmethod
    def verify(challenge: str, nonce: str, difficulty: int = CHALLENGE_DIFFICULTY) -> bool:
        """验证工作量证明"""
        try:
            data = f"{challenge}:{nonce}".encode()
            hash_result = hashlib.sha256(data).hexdigest()
            return hash_result.startswith("0" * difficulty)
        except Exception:
            return False
