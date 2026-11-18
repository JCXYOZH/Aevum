"""消息签名。"""

import hashlib
import hmac
import time
from typing import Dict, Optional, Tuple

from .constants import MAX_MESSAGE_AGE, logger
from .models import SecurityEvent

class MessageSigner:
    """消息签名与验证"""

    def __init__(self, node_id: str, secret_key: Optional[bytes] = None):
        self.node_id = node_id
        self.signing_key = secret_key or hashlib.sha256(f"{node_id}:signing".encode()).digest()

    def sign(self, message_data: Dict) -> str:
        """签名消息"""
        # 确保消息包含时间戳和nonce
        if "timestamp" not in message_data:
            message_data["timestamp"] = time.time()
        if "nonce" not in message_data:
            message_data["nonce"] = os.urandom(8).hex()

        # 计算签名
        message_str = json.dumps(message_data, sort_keys=True)
        signature = hmac.new(
            self.signing_key,
            message_str.encode(),
            hashlib.sha256
        ).hexdigest()

        return signature

    def verify(self, message_data: Dict, signature: str, signer_node_id: str) -> bool:
        """验证消息签名"""
        try:
            # 检查消息年龄
            msg_time = message_data.get("timestamp", 0)
            if abs(time.time() - msg_time) > MAX_MESSAGE_AGE:
                logger.warning(f"消息过期: {signer_node_id}")
                return False

            # 重新计算签名
            verify_data = {k: v for k, v in message_data.items() if k != "signature"}
            message_str = json.dumps(verify_data, sort_keys=True)

            # 使用签名者的公钥（简化版：节点ID派生）
            verifier_key = hashlib.sha256(f"{signer_node_id}:signing".encode()).digest()
            expected_signature = hmac.new(
                verifier_key,
                message_str.encode(),
                hashlib.sha256
            ).hexdigest()

            return hmac.compare_digest(signature, expected_signature)

        except Exception as e:
            logger.debug(f"签名验证失败: {e}")
            return False
