"""P2P 安全总控。"""

import asyncio
import json
import time
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from .constants import logger
from .models import SecurityEvent, SessionKey
from .encryption import EndToEndEncryption
from .signer import MessageSigner
from .detector import AttackDetector

class SecurityEngine:
    """P2P安全引擎"""

    def __init__(self, node_id: str, secret_key: Optional[bytes] = None):
        self.node_id = node_id
        self.encryption = EndToEndEncryption(node_id, secret_key)
        self.signer = MessageSigner(node_id, secret_key)
        self.detector = AttackDetector(node_id)
        self._isolated_nodes: Set[str] = set()

    def encrypt_for_peer(self, peer_node_id: str, data: Dict) -> Dict:
        """加密发送给对端的消息"""
        data_bytes = json.dumps(data).encode()
        return self.encryption.encrypt_message(peer_node_id, data_bytes)

    def decrypt_from_peer(self, peer_node_id: str, encrypted: Dict) -> Optional[Dict]:
        """解密来自对端的消息"""
        plaintext = self.encryption.decrypt_message(peer_node_id, encrypted)
        if plaintext:
            try:
                return json.loads(plaintext.decode())
            except (json.JSONDecodeError, UnicodeDecodeError):
                return None
        return None

    def sign_message(self, message: Dict) -> Dict:
        """签名消息"""
        message["signature"] = self.signer.sign(message)
        message["signer"] = self.node_id
        return message

    def verify_message(self, message: Dict) -> bool:
        """验证消息签名"""
        signature = message.get("signature", "")
        signer = message.get("signer", "")
        if not signature or not signer:
            return False
        return self.signer.verify(message, signature, signer)

    def check_incoming_message(self, peer_node_id: str,
                                ip_address: str,
                                message: Dict) -> Tuple[bool, str]:
        """
        检查入站消息安全性

        Returns:
            (是否允许, 原因)
        """
        # 检查是否被隔离
        if peer_node_id in self._isolated_nodes:
            return False, "node_isolated"

        # 速率限制
        if not self.detector.check_rate_limit(peer_node_id):
            return False, "rate_limited"

        # 签名验证
        if "signature" in message:
            if not self.verify_message(message):
                return False, "invalid_signature"

        # 女巫攻击检测
        sybil_event = self.detector.detect_sybil(peer_node_id, ip_address)
        if sybil_event and sybil_event.severity == "high":
            self.isolate_node(peer_node_id, "sybil_attack_suspected")
            return False, "sybil_attack_suspected"

        return True, "ok"

    def isolate_node(self, node_id: str, reason: str):
        """隔离节点"""
        self._isolated_nodes.add(node_id)
        event = SecurityEvent(
            event_type="node_isolated",
            source_node_id=node_id,
            severity="high",
            description=f"节点被隔离: {reason}",
            action_taken="isolated",
        )
        self.detector.record_event(event)
        logger.warning(f"节点 {node_id} 被隔离: {reason}")

    def unisolate_node(self, node_id: str):
        """解除隔离"""
        self._isolated_nodes.discard(node_id)

    def is_isolated(self, node_id: str) -> bool:
        return node_id in self._isolated_nodes

    def rotate_keys(self):
        """轮换密钥"""
        self.encryption.rotate_keys()

    def get_stats(self) -> Dict:
        return {
            "isolated_nodes": len(self._isolated_nodes),
            "session_keys": len(self.encryption.session_keys),
            "security_events": self.detector.get_stats(),
        }
