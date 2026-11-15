"""发布密钥职责：models。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


class KeyType(Enum):
    RELEASE = "release"
    SIGNING = "signing"
    API = "api"
    ENCRYPTION = "encryption"
    DEPLOY = "deploy"

class KeyStatus(Enum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    REVOKED = "revoked"
    EXPIRED = "expired"
    ROTATED = "rotated"

class ReleaseKey:
    """发布密钥"""

    def __init__(self, name: str = "", key_type: str = "release",
                 owner: str = "", description: str = "",
                 permissions: Optional[List[str]] = None,
                 expires_at: float = 0.0,
                 max_uses: int = 0):
        self.key_id = f"key_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.key_type = key_type
        self.owner = owner
        self.description = description
        self.permissions = permissions or ["release:create", "release:sign"]
        self.expires_at = expires_at
        self.max_uses = max_uses
        self.status = KeyStatus.ACTIVE
        self.created_at = time.time()
        self.activated_at = time.time()
        self.revoked_at = 0.0
        self.revoked_by = ""
        self.revocation_reason = ""
        self.use_count = 0
        self.last_used = 0.0
        self.last_used_ip = ""
        self.secret_hash = ""
        self.secret_prefix = ""
        self.rotated_from = ""
        self.rotated_to = ""
        self.ip_whitelist: List[str] = []
        self.metadata: Dict[str, Any] = {}
        self.signatures: List[Dict[str, Any]] = []

    def generate_secret(self) -> str:
        """生成密钥明文（仅返回一次）"""
        secret = f"libertas_{self.key_type}_{secrets.token_hex(32)}"
        self.secret_hash = hashlib.sha256(secret.encode()).hexdigest()
        self.secret_prefix = secret[:12]
        return secret

    def verify_secret(self, secret: str) -> bool:
        return hmac.compare_digest(
            hashlib.sha256(secret.encode()).hexdigest(),
            self.secret_hash
        )

    def is_valid(self) -> bool:
        if self.status != KeyStatus.ACTIVE:
            return False
        if self.expires_at and time.time() > self.expires_at:
            return False
        if self.max_uses and self.use_count >= self.max_uses:
            return False
        return True

    def has_permission(self, permission: str) -> bool:
        return permission in self.permissions or "*" in self.permissions

    def record_use(self, ip: str = ""):
        self.use_count += 1
        self.last_used = time.time()
        self.last_used_ip = ip

    def sign(self, data: str) -> Dict[str, Any]:
        """签名数据"""
        if not self.secret_hash:
            raise ValueError("密钥未生成")
        timestamp = int(time.time())
        nonce = secrets.token_hex(8)
        signature_data = f"{data}:{timestamp}:{nonce}:{self.secret_hash}"
        signature = hmac.new(
            self.secret_hash.encode(),
            signature_data.encode(),
            hashlib.sha256
        ).hexdigest()
        sig_record = {
            "signature_id": f"sig_{uuid.uuid4().hex[:6]}",
            "data_hash": hashlib.sha256(data.encode()).hexdigest()[:16],
            "timestamp": timestamp,
            "nonce": nonce,
            "signature": signature,
            "key_id": self.key_id,
        }
        self.signatures.append(sig_record)
        if len(self.signatures) > 1000:
            self.signatures = self.signatures[-500:]
        return sig_record

    def verify_signature(self, data: str, signature: str,
                         timestamp: int, nonce: str) -> bool:
        """验证签名"""
        if not self.secret_hash:
            return False
        signature_data = f"{data}:{timestamp}:{nonce}:{self.secret_hash}"
        expected = hmac.new(
            self.secret_hash.encode(),
            signature_data.encode(),
            hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, signature)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key_id": self.key_id,
            "name": self.name,
            "key_type": self.key_type,
            "owner": self.owner,
            "description": self.description,
            "permissions": self.permissions,
            "expires_at": self.expires_at,
            "max_uses": self.max_uses,
            "status": self.status.value,
            "created_at": self.created_at,
            "created_time": datetime.fromtimestamp(self.created_at).strftime("%Y-%m-%d %H:%M:%S"),
            "revoked_at": self.revoked_at,
            "use_count": self.use_count,
            "last_used": self.last_used,
            "secret_prefix": self.secret_prefix,
            "rotated_from": self.rotated_from,
            "rotated_to": self.rotated_to,
            "ip_whitelist": self.ip_whitelist,
            "signature_count": len(self.signatures),
        }
