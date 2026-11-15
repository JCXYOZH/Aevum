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

from .account import AuthAccountMixin
from .constants import LICENSE_SECRET, LICENSE_VERSION
from .crypto import generate_identity_id, generate_license_key, hash_password, verify_license_key, verify_password
from .database import AuthDatabaseMixin
from .models import PermissionAction, Role, ACLItem
from .roles import AuthRoleMixin
from .storage import AuthStorageMixin
from .subusers import AuthSubUserMixin
from .sync import AuthSyncMixin
from .tokens import AuthTokenMixin


class AuthManager(AuthDatabaseMixin, AuthStorageMixin, AuthRoleMixin, AuthTokenMixin, AuthAccountMixin, AuthSyncMixin, AuthSubUserMixin):
    """统一认证与授权管理器。"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "auth")
        os.makedirs(self.data_dir, exist_ok=True)
        self.db_path = os.path.join(self.data_dir, "auth.db")
        self._init_db()
        self._roles: Dict[str, Role] = {}
        self._user_roles: Dict[str, List[str]] = {}  # user_id -> [role_names]
        self._acls: List[ACLItem] = []
        self._api_tokens: Dict[str, Dict[str, Any]] = {}
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._verification_codes: Dict[str, Dict[str, Any]] = {}
        self._licenses: Dict[str, Dict[str, Any]] = {}
        self._sub_users: Dict[str, Dict[str, Any]] = {}  # sid -> sub_user dict
        self._active_sub_user: Optional[str] = None  # active sub user id
        self._lock = threading.RLock()
        self._audit_log: List[Dict[str, Any]] = []
        self._init_system_roles()
        self._load()

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_roles": len(self._roles),
            "system_roles": sum(1 for r in self._roles.values() if r.is_system),
            "custom_roles": sum(1 for r in self._roles.values() if not r.is_system),
            "total_users_with_roles": len(self._user_roles),
            "total_acls": len(self._acls),
            "active_tokens": sum(1 for t in self._api_tokens.values() if t["enabled"] and time.time() < t["expires_at"]),
            "active_sessions": sum(1 for s in self._sessions.values() if time.time() < s["expires_at"]),
            "audit_entries": len(self._audit_log),
        }
