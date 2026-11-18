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
from .crypto import generate_identity_id, generate_license_key, hash_password, verify_license_key, verify_password
from .models import PermissionAction, Role, ACLItem


class AuthTokenMixin:
    """API 令牌与登录会话。"""

    def create_api_token(self, user_id: str, name: str = "",
                         scopes: Optional[List[str]] = None,
                         expires_in: float = 2592000) -> Tuple[bool, str, str]:
        token = secrets.token_hex(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        token_info = {
            "token_hash": token_hash,
            "user_id": user_id,
            "name": name or "API Token",
            "scopes": scopes or ["*"],
            "created_at": time.time(),
            "expires_at": time.time() + expires_in,
            "last_used": 0.0,
            "enabled": True,
        }
        with self._lock:
            self._api_tokens[token_hash] = token_info
            self._save()
        return True, "Token创建成功", token

    def validate_api_token(self, token: str) -> Tuple[bool, Optional[Dict[str, Any]]]:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        info = self._api_tokens.get(token_hash)
        if not info or not info["enabled"]:
            return False, None
        if info["expires_at"] and time.time() > info["expires_at"]:
            return False, None
        info["last_used"] = time.time()
        return True, info

    def revoke_api_token(self, token: str) -> bool:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with self._lock:
            if token_hash in self._api_tokens:
                self._api_tokens[token_hash]["enabled"] = False
                self._save()
                return True
        return False

    def create_session(self, user_id: str, ip_address: str = "",
                       user_agent: str = "", duration: float = 86400) -> str:
        session_id = f"sess_{secrets.token_hex(24)}"
        session = {
            "session_id": session_id,
            "user_id": user_id,
            "ip_address": ip_address,
            "user_agent": user_agent,
            "created_at": time.time(),
            "expires_at": time.time() + duration,
            "last_activity": time.time(),
        }
        with self._lock:
            self._sessions[session_id] = session
            self._save()
        return session_id

    def validate_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        session = self._sessions.get(session_id)
        if not session:
            return None
        if time.time() > session["expires_at"]:
            del self._sessions[session_id]
            self._save()
            return None
        session["last_activity"] = time.time()
        return session

    def destroy_session(self, session_id: str) -> bool:
        with self._lock:
            if session_id in self._sessions:
                del self._sessions[session_id]
                self._save()
                return True
        return False

    def get_audit_log(self, limit: int = 100) -> List[Dict[str, Any]]:
        return list(reversed(self._audit_log[-limit:]))
