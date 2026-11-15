"""
统一认证与授权管理器

集中管理认证策略、权限矩阵、角色继承、访问控制列表、审计。
"""
import os
import json
import sqlite3
import time
import uuid
import hashlib
import hmac
import secrets
import threading
from typing import Any, Dict, List, Optional, Set, Tuple
import base64
import hmac
import hashlib
import secrets

LICENSE_SECRET = b"Libertas-License-Secret-2026-DoNotShare"
LICENSE_VERSION = 1
from datetime import datetime
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

from .constants import LICENSE_SECRET, LICENSE_VERSION


def hash_password(password: str) -> str:
    import secrets, hashlib
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
    return f"pbkdf2${salt}${h.hex()}"


def verify_password(password: str, stored: str) -> bool:
    import hashlib, hmac
    try:
        parts = stored.split("$")
        if len(parts) != 3:
            return False
        h = hashlib.pbkdf2_hmac("sha256", password.encode(), parts[1].encode(), 100000)
        return hmac.compare_digest(h.hex(), parts[2])
    except Exception:
        return False


def generate_identity_id() -> str:
    return "MH-" + uuid.uuid4().hex.upper()


def generate_license_key(email: str, phone: str, tier: str = "activated",
                         expires_days: int = 1825, issuer: str = "Libertas") -> Dict:
    """用邮箱+手机号作为生成材料，生成唯一许可证密钥和激活码。
    返回 {"license_key": ..., "activation_code": ..., "username": ...}
    """
    material = f"{email.strip().lower()}|{phone.strip()}|{secrets.token_hex(16)}"
    material_hash = hashlib.sha256(material.encode("utf-8")).hexdigest()
    username = "MH" + material_hash[:8].upper()
    payload = {
        "u": username, "e": email.strip().lower(), "p": phone.strip(),
        "t": tier, "i": issuer, "v": LICENSE_VERSION,
        "ts": int(time.time()), "exp": int(time.time()) + expires_days * 86400,
        "n": secrets.token_hex(4),
    }
    payload_bytes = json.dumps(payload, sort_keys=True).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload_bytes).decode("ascii").rstrip("=")
    sig = hmac.new(LICENSE_SECRET, payload_bytes, hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).decode("ascii").rstrip("=")
    license_key = f"LIBERTAS-{payload_b64}.{sig_b64}"
    activation_code = secrets.token_hex(6).upper()
    return {"license_key": license_key, "activation_code": activation_code, "username": username}


def verify_license_key(key: str) -> Dict:
    """验证许可证密钥的签名和有效性"""
    try:
        key = key.strip()
        if not key.startswith("LIBERTAS-"):
            return {"valid": False, "error": "密钥格式错误"}
        body = key[6:]
        if "." not in body:
            return {"valid": False, "error": "密钥格式错误"}
        payload_b64, sig_b64 = body.split(".", 1)
        payload_bytes = base64.urlsafe_b64decode(payload_b64 + "=" * ((4 - len(payload_b64) % 4) % 4))
        sig = base64.urlsafe_b64decode(sig_b64 + "=" * ((4 - len(sig_b64) % 4) % 4))
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


def validate_email(email: str) -> bool:
    import re
    return bool(re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email))


def validate_phone(phone: str) -> bool:
    import re
    return bool(re.match(r'^1[3-9]\d{9}$', phone))
