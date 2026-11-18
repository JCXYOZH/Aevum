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


class AuthSubUserMixin:
    """子用户增删改查与当前子用户切换。"""

    def add_sub_user(self, name: str, role: str = "sub", identity: Optional[Dict] = None,
                     owner_user_id: str = "") -> Dict:
        """添加子用户（身份档案）；owner_user_id 是它所属的登录账号。"""
        sid = uuid.uuid4().hex[:10]
        with self._lock:
            self._sub_users[sid] = {
                "id": sid, "name": name, "role": role,
                "identity": identity or {},
                "owner_user_id": str(owner_user_id or ""),
                "active": False,
                "created_at": time.time(),
                "last_active": 0,
            }
            self._save()
        self._audit("add_sub_user", sid, name, "success")
        return {"success": True, "sub_id": sid, "name": name}

    def update_sub_user_identity(self, sid: str, identity: Dict) -> bool:
        """更新子用户身份配置"""
        with self._lock:
            if sid in self._sub_users:
                self._sub_users[sid]["identity"] = identity
                self._sub_users[sid]["updated_at"] = time.time()
                self._save()
                return True
        return False

    def update_sub_user_extra(self, sid: str, **fields: Any) -> bool:
        """更新子用户的附加字段（登录名、所属账号等）。"""
        with self._lock:
            if sid not in self._sub_users:
                return False
            for key, value in fields.items():
                if key in {"identity", "id", "created_at"}:
                    continue
                self._sub_users[sid][key] = value
            self._save()
            return True

    def set_active_sub_user(self, sid: str) -> bool:
        """设置活跃子用户（身份档案），sid为空则取消"""
        with self._lock:
            for s in self._sub_users.values():
                s["active"] = False
            if sid and sid in self._sub_users:
                self._sub_users[sid]["active"] = True
                self._sub_users[sid]["last_active"] = time.time()
                self._active_sub_user = sid
            else:
                self._active_sub_user = None
            self._save()
        return True

    def get_active_sub_user(self) -> Optional[Dict]:
        """获取当前活跃子用户"""
        with self._lock:
            if self._active_sub_user and self._active_sub_user in self._sub_users:
                return dict(self._sub_users[self._active_sub_user])
        return None

    def list_sub_users(self, owner_user_id: Optional[str] = None) -> List[Dict]:
        """列出子用户；给 owner_user_id 时只返回该账号名下的档案。"""
        with self._lock:
            users = [dict(s) for s in self._sub_users.values()]
            if owner_user_id is not None:
                users = [s for s in users if str(s.get("owner_user_id", "")) == str(owner_user_id)]
            users.sort(key=lambda x: x.get("created_at", 0), reverse=True)
            return users

    def get_sub_user(self, sid: str) -> Optional[Dict]:
        """按 id 取子用户副本。"""
        with self._lock:
            sub = self._sub_users.get(sid)
            return dict(sub) if sub else None

    def delete_sub_user(self, sid: str) -> bool:
        """删除子用户"""
        with self._lock:
            if sid in self._sub_users:
                del self._sub_users[sid]
                if self._active_sub_user == sid:
                    self._active_sub_user = None
                self._save()
                return True
        return False
