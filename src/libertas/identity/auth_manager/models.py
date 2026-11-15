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


class PermissionAction(Enum):
    CREATE = "create"
    READ = "read"
    UPDATE = "update"
    DELETE = "delete"
    EXECUTE = "execute"
    ADMIN = "admin"
    APPROVE = "approve"
    PUBLISH = "publish"

class Role:
    """角色"""

    def __init__(self, name: str = "", description: str = "",
                 permissions: Optional[Dict[str, List[str]]] = None,
                 inherits: Optional[List[str]] = None,
                 is_system: bool = False):
        self.role_id = f"role_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.description = description
        self.permissions = permissions or {}  # {resource: [actions]}
        self.inherits = inherits or []
        self.is_system = is_system
        self.created_at = time.time()
        self.updated_at = time.time()
        self.user_count = 0

    def has_permission(self, resource: str, action: str, all_roles: Dict[str, "Role"]) -> bool:
        """检查权限（含继承）"""
        # 检查自身权限
        if resource in self.permissions:
            actions = self.permissions[resource]
            if action in actions or "*" in actions:
                return True
        # 检查通配资源
        if "*" in self.permissions:
            if action in self.permissions["*"] or "*" in self.permissions["*"]:
                return True
        # 检查继承
        for parent_name in self.inherits:
            parent = all_roles.get(parent_name)
            if parent and parent.has_permission(resource, action, all_roles):
                return True
        return False

    def get_all_permissions(self, all_roles: Dict[str, "Role"]) -> Dict[str, Set[str]]:
        """获取所有权限（含继承）"""
        result = {}
        for resource, actions in self.permissions.items():
            result.setdefault(resource, set()).update(actions)
        for parent_name in self.inherits:
            parent = all_roles.get(parent_name)
            if parent:
                parent_perms = parent.get_all_permissions(all_roles)
                for resource, actions in parent_perms.items():
                    result.setdefault(resource, set()).update(actions)
        return result

    def to_dict(self) -> Dict[str, Any]:
        return {
            "role_id": self.role_id, "name": self.name,
            "description": self.description,
            "permissions": self.permissions,
            "inherits": self.inherits,
            "is_system": self.is_system,
            "created_at": self.created_at,
            "user_count": self.user_count,
        }

class ACLItem:
    """访问控制列表条目"""

    def __init__(self, resource: str = "", subject: str = "",
                 subject_type: str = "user",  # user / role / group
                 actions: Optional[List[str]] = None,
                 effect: str = "allow",  # allow / deny
                 conditions: Optional[Dict[str, Any]] = None):
        self.acl_id = f"acl_{uuid.uuid4().hex[:8]}"
        self.resource = resource
        self.subject = subject
        self.subject_type = subject_type
        self.actions = actions or ["*"]
        self.effect = effect
        self.conditions = conditions or {}
        self.created_at = time.time()
        self.enabled = True

    def matches(self, resource: str, action: str, subject: str, subject_type: str) -> bool:
        if not self.enabled:
            return False
        if self.subject != subject and self.subject != "*":
            return False
        if self.subject_type != subject_type:
            return False
        if self.resource != resource and self.resource != "*":
            # 支持前缀匹配
            if not self.resource.endswith("*") or not resource.startswith(self.resource[:-1]):
                return False
        if action not in self.actions and "*" not in self.actions:
            return False
        return True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "acl_id": self.acl_id, "resource": self.resource,
            "subject": self.subject, "subject_type": self.subject_type,
            "actions": self.actions, "effect": self.effect,
            "conditions": self.conditions, "enabled": self.enabled,
            "created_at": self.created_at,
        }
