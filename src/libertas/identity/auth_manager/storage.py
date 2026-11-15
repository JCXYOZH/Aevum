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


class AuthStorageMixin:
    """角色/ACL/令牌/会话数据加载、保存与审计。"""

    def _load(self):
        """从SQLite多表数据库加载认证数据"""
        try:
            conn = sqlite3.connect(self.db_path, timeout=10)
            conn.row_factory = sqlite3.Row
    
            # 加载角色（非系统角色）
            for row in conn.execute("SELECT * FROM roles WHERE is_system = 0"):
                try:
                    role = Role(
                        name=row["name"],
                        description=row["description"] or "",
                        permissions=json.loads(row["permissions"] or "{}"),
                        inherits=json.loads(row["inherits"] or "[]")
                    )
                    self._roles[role.name] = role
                except Exception:
                    pass
    
            # 加载用户角色
            self._user_roles = {}
            for row in conn.execute("SELECT user_id, role_name FROM user_roles"):
                uid = row["user_id"]
                if uid not in self._user_roles:
                    self._user_roles[uid] = []
                self._user_roles[uid].append(row["role_name"])
    
            # 加载ACL
            self._acls = []
            for row in conn.execute("SELECT * FROM acls"):
                try:
                    acl = ACLItem(
                        resource=row["resource"] or "",
                        subject=row["subject"] or "",
                        subject_type=row["subject_type"] or "user",
                        actions=json.loads(row["actions"] or '["*"]'),
                        effect=row["effect"] or "allow"
                    )
                    acl.acl_id = row["acl_id"]
                    acl.enabled = bool(row["enabled"])
                    self._acls.append(acl)
                except Exception:
                    pass
    
            # 加载子用户
            self._sub_users = {}
            for row in conn.execute("SELECT * FROM sub_users"):
                sid = row["id"]
                self._sub_users[sid] = {
                    "id": sid,
                    "name": row["name"] or "",
                    "role": row["role"] or "sub",
                    "identity": json.loads(row["identity"] or "{}"),
                    "active": bool(row["active"]),
                    "created_at": row["created_at"] or 0,
                    "last_active": row["last_active"] or 0,
                }
                # 合并extra字段
                try:
                    extra = json.loads(row["extra"] or "{}")
                    self._sub_users[sid].update(extra)
                except Exception:
                    pass
    
            # 加载活跃子用户
            asu_row = conn.execute("SELECT value FROM system_state WHERE key='active_sub_user'").fetchone()
            self._active_sub_user = asu_row["value"] if asu_row and asu_row["value"] else None
    
            # 加载许可证
            self._licenses = {}
            for row in conn.execute("SELECT * FROM licenses"):
                lk = row["license_key"]
                self._licenses[lk] = {
                    "license_key": lk,
                    "activation_code": row["activation_code"] or "",
                    "username": row["username"] or "",
                    "identity_id": row["identity_id"] or "",
                    "email": row["email"] or "",
                    "phone": row["phone"] or "",
                    "tier": row["tier"] or "registered",
                    "activated": bool(row["activated"]),
                    "created_at": row["created_at"] or 0,
                    "activated_at": row["activated_at"],
                    "ability_value": row["ability_value"] or 0,
                    "contribution_score": row["contribution_score"] or 0,
                    "tasks_completed": row["tasks_completed"] or 0,
                    "tasks_published": row["tasks_published"] or 0,
                    "password_hash": row["password_hash"] or "",
                }
                try:
                    extra = json.loads(row["extra"] or "{}")
                    self._licenses[lk].update(extra)
                except Exception:
                    pass
    
            # 加载API令牌
            self._api_tokens = {}
            for row in conn.execute("SELECT * FROM api_tokens"):
                token = row["token"]
                self._api_tokens[token] = {
                    "token": token,
                    "user_id": row["user_id"] or "",
                    "name": row["name"] or "",
                    "created_at": row["created_at"] or 0,
                    "expires_at": row["expires_at"] or 0,
                    "enabled": bool(row["enabled"]),
                    "last_used": row["last_used"] or 0,
                }
                try:
                    extra = json.loads(row["extra"] or "{}")
                    self._api_tokens[token].update(extra)
                except Exception:
                    pass
    
            # 加载会话
            self._sessions = {}
            for row in conn.execute("SELECT * FROM sessions"):
                sid = row["session_id"]
                self._sessions[sid] = {
                    "session_id": sid,
                    "user_id": row["user_id"] or "",
                    "ip_address": row["ip_address"] or "",
                    "user_agent": row["user_agent"] or "",
                    "created_at": row["created_at"] or 0,
                    "expires_at": row["expires_at"] or 0,
                    "last_active": row["last_active"] or 0,
                }
    
            # 加载审计日志（最近1000条）
            self._audit_log = []
            for row in conn.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1000"):
                self._audit_log.append({
                    "action": row["action"] or "",
                    "subject": row["subject"] or "",
                    "resource": row["resource"] or "",
                    "result": row["result"] or "",
                    "details": row["details"] or "",
                    "created_at": row["created_at"] or 0,
                })
    
            conn.close()
        except Exception as e:
            terminal.warn(f"加载认证数据失败: {e}", "auth_manager")

    def _save(self):
        """保存认证数据到SQLite多表数据库"""
        try:
            conn = sqlite3.connect(self.db_path, timeout=10)
            conn.execute("BEGIN")
    
            # 保存角色（先删后插）
            conn.execute("DELETE FROM roles WHERE is_system = 0")
            for role in self._roles.values():
                if not role.is_system:
                    conn.execute("INSERT OR REPLACE INTO roles (name, description, permissions, inherits, is_system) VALUES (?, ?, ?, ?, 0)",
                        (role.name, role.description or "",
                         json.dumps(role.permissions, ensure_ascii=False),
                         json.dumps(role.inherits or [], ensure_ascii=False)))
    
            # 保存用户角色
            conn.execute("DELETE FROM user_roles")
            for uid, roles in self._user_roles.items():
                for rname in roles:
                    conn.execute("INSERT OR IGNORE INTO user_roles (user_id, role_name) VALUES (?, ?)", (uid, rname))
    
            # 保存ACL
            conn.execute("DELETE FROM acls")
            for acl in self._acls:
                conn.execute("INSERT OR REPLACE INTO acls (acl_id, resource, subject, subject_type, actions, effect, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (acl.acl_id, acl.resource or "", acl.subject or "", acl.subject_type or "user",
                     json.dumps(acl.actions, ensure_ascii=False), acl.effect or "allow", 1 if acl.enabled else 0))
    
            # 保存子用户
            conn.execute("DELETE FROM sub_users")
            for sid, sub in self._sub_users.items():
                # 分离已知字段和extra
                known_keys = {"id", "name", "role", "identity", "active", "created_at", "last_active"}
                extra = {k: v for k, v in sub.items() if k not in known_keys}
                conn.execute("INSERT OR REPLACE INTO sub_users (id, name, role, identity, active, created_at, last_active, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (sid, sub.get("name", ""), sub.get("role", "sub"),
                     json.dumps(sub.get("identity", {}), ensure_ascii=False),
                     1 if sub.get("active", False) else 0,
                     sub.get("created_at", 0), sub.get("last_active", 0),
                     json.dumps(extra, ensure_ascii=False)))
    
            # 保存活跃子用户
            conn.execute("DELETE FROM system_state WHERE key='active_sub_user'")
            if self._active_sub_user:
                conn.execute("INSERT INTO system_state (key, value) VALUES ('active_sub_user', ?)", (self._active_sub_user,))
    
            # 保存许可证
            conn.execute("DELETE FROM licenses")
            for lk, lic in self._licenses.items():
                known_keys = {"license_key", "activation_code", "username", "identity_id", "email", "phone",
                              "tier", "activated", "created_at", "activated_at",
                              "ability_value", "contribution_score", "tasks_completed", "tasks_published",
                              "password_hash"}
                extra = {k: v for k, v in lic.items() if k not in known_keys}
                conn.execute("""INSERT OR REPLACE INTO licenses
                    (license_key, activation_code, username, identity_id, email, phone, tier, activated,
                     created_at, activated_at, ability_value, contribution_score, tasks_completed, tasks_published, password_hash, extra)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (lk, lic.get("activation_code", ""), lic.get("username", ""),
                     lic.get("identity_id", ""), lic.get("email", ""), lic.get("phone", ""),
                     lic.get("tier", "registered"), 1 if lic.get("activated", False) else 0,
                     lic.get("created_at", 0), lic.get("activated_at"),
                     lic.get("ability_value", 0), lic.get("contribution_score", 0),
                     lic.get("tasks_completed", 0), lic.get("tasks_published", 0),
                     lic.get("password_hash", ""),
                     json.dumps(extra, ensure_ascii=False)))
    
            # 保存API令牌
            conn.execute("DELETE FROM api_tokens")
            for token, tok in self._api_tokens.items():
                known_keys = {"token", "user_id", "name", "created_at", "expires_at", "enabled", "last_used"}
                extra = {k: v for k, v in tok.items() if k not in known_keys}
                conn.execute("INSERT OR REPLACE INTO api_tokens (token, user_id, name, created_at, expires_at, enabled, last_used, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (token, tok.get("user_id", ""), tok.get("name", ""),
                     tok.get("created_at", 0), tok.get("expires_at", 0),
                     1 if tok.get("enabled", True) else 0, tok.get("last_used", 0),
                     json.dumps(extra, ensure_ascii=False)))
    
            # 保存会话（可选持久化）
            conn.execute("DELETE FROM sessions")
            for sid, sess in self._sessions.items():
                conn.execute("INSERT OR REPLACE INTO sessions (session_id, user_id, ip_address, user_agent, created_at, expires_at, last_active) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (sid, sess.get("user_id", ""), sess.get("ip_address", ""),
                     sess.get("user_agent", ""), sess.get("created_at", 0),
                     sess.get("expires_at", 0), sess.get("last_active", 0)))
    
            # 保存审计日志（只保存最近500条，避免数据库过大）
            conn.execute("DELETE FROM audit_log")
            for entry in self._audit_log[-500:]:
                conn.execute("INSERT INTO audit_log (action, subject, resource, result, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (entry.get("action", ""), entry.get("subject", ""), entry.get("resource", ""),
                     entry.get("result", ""), entry.get("details", ""), entry.get("created_at", 0)))
    
            conn.commit()
            conn.close()
        except Exception as e:
            terminal.warn(f"保存认证数据失败: {e}", "auth_manager")

    def _audit(self, action: str, subject: str, resource: str, result: str, details: str = ""):
        entry = {
            "timestamp": time.time(),
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "action": action, "subject": subject,
            "resource": resource, "result": result,
            "details": details,
        }
        self._audit_log.append(entry)
        if len(self._audit_log) > 1000:
            self._audit_log = self._audit_log[-500:]
