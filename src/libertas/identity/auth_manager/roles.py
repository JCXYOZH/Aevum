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


class AuthRoleMixin:
    """角色、权限检查与访问控制列表。"""

    def _init_system_roles(self):
        """初始化系统角色"""
        owner = Role("owner", "系统所有者", {"*": ["*"]}, is_system=True)
        admin = Role("admin", "管理员", {"*": ["create", "read", "update", "delete", "execute"]},
                    inherits=["member"], is_system=True)
        member = Role("member", "普通成员",
                     {"tools": ["read", "execute"], "knowledge": ["read", "create", "update"],
                      "profile": ["read", "update"]}, is_system=True)
        guest = Role("guest", "访客", {"tools": ["read"], "knowledge": ["read"]}, is_system=True)
        for role in [owner, admin, member, guest]:
            self._roles[role.name] = role

    def create_role(self, name: str, description: str = "",
                    permissions: Optional[Dict[str, List[str]]] = None,
                    inherits: Optional[List[str]] = None) -> Tuple[bool, str, Optional[Role]]:
        with self._lock:
            if name in self._roles:
                return False, "角色已存在", None
            role = Role(name, description, permissions, inherits)
            self._roles[name] = role
            self._save()
        terminal.info(f"创建角色: {name}", "auth_manager")
        return True, "角色创建成功", role

    def delete_role(self, name: str) -> Tuple[bool, str]:
        with self._lock:
            role = self._roles.get(name)
            if not role:
                return False, "角色不存在"
            if role.is_system:
                return False, "系统角色不可删除"
            # 检查是否有用户使用
            for user_roles in self._user_roles.values():
                if name in user_roles:
                    return False, "有用户正在使用此角色"
            del self._roles[name]
            self._save()
        return True, "角色删除成功"

    def update_role(self, name: str, **kwargs) -> bool:
        role = self._roles.get(name)
        if not role or role.is_system:
            return False
        for k, v in kwargs.items():
            if hasattr(role, k):
                setattr(role, k, v)
        role.updated_at = time.time()
        self._save()
        return True

    def get_role(self, name: str) -> Optional[Role]:
        return self._roles.get(name)

    def list_roles(self) -> List[Role]:
        return list(self._roles.values())

    def assign_role(self, user_id: str, role_name: str) -> bool:
        if role_name not in self._roles:
            return False
        with self._lock:
            self._user_roles.setdefault(user_id, [])
            if role_name not in self._user_roles[user_id]:
                self._user_roles[user_id].append(role_name)
                self._roles[role_name].user_count += 1
                self._save()
        self._audit("assign_role", user_id, role_name, "success")
        return True

    def revoke_role(self, user_id: str, role_name: str) -> bool:
        with self._lock:
            if user_id in self._user_roles and role_name in self._user_roles[user_id]:
                self._user_roles[user_id].remove(role_name)
                if role_name in self._roles:
                    self._roles[role_name].user_count = max(0, self._roles[role_name].user_count - 1)
                self._save()
                self._audit("revoke_role", user_id, role_name, "success")
                return True
        return False

    def get_user_roles(self, user_id: str) -> List[Role]:
        role_names = self._user_roles.get(user_id, [])
        return [self._roles[name] for name in role_names if name in self._roles]

    def check_permission(self, user_id: str, resource: str, action: str) -> Tuple[bool, str]:
        """检查用户权限"""
        # 1. 检查 ACL（deny 优先）
        for acl in self._acls:
            if acl.matches(resource, action, user_id, "user"):
                if acl.effect == "deny":
                    self._audit("check_permission", user_id, f"{resource}:{action}", "denied", "ACL拒绝")
                    return False, "ACL拒绝访问"
        # 2. 检查角色权限
        user_roles = self.get_user_roles(user_id)
        for role in user_roles:
            if role.has_permission(resource, action, self._roles):
                self._audit("check_permission", user_id, f"{resource}:{action}", "allowed", f"角色:{role.name}")
                return True, "允许访问"
        # 3. 检查角色 ACL
        for role in user_roles:
            for acl in self._acls:
                if acl.matches(resource, action, role.name, "role") and acl.effect == "allow":
                    self._audit("check_permission", user_id, f"{resource}:{action}", "allowed", f"角色ACL:{role.name}")
                    return True, "允许访问"
        self._audit("check_permission", user_id, f"{resource}:{action}", "denied", "无权限")
        return False, "没有足够的权限"

    def require_permission(self, user_id: str, resource: str, action: str):
        """权限装饰器辅助"""
        allowed, reason = self.check_permission(user_id, resource, action)
        if not allowed:
            raise PermissionError(f"权限被拒绝: {reason}")

    def get_user_permissions(self, user_id: str) -> Dict[str, List[str]]:
        """获取用户所有权限"""
        result = {}
        for role in self.get_user_roles(user_id):
            perms = role.get_all_permissions(self._roles)
            for resource, actions in perms.items():
                result.setdefault(resource, set()).update(actions)
        return {k: sorted(v) for k, v in result.items()}

    def add_acl(self, resource: str, subject: str, subject_type: str = "user",
                actions: Optional[List[str]] = None, effect: str = "allow") -> str:
        acl = ACLItem(resource, subject, subject_type, actions, effect)
        with self._lock:
            self._acls.append(acl)
            self._save()
        return acl.acl_id

    def remove_acl(self, acl_id: str) -> bool:
        with self._lock:
            for i, acl in enumerate(self._acls):
                if acl.acl_id == acl_id:
                    self._acls.pop(i)
                    self._save()
                    return True
        return False

    def list_acls(self, resource: str = "", subject: str = "") -> List[ACLItem]:
        acls = self._acls
        if resource:
            acls = [a for a in acls if a.resource == resource or a.resource == "*"]
        if subject:
            acls = [a for a in acls if a.subject == subject]
        return acls
