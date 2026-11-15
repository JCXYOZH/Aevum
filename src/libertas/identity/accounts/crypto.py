"""账户职责：crypto。"""

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
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from .constants import LICENSE_SECRET
from .constants import LICENSE_VERSION

def generate_license_key(username: str, tier: str = "activated",
                         expires_days: int = 365, issuer: str = "Libertas") -> str:
    """生成许可证密钥（HMAC签名，离线可验证）"""
    payload = {
        "u": username,
        "t": tier,
        "i": issuer,
        "v": LICENSE_VERSION,
        "ts": int(time.time()),
        "exp": int(time.time()) + expires_days * 86400,
        "n": secrets.token_hex(4),
    }
    payload_bytes = json.dumps(payload, sort_keys=True).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload_bytes).decode("ascii").rstrip("=")
    sig = hmac.new(LICENSE_SECRET, payload_bytes, hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).decode("ascii").rstrip("=")
    return f"LIBERTAS-{payload_b64}.{sig_b64}"

def verify_license_key(key: str) -> Dict[str, Any]:
    """验证许可证密钥（离线HMAC签名验证）"""
    try:
        key = key.strip()
        if not key.startswith("LIBERTAS-"):
            return {"valid": False, "error": "密钥格式错误"}
        body = key[6:]
        if "." not in body:
            return {"valid": False, "error": "密钥格式错误"}
        payload_b64, sig_b64 = body.split(".", 1)
        # 补全 padding
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += "=" * padding
        padding = 4 - len(sig_b64) % 4
        if padding != 4:
            sig_b64 += "=" * padding
        payload_bytes = base64.urlsafe_b64decode(payload_b64)
        sig = base64.urlsafe_b64decode(sig_b64)
        expected_sig = hmac.new(LICENSE_SECRET, payload_bytes, hashlib.sha256).digest()
        if not hmac.compare_digest(sig, expected_sig):
            return {"valid": False, "error": "签名验证失败"}
        payload = json.loads(payload_bytes.decode("utf-8"))
        if payload.get("v") != LICENSE_VERSION:
            return {"valid": False, "error": "密钥版本不兼容"}
        if payload.get("exp", 0) < time.time():
            return {"valid": False, "error": "密钥已过期", "payload": payload}
        return {"valid": True, "payload": payload}
    except Exception as e:
        return {"valid": False, "error": f"验证失败: {e}"}

def hash_password(password: str) -> str:
    """密码哈希（PBKDF2-SHA256，10万次迭代）"""
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
    return f"pbkdf2${salt}${h.hex()}"

def verify_password(password: str, stored: str) -> bool:
    """验证密码"""
    try:
        parts = stored.split("$")
        if len(parts) != 3:
            return False
        h = hashlib.pbkdf2_hmac("sha256", password.encode(), parts[1].encode(), 100000)
        return hmac.compare_digest(h.hex(), parts[2])
    except Exception:
        return False
