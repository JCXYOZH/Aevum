"""端到端加密。"""

import hashlib
import hmac
import os
import struct
import time
from collections import deque
from typing import Dict, List, Optional, Set, Tuple

from .constants import NONCE_TTL, SESSION_KEY_TTL, logger
from .models import SessionKey

class EndToEndEncryption:
    """
    端到端加密引擎
    使用HMAC-SHA256进行消息认证，AES进行加密（如果可用）
    """

    def __init__(self, node_id: str, secret_key: Optional[bytes] = None):
        self.node_id = node_id
        self.master_key = secret_key or hashlib.sha256(node_id.encode()).digest()
        self.session_keys: Dict[str, SessionKey] = {}
        self._used_nonces: Set[str] = set()
        self._nonce_timestamps: deque = deque()

    def _derive_session_key(self, peer_node_id: str) -> bytes:
        """派生会话密钥"""
        # 使用ECDH风格的密钥派生（简化版：主密钥+对端ID）
        key_material = self.master_key + peer_node_id.encode()
        return hashlib.pbkdf2_hmac("sha256", key_material, b"libertas_p2p", 100000)

    def get_session_key(self, peer_node_id: str) -> SessionKey:
        """获取或创建会话密钥"""
        if peer_node_id not in self.session_keys or self.session_keys[peer_node_id].should_rotate():
            key = self._derive_session_key(peer_node_id)
            self.session_keys[peer_node_id] = SessionKey(
                peer_node_id=peer_node_id, key=key
            )
        return self.session_keys[peer_node_id]

    def encrypt_message(self, peer_node_id: str, data: bytes) -> Dict:
        """
        加密消息

        Returns:
            {"ciphertext": ..., "nonce": ..., "mac": ...}
        """
        session = self.get_session_key(peer_node_id)
        nonce = os.urandom(16)

        # XOR流加密（简化版，实际应使用AES-GCM）
        keystream = hashlib.sha256(session.key + nonce).digest()
        while len(keystream) < len(data):
            keystream += hashlib.sha256(session.key + nonce + len(keystream).to_bytes(4, 'big')).digest()

        ciphertext = bytes(a ^ b for a, b in zip(data, keystream[:len(data)]))

        # HMAC认证
        mac = hmac.new(session.key, nonce + ciphertext, hashlib.sha256).hexdigest()

        session.message_count += 1
        session.last_used = time.time()

        return {
            "ciphertext": ciphertext.hex(),
            "nonce": nonce.hex(),
            "mac": mac,
            "encrypted": True,
        }

    def decrypt_message(self, peer_node_id: str, encrypted: Dict) -> Optional[bytes]:
        """
        解密消息

        Returns:
            解密后的明文，验证失败返回None
        """
        try:
            session = self.get_session_key(peer_node_id)
            nonce = bytes.fromhex(encrypted["nonce"])
            ciphertext = bytes.fromhex(encrypted["ciphertext"])
            mac = encrypted["mac"]

            # 验证HMAC
            expected_mac = hmac.new(session.key, nonce + ciphertext, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(mac, expected_mac):
                logger.warning(f"消息MAC验证失败: {peer_node_id}")
                return None

            # XOR解密
            keystream = hashlib.sha256(session.key + nonce).digest()
            while len(keystream) < len(ciphertext):
                keystream += hashlib.sha256(session.key + nonce + len(keystream).to_bytes(4, 'big')).digest()

            plaintext = bytes(a ^ b for a, b in zip(ciphertext, keystream[:len(ciphertext)]))

            session.message_count += 1
            session.last_used = time.time()

            return plaintext

        except Exception as e:
            logger.debug(f"消息解密失败: {e}")
            return None

    def rotate_keys(self):
        """轮换所有会话密钥"""
        self.session_keys.clear()
        logger.info("会话密钥已轮换")
