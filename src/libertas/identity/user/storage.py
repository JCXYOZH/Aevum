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


class UserStorageMixin:
    """用户库、持久化与守护规则读写。"""

    def _init_db(self):
        """初始化用户表（独立users.db）"""
        try:
            conn = sqlite3.connect(self.db_path, timeout=10)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    user_id TEXT PRIMARY KEY,
                    username TEXT UNIQUE,
                    email TEXT DEFAULT '',
                    phone TEXT DEFAULT '',
                    role TEXT DEFAULT 'user',
                    status TEXT DEFAULT 'pending',
                    password_hash TEXT DEFAULT '',
                    salt TEXT DEFAULT '',
                    created_at REAL DEFAULT 0,
                    updated_at REAL DEFAULT 0,
                    last_login REAL DEFAULT 0,
                    last_login_ip TEXT DEFAULT '',
                    login_count INTEGER DEFAULT 0,
                    failed_login_count INTEGER DEFAULT 0,
                    locked_until REAL DEFAULT 0,
                    display_name TEXT DEFAULT '',
                    avatar TEXT DEFAULT '',
                    bio TEXT DEFAULT '',
                    timezone TEXT DEFAULT 'Asia/Shanghai',
                    language TEXT DEFAULT 'zh-CN',
                    email_verified INTEGER DEFAULT 0,
                    mfa_enabled INTEGER DEFAULT 0,
                    mfa_secret TEXT DEFAULT '',
                    preferences TEXT DEFAULT '{}',
                    permissions TEXT DEFAULT '[]',
                    groups TEXT DEFAULT '[]',
                    api_keys TEXT DEFAULT '[]',
                    metadata TEXT DEFAULT '{}',
                    tags TEXT DEFAULT '[]'
                )
            """)
            # 添加缺失的列（兼容旧表）
            alter_cols = [
                ("phone", "TEXT DEFAULT ''"),
                ("last_login_ip", "TEXT DEFAULT ''"),
                ("locked_until", "REAL DEFAULT 0"),
                ("mfa_secret", "TEXT DEFAULT ''"),
                ("preferences", "TEXT DEFAULT '{}'"),
                ("permissions", "TEXT DEFAULT '[]'"),
                ("groups", "TEXT DEFAULT '[]'"),
                ("api_keys", "TEXT DEFAULT '[]'"),
                ("metadata", "TEXT DEFAULT '{}'"),
                ("tags", "TEXT DEFAULT '[]'"),
            ]
            for col, coldef in alter_cols:
                try:
                    conn.execute(f"ALTER TABLE users ADD COLUMN {col} {coldef}")
                except Exception:
                    pass
            conn.commit()
            conn.close()
        except Exception as e:
            terminal.warn(f"初始化用户数据库失败: {e}", "user")

    def _load(self):
        """从数据库加载用户数据"""
        try:
            conn = sqlite3.connect(self.db_path, timeout=10)
            conn.row_factory = sqlite3.Row
            for row in conn.execute("SELECT * FROM users"):
                user = User(
                    username=row["username"] or "",
                    email=row["email"] or "",
                    password_hash=row["password_hash"] or "",
                    role=row["role"] or "user",
                )
                user.user_id = row["user_id"]
                user.salt = row["salt"] or user.salt
                try:
                    user.status = UserStatus(row["status"] or "pending")
                except Exception:
                    user.status = UserStatus.PENDING
                user.phone = row["phone"] or ""
                user.created_at = row["created_at"] or time.time()
                user.last_login = row["last_login"] or 0
                user.login_count = row["login_count"] or 0
                user.failed_login_count = row["failed_login_count"] or 0
                user.display_name = row["display_name"] or ""
                user.avatar = row["avatar"] or ""
                user.bio = row["bio"] or ""
                user.timezone = row["timezone"] or "Asia/Shanghai"
                user.language = row["language"] or "zh-CN"
                user.email_verified = bool(row["email_verified"])
                user.mfa_enabled = bool(row["mfa_enabled"])
                try:
                    user.preferences = json.loads(row["preferences"] or "{}")
                except Exception:
                    user.preferences = {}
                try:
                    user.permissions = json.loads(row["permissions"] or "[]")
                except Exception:
                    user.permissions = []
                try:
                    user.groups = json.loads(row["groups"] or "[]")
                except Exception:
                    user.groups = []
                try:
                    user.api_keys = json.loads(row["api_keys"] or "[]")
                except Exception:
                    user.api_keys = []
                try:
                    user.tags = json.loads(row["tags"] or "[]")
                except Exception:
                    user.tags = []
                self._users[user.user_id] = user
                self._users[user.username] = user
            conn.close()
        except Exception as e:
            terminal.warn(f"加载用户数据失败: {e}", "user")

    def _save(self):
        """保存用户数据到数据库"""
        try:
            conn = sqlite3.connect(self.db_path, timeout=10)
            conn.execute("BEGIN")
            # 只保存user_id索引的用户（避免重复）
            unique_users = {uid: u for uid, u in self._users.items()
                           if uid.startswith("user_")}
            for user in unique_users.values():
                conn.execute("""INSERT OR REPLACE INTO users
                    (user_id, username, email, phone, role, status, password_hash, salt,
                     created_at, updated_at, last_login, last_login_ip,
                     login_count, failed_login_count, locked_until,
                     display_name, avatar, bio, timezone, language,
                     email_verified, mfa_enabled, mfa_secret,
                     preferences, permissions, groups, api_keys, metadata, tags)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (user.user_id, user.username, user.email, user.phone,
                     user.role, user.status.value if hasattr(user.status, 'value') else str(user.status),
                     user.password_hash, user.salt,
                     user.created_at, time.time(), user.last_login,
                     getattr(user, 'last_login_ip', ''),
                     user.login_count, user.failed_login_count,
                     getattr(user, 'locked_until', 0),
                     user.display_name, user.avatar, user.bio,
                     user.timezone, user.language,
                     1 if user.email_verified else 0,
                     1 if user.mfa_enabled else 0,
                     getattr(user, 'mfa_secret', ''),
                     json.dumps(user.preferences, ensure_ascii=False),
                     json.dumps(user.permissions, ensure_ascii=False),
                     json.dumps(user.groups, ensure_ascii=False),
                     json.dumps(user.api_keys, ensure_ascii=False),
                     json.dumps(getattr(user, 'metadata', {}), ensure_ascii=False),
                     json.dumps(user.tags, ensure_ascii=False)))
            conn.commit()
            conn.close()
        except Exception as e:
            terminal.warn(f"保存用户数据失败: {e}", "user")

    def load_rules(self, *args, **kwargs) -> dict:
        """加载守护规则
    
        从数据目录的 rules/guardian_rules.json 读取规则。
        文件不存在时返回空字典，由 GuardianSystem 补全默认结构。
    
        支持多种调用方式：
        - load_rules()
        - load_rules(force_reload=True)
        - load_rules(username)
        - load_rules(username, force_reload=True)
    
        Returns:
            规则字典
        """
        force_reload = False
        username = None
        # 解析位置参数
        if args:
            if isinstance(args[0], bool):
                force_reload = args[0]
            elif isinstance(args[0], str):
                username = args[0]
        # 解析关键字参数
        if 'force_reload' in kwargs:
            force_reload = kwargs['force_reload']
        if 'username' in kwargs:
            username = kwargs['username']
        if not force_reload and hasattr(self, '_cached_rules'):
            return self._cached_rules
    
        rules_dir = os.path.join(get_data_dir(), "rules")
        os.makedirs(rules_dir, exist_ok=True)
        rules_file = os.path.join(rules_dir, "guardian_rules.json")
    
        if os.path.exists(rules_file):
            try:
                with open(rules_file, 'r', encoding='utf-8') as f:
                    self._cached_rules = json.load(f)
            except Exception:
                self._cached_rules = {}
        else:
            self._cached_rules = {}
    
        return self._cached_rules

    def save_rules(self, rules: dict) -> bool:
        """保存守护规则
    
        保存到数据目录的 rules/guardian_rules.json。
    
        Args:
            rules: 规则字典
    
        Returns:
            保存成功返回 True，失败返回 False
        """
        rules_dir = os.path.join(get_data_dir(), "rules")
        os.makedirs(rules_dir, exist_ok=True)
        rules_file = os.path.join(rules_dir, "guardian_rules.json")
    
        try:
            with open(rules_file, 'w', encoding='utf-8') as f:
                json.dump(rules, f, ensure_ascii=False, indent=2)
            self._cached_rules = rules
            return True
        except Exception:
            return False
