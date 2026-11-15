"""
用户管理器

用户注册、登录、会话、角色、权限、用户配置、用户活动、用户统计。
"""
import os
import json
import time
import uuid
import hashlib
import hmac
import secrets
import threading
import sqlite3
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


class UserRole(Enum):
    GUEST = "guest"
    USER = "user"
    MEMBER = "member"
    MODERATOR = "moderator"
    ADMIN = "admin"
    OWNER = "owner"
    CREATOR = "creator"

class UserStatus(Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    BANNED = "banned"
    PENDING = "pending"
    DELETED = "deleted"

class UserSession:
    """用户会话"""

    def __init__(self, user_id: str = "", ip: str = "",
                 user_agent: str = "", device: str = ""):
        self.session_id = f"sess_{uuid.uuid4().hex[:16]}"
        self.user_id = user_id
        self.token = secrets.token_hex(32)
        self.ip = ip
        self.user_agent = user_agent
        self.device = device
        self.created_at = time.time()
        self.last_active = time.time()
        self.expires_at = time.time() + 86400  # 24小时
        self.is_active = True
        self.location = ""
        self.metadata: Dict[str, Any] = {}

    def is_valid(self) -> bool:
        return self.is_active and time.time() < self.expires_at

    def refresh(self, duration: int = 86400):
        self.last_active = time.time()
        self.expires_at = time.time() + duration

    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "ip": self.ip,
            "user_agent": self.user_agent,
            "device": self.device,
            "created_at": self.created_at,
            "last_active": self.last_active,
            "expires_at": self.expires_at,
            "is_active": self.is_active,
            "location": self.location,
        }

class User:
    """用户对象"""

    def __init__(self, username: str = "", email: str = "",
                 password_hash: str = "", role: str = "user"):
        self.user_id = f"user_{uuid.uuid4().hex[:8]}"
        self.username = username
        self.email = email
        self.password_hash = password_hash
        self.salt = secrets.token_hex(16)
        self.role = role
        self.status = UserStatus.PENDING
        self.created_at = time.time()
        self.updated_at = time.time()
        self.last_login = 0.0
        self.last_login_ip = ""
        self.login_count = 0
        self.failed_login_count = 0
        self.locked_until = 0.0
        self.display_name = ""
        self.avatar = ""
        self.bio = ""
        self.phone = ""
        self.timezone = "Asia/Shanghai"
        self.language = "zh-CN"
        self.preferences: Dict[str, Any] = {}
        self.permissions: List[str] = []
        self.groups: List[str] = []
        self.api_keys: List[Dict[str, Any]] = []
        self.mfa_enabled = False
        self.mfa_secret = ""
        self.email_verified = False
        self.metadata: Dict[str, Any] = {}
        self.tags: List[str] = []

    def verify_password(self, password: str) -> bool:
        test_hash = hashlib.pbkdf2_hmac(
            'sha256', password.encode(), self.salt.encode(), 100000
        ).hex()
        return hmac.compare_digest(test_hash, self.password_hash)

    def set_password(self, password: str):
        self.salt = secrets.token_hex(16)
        self.password_hash = hashlib.pbkdf2_hmac(
            'sha256', password.encode(), self.salt.encode(), 100000
        ).hex()
        self.updated_at = time.time()

    def has_permission(self, permission: str) -> bool:
        if self.role in ("admin", "owner", "creator"):
            return True
        return permission in self.permissions

    def is_locked(self) -> bool:
        return self.locked_until > time.time()

    def to_dict(self, include_sensitive: bool = False) -> Dict[str, Any]:
        data = {
            "user_id": self.user_id,
            "username": self.username,
            "email": self.email,
            "role": self.role,
            "status": self.status.value,
            "created_at": self.created_at,
            "created_time": datetime.fromtimestamp(self.created_at).strftime("%Y-%m-%d %H:%M:%S"),
            "last_login": self.last_login,
            "login_count": self.login_count,
            "failed_login_count": self.failed_login_count,
            "display_name": self.display_name,
            "avatar": self.avatar,
            "bio": self.bio,
            "timezone": self.timezone,
            "language": self.language,
            "preferences": self.preferences,
            "permissions": self.permissions,
            "groups": self.groups,
            "mfa_enabled": self.mfa_enabled,
            "email_verified": self.email_verified,
            "tags": self.tags,
        }
        if include_sensitive:
            data["password_hash"] = self.password_hash
            data["salt"] = self.salt
            data["phone"] = self.phone
            data["api_keys"] = self.api_keys
        return data
