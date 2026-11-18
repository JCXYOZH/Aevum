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

from .models import User, UserSession, UserRole, UserStatus
from .storage import UserStorageMixin


class UserManager(UserStorageMixin):
    """用户管理器：注册、登录、会话、角色、权限与统计。"""

    def __init__(self, data_dir: str = ""):
        # 使用独立的users.db
        self.data_dir = data_dir or os.path.join(get_data_dir(), "users")
        os.makedirs(self.data_dir, exist_ok=True)
        self.db_path = os.path.join(self.data_dir, "users.db")
        # 回路独立库：账号和报名分开，整机搬走时不会连账号一起带走。
        self.loop_data_dir = os.path.join(get_data_dir(), "loop")
        os.makedirs(self.loop_data_dir, exist_ok=True)
        self.loop_db_path = os.path.join(self.loop_data_dir, "loop.db")
        self._users: Dict[str, User] = {}
        self._sessions: Dict[str, UserSession] = {}
        self._lock = threading.RLock()
        self._max_failed_logins = 5
        self._lockout_duration = 900  # 15分钟
        self._activity_log: List[Dict[str, Any]] = []
        self._init_db()
        self._init_loop_db()
        self._load()

    def register(self, username: str, password: str, email: str = "",
                 phone: str = "", role: str = "user") -> Tuple[Optional[User], str]:
        """注册用户"""
        with self._lock:
            # 检查用户名
            if username in self._users:
                return None, "用户名已存在"
            # 检查邮箱
            if email:
                for user in self._users.values():
                    if user.email == email and user.user_id.startswith("user_"):
                        return None, "邮箱已被注册"
    
            # 密码强度检查（0.1.5版本标准：至少6个字符）
            if not password or len(password) < 6:
                return None, "密码至少6个字符"
    
            user = User(username, email, role=role)
            user.phone = phone
            user.set_password(password)
            user.status = UserStatus.ACTIVE
            self._users[user.user_id] = user
            self._users[username] = user
            self._save()
            self._log_activity(user.user_id, "register", f"用户注册: {username}")
            terminal.info(f"用户注册成功: {username}", "user")
            return user, "注册成功"

    def _check_password_strength(self, password: str) -> Tuple[int, str]:
        """检查密码强度 (0-4)"""
        score = 0
        if len(password) >= 8:
            score += 1
        if len(password) >= 12:
            score += 1
        if any(c.isupper() for c in password) and any(c.islower() for c in password):
            score += 1
        if any(c.isdigit() for c in password) and any(not c.isalnum() for c in password):
            score += 1
        messages = ["极弱", "弱", "中等", "强", "极强"]
        return score, messages[min(score, 4)]

    def login(self, username: str, password: str, ip: str = "",
              user_agent: str = "") -> Tuple[Optional[UserSession], str]:
        """用户登录"""
        user = self._users.get(username)
        if not user or not user.user_id.startswith("user_"):
            # 尝试通过user_id查找
            for u in self._users.values():
                if u.username == username and u.user_id.startswith("user_"):
                    user = u
                    break
        if not user:
            return None, "用户不存在"
    
        if user.status == UserStatus.BANNED:
            return None, "用户已被封禁"
        if user.status == UserStatus.SUSPENDED:
            return None, "用户已被暂停"
        if user.is_locked():
            return None, f"账户已锁定，请{int((user.locked_until - time.time()) / 60)}分钟后重试"
    
        if not user.verify_password(password):
            user.failed_login_count += 1
            if user.failed_login_count >= self._max_failed_logins:
                user.locked_until = time.time() + self._lockout_duration
                user.failed_login_count = 0
                terminal.warn(f"账户因多次登录失败被锁定: {username}", "user")
            self._save()
            self._log_activity(user.user_id, "login_failed", f"登录失败: {username}")
            return None, "密码错误"
    
        # 登录成功
        user.failed_login_count = 0
        session = self.issue_session(user, ip, user_agent)
        terminal.info(f"用户登录成功: {username}", "user")
        return session, "登录成功"

    def issue_session(self, user: User, ip: str = "",
                      user_agent: str = "") -> UserSession:
        """给已核验身份的用户签发会话。

        密码登录、验证码登录等不同入口都走这里，避免每个入口各写一份
        session 记录逻辑；调用方必须先完成身份核验。
        """
        user.failed_login_count = 0
        user.login_count += 1
        user.last_login = time.time()
        user.last_login_ip = ip
        user.status = UserStatus.ACTIVE
        session = UserSession(user.user_id, ip, user_agent)
        self._sessions[session.session_id] = session
        self._sessions[session.token] = session
        self._save()
        self._log_activity(user.user_id, "login", f"用户登录: {user.username} (IP: {ip})")
        return session

    def logout(self, session_id: str = "") -> bool:
        """用户登出（连坐：同一用户的其它会话一并注销）
    
        原来只按传进来的那一份索引删除，而 login() 会往 _sessions 里写两份
        （session.session_id 和 session.token），于是 session_id 那份一直留着；
        更要命的是同一用户早先登录留下的会话仍然 is_valid()，而
        get_current_username() 取的是「最近活跃的有效会话」—— 结果退出登录后
        它照样返回用户名，/api/current_user 的兼容分支就把用户又报成「已登录」。
        """
        session = self._sessions.get(session_id)
        if session:
            _uid = session.user_id
            session.is_active = False
            self._sessions.pop(session.token, None)
            self._sessions.pop(session.session_id, None)
            self.logout_all(_uid)
            self._log_activity(_uid, "logout", "用户登出")
            try:
                self._save()
            except Exception:
                pass
            return True
        return False

    def logout_all(self, user_id: str = "") -> int:
        """注销某用户的全部会话（user_id 为空则清空所有会话）。
    
        退出登录必须走到这里，否则「最近活跃会话」还会把这个用户算成已登录。
        """
        killed = 0
        for key in list(self._sessions.keys()):
            s = self._sessions.get(key)
            if not s:
                continue
            if user_id and s.user_id != user_id:
                continue
            s.is_active = False
            self._sessions.pop(key, None)
            killed += 1
        if killed:
            try:
                self._save()
            except Exception:
                pass
        return killed

    def validate_session(self, token: str) -> Optional[User]:
        """验证会话token"""
        session = self._sessions.get(token)
        if session and session.is_valid():
            session.refresh()
            user = self._users.get(session.user_id)
            return user
        return None

    def get_user(self, user_id_or_name: str) -> Optional[User]:
        user = self._users.get(user_id_or_name)
        if user and user.user_id.startswith("user_"):
            return user
        # 通过用户名查找
        for u in self._users.values():
            if u.username == user_id_or_name and u.user_id.startswith("user_"):
                return u
        return None

    def update_user(self, user_id: str, **kwargs) -> bool:
        """更新用户信息"""
        user = self.get_user(user_id)
        if not user:
            return False
        for key, value in kwargs.items():
            if hasattr(user, key) and key not in ("user_id", "password_hash", "salt", "created_at"):
                setattr(user, key, value)
        user.updated_at = time.time()
        self._save()
        return True

    def change_password(self, user_id: str, old_password: str,
                        new_password: str) -> Tuple[bool, str]:
        """修改密码"""
        user = self.get_user(user_id)
        if not user:
            return False, "用户不存在"
        if not user.verify_password(old_password):
            return False, "原密码错误"
        strength, msg = self._check_password_strength(new_password)
        if strength < 2:
            return False, f"新密码强度不足: {msg}"
        user.set_password(new_password)
        self._save()
        self._log_activity(user_id, "change_password", "修改密码")
        return True, "密码修改成功"

    def reset_password(self, user_id: str, new_password: str) -> Tuple[bool, str]:
        """重置密码（管理员）"""
        user = self.get_user(user_id)
        if not user:
            return False, "用户不存在"
        user.set_password(new_password)
        self._save()
        return True, "密码重置成功"

    def set_role(self, user_id: str, role: str) -> bool:
        user = self.get_user(user_id)
        if user:
            user.role = role
            user.updated_at = time.time()
            self._save()
            return True
        return False

    def add_permission(self, user_id: str, permission: str) -> bool:
        user = self.get_user(user_id)
        if user and permission not in user.permissions:
            user.permissions.append(permission)
            self._save()
            return True
        return False

    def remove_permission(self, user_id: str, permission: str) -> bool:
        user = self.get_user(user_id)
        if user and permission in user.permissions:
            user.permissions.remove(permission)
            self._save()
            return True
        return False

    def suspend_user(self, user_id: str, reason: str = "") -> bool:
        user = self.get_user(user_id)
        if user:
            user.status = UserStatus.SUSPENDED
            user.updated_at = time.time()
            self._save()
            self._log_activity(user_id, "suspend", f"暂停用户: {reason}")
            return True
        return False

    def ban_user(self, user_id: str, reason: str = "") -> bool:
        user = self.get_user(user_id)
        if user:
            user.status = UserStatus.BANNED
            user.updated_at = time.time()
            self._save()
            self._log_activity(user_id, "ban", f"封禁用户: {reason}")
            return True
        return False

    def activate_user(self, user_id: str) -> bool:
        user = self.get_user(user_id)
        if user and user.status in (UserStatus.SUSPENDED, UserStatus.PENDING):
            user.status = UserStatus.ACTIVE
            user.updated_at = time.time()
            self._save()
            return True
        return False

    def delete_user(self, user_id: str) -> bool:
        user = self.get_user(user_id)
        if user:
            user.status = UserStatus.DELETED
            self._users.pop(user.username, None)
            self._users.pop(user.user_id, None)
            self._save()
            return True
        return False

    def list_users(self, status: str = "", role: str = "",
                    limit: int = 50) -> List[User]:
        users = [u for u in self._users.values() if u.user_id.startswith("user_")]
        if status:
            users = [u for u in users if u.status.value == status]
        if role:
            users = [u for u in users if u.role == role]
        users.sort(key=lambda u: u.created_at, reverse=True)
        return users[:limit]

    def get_user_sessions(self, user_id: str) -> List[UserSession]:
        return [s for s in self._sessions.values()
                if s.user_id == user_id and s.session_id.startswith("sess_")]

    def get_activity_log(self, user_id: str = "", limit: int = 50) -> List[Dict[str, Any]]:
        logs = list(reversed(self._activity_log))
        if user_id:
            logs = [l for l in logs if l.get("user_id") == user_id]
        return logs[:limit]

    def _log_activity(self, user_id: str, action: str, detail: str):
        self._activity_log.append({
            "log_id": f"act_{uuid.uuid4().hex[:6]}",
            "user_id": user_id,
            "action": action,
            "detail": detail,
            "timestamp": time.time(),
        })
        if len(self._activity_log) > 2000:
            self._activity_log = self._activity_log[-1000:]

    def get_stats(self) -> Dict[str, Any]:
        users = [u for u in self._users.values() if u.user_id.startswith("user_")]
        total = len(users)
        active = sum(1 for u in users if u.status == UserStatus.ACTIVE)
        return {
            "total_users": total,
            "active_users": active,
            "suspended": sum(1 for u in users if u.status == UserStatus.SUSPENDED),
            "banned": sum(1 for u in users if u.status == UserStatus.BANNED),
            "pending": sum(1 for u in users if u.status == UserStatus.PENDING),
            "active_sessions": sum(1 for s in self._sessions.values()
                                  if s.is_valid() and s.session_id.startswith("sess_")),
            "total_logins": sum(u.login_count for u in users),
            "by_role": {r: sum(1 for u in users if u.role == r)
                       for r in set(u.role for u in users)},
            "activity_logs": len(self._activity_log),
        }

    def get_current_username(self) -> str:
        """获取当前登录用户名（基于最近的活跃会话）
    
        Returns:
            当前登录用户名，无活跃会话时返回空字符串
        """
        active_sessions = [s for s in self._sessions.values() if s.is_valid()]
        if active_sessions:
            # 取最近活跃的会话
            latest = max(active_sessions, key=lambda s: s.last_active)
            user = self._users.get(latest.user_id)
            if user:
                return user.username
        return ""

    def get_effective_username(self) -> str:
        """获取有效用户名（当前登录用户，无登录时返回默认用户）
    
        Returns:
            有效用户名
        """
        username = self.get_current_username()
        if username:
            return username
        # 无登录会话时返回默认用户
        return "default"
