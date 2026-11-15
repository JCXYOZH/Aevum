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
from libertas.identity.accounts.constants import ACCOUNT_TIERS

from .constants import LICENSE_SECRET, LICENSE_VERSION
from .crypto import generate_identity_id, generate_license_key, hash_password, verify_license_key, verify_password
from .models import PermissionAction, Role, ACLItem


class AuthSyncMixin:
    """用户管理器同步、账号信息与贡献。"""

    def sync_to_user_manager(self, user_manager) -> int:
        """将AuthManager中的许可证用户同步到UserManager
        解析0.1.5格式的密码哈希(pbkdf2$salt$hash)并创建UserManager用户
        返回同步的用户数量
        """
        if not user_manager:
            return 0
        synced = 0
        try:
            for license_key, lic in self._licenses.items():
                username = lic.get("username", "")
                if not username:
                    continue
                # 检查UserManager中是否已存在该用户
                existing = None
                for uid, u in user_manager._users.items():
                    if getattr(u, "username", "") == username:
                        existing = u
                        break
                if existing:
                    continue
                # 解析密码哈希
                pw_hash = lic.get("password_hash", "")
                salt = ""
                final_hash = ""
                if pw_hash:
                    if pw_hash.startswith("pbkdf2$"):
                        parts = pw_hash.split("$", 2)
                        if len(parts) == 3:
                            salt = parts[1]
                            final_hash = parts[2]
                    elif "$" in pw_hash:
                        parts = pw_hash.split("$", 2)
                        if len(parts) >= 2:
                            salt = parts[1] if len(parts) > 1 else ""
                            final_hash = parts[2] if len(parts) > 2 else parts[1]
                    else:
                        final_hash = pw_hash
    
                from libertas.identity.user import User
                user = User(username=username, email=lic.get("email", ""),
                           password_hash=final_hash, role="user")
                user.phone = lic.get("phone", "")
                user.status = "active"
                user.created_at = lic.get("created_at", time.time())
                if salt:
                    user.salt = salt
                user_manager._users[user.user_id] = user
                user_manager._users[username] = user
                synced += 1
                terminal.info(f"同步用户到UserManager: {username}", "auth_manager")
            if synced > 0:
                user_manager._save()
        except Exception as e:
            terminal.warn(f"同步用户到UserManager失败: {e}", "auth_manager")
        return synced

    def get_info(self) -> Dict[str, Any]:
        """获取认证系统信息（匹配0.1.5版本，返回完整用户信息）
        从许可证中提取用户名、许可证、激活码、身份ID等用户信息。
        """
        # 找到许可证（优先已激活的，否则取第一个）
        target_lic = None
        activated_licenses = [v for v in self._licenses.values() if v.get("activated")]
        if activated_licenses:
            target_lic = activated_licenses[0]
        elif self._licenses:
            target_lic = list(self._licenses.values())[0]
    
        # 从许可证提取用户信息
        username = target_lic.get("username", "") if target_lic else ""
        identity_id = target_lic.get("identity_id", "") if target_lic else ""
        email = target_lic.get("email", "") if target_lic else ""
        phone = target_lic.get("phone", "") if target_lic else ""
        tier = target_lic.get("tier", "free") if target_lic else "free"
        activated = bool(target_lic.get("activated", False)) if target_lic else False
        license_key = target_lic.get("license_key", "") if target_lic else ""
        activation_code = target_lic.get("activation_code", "") if target_lic else ""
        created_at_ts = target_lic.get("created_at", time.time()) if target_lic else time.time()
        try:
            created_at = datetime.fromtimestamp(created_at_ts).strftime("%Y-%m-%d")
        except Exception:
            created_at = ""
    
        return {
            # 用户信息（匹配0.1.5版本）
            "identity_id": identity_id,
            "username": username,
            "email": email,
            "phone": phone,
            "tier": tier,
            "activated": activated,
            "ability_value": target_lic.get("ability_value", 0) if target_lic else 0,
            "contribution_score": target_lic.get("contribution_score", 0) if target_lic else 0,
            "tasks_completed": target_lic.get("tasks_completed", 0) if target_lic else 0,
            "tasks_published": target_lic.get("tasks_published", 0) if target_lic else 0,
            "created_at": created_at,
            "license_key": license_key,
            "activation_code": activation_code,
            "features": ACCOUNT_TIERS.get(tier, ACCOUNT_TIERS.get("unregistered", {})).get("features", []),
            # 系统统计（原有）
            "has_license": len(activated_licenses) > 0,
            "total_roles": len(self._roles),
            "users_with_roles": len(self._user_roles),
            "active_sessions": sum(1 for s in self._sessions.values() if time.time() < s["expires_at"]),
            "active_tokens": sum(1 for t in self._api_tokens.values() if t["enabled"] and time.time() < t["expires_at"]),
            "audit_entries": len(self._audit_log),
        }

    def list_contributions(self, limit: int = 50):
        """获取贡献记录列表"""
        try:
            conn = sqlite3.connect(self.db_path, timeout=10)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM contributions ORDER BY completed_at DESC LIMIT ?", (limit,)
            ).fetchall()
            conn.close()
            return [dict(r) for r in rows]
        except Exception:
            return []

    def add_contribution(self, task_title: str, task_description: str, score: int, category: str = 'general'):
        """添加贡献记录并增加贡献分"""
        try:
            cid = uuid.uuid4().hex[:12]
            with self._lock:
                conn = sqlite3.connect(self.db_path, timeout=10)
                conn.execute("BEGIN")
                # 插入贡献记录
                conn.execute(
                    "INSERT INTO contributions (id, task_title, task_description, category, score, completed_at) VALUES (?,?,?,?,?,?)",
                    (cid, task_title, task_description, category, score, time.time())
                )
                # 增加用户的贡献分和能力价值
                conn.execute(
                    "UPDATE licenses SET contribution_score=contribution_score+? WHERE activated=1",
                    (score,)
                )
                conn.commit()
                conn.close()
                # 刷新内存中的许可证数据
                self._load()
            return {"success": True, "contribution_id": cid, "score": score}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def has_main_account(self) -> bool:
        """是否有主账户（向后兼容）
        只要存在任何许可证（包括未激活的）或用户角色，就认为已有主账户。
        注册时会生成许可证（activated=False），所以注册后应返回True。
        """
        return len(self._user_roles) > 0 or len(self._licenses) > 0

    def get_registered_count(self) -> int:
        """获取已注册用户总数（主账户 + 子用户）"""
        main_count = 1 if (len(self._licenses) > 0 or len(self._user_roles) > 0) else 0
        sub_count = len(self._sub_users)
        return main_count + sub_count
