"""
身份认证与任务贡献系统

融合两个版本的优点：
- 使用SQLite持久化（吸收0.1.5，7张表）
- 保留身份档案（等级/经验/徽章/技能/连续天数）
- 吸收主账户/子用户系统、任务系统、联系人系统
- 吸收密码哈希（PBKDF2 + salt）、验证码验证
- 唯一主账户（每人一份），可创建子用户但仅主用户可使用工具
- 任务系统：发布任务需支付能力价值，完成任务获得贡献分
"""
import os
import json
import time
import uuid
import hmac
import hashlib
import secrets
import sqlite3
import threading
from enum import Enum
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta
from libertas.foundation.config import get_data_dir


# ============================================================

from .crypto import generate_identity_id, hash_password, verify_password
from .models import IdentityProfile


class IdentityAccountMixin:
    """数据库、主账户注册登录与身份验证。"""

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        """初始化数据库（7张表）"""
        with self._lock, self._get_conn() as conn:
            # 主账户表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS main_account (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    identity_id TEXT UNIQUE NOT NULL,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    email TEXT DEFAULT '',
                    phone TEXT DEFAULT '',
                    ability_value INTEGER DEFAULT 100,
                    contribution_score INTEGER DEFAULT 0,
                    tasks_completed INTEGER DEFAULT 0,
                    tasks_published INTEGER DEFAULT 0,
                    verified INTEGER DEFAULT 0,
                    level INTEGER DEFAULT 1,
                    exp INTEGER DEFAULT 0,
                    badges TEXT DEFAULT '[]',
                    skills TEXT DEFAULT '{}',
                    streak INTEGER DEFAULT 0,
                    last_active REAL,
                    created_at REAL NOT NULL,
                    last_login REAL
                )
            """)
            # 子用户表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sub_users (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    role TEXT DEFAULT 'sub',
                    created_at REAL NOT NULL,
                    last_active REAL
                )
            """)
            # 任务表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    category TEXT DEFAULT 'general',
                    reward INTEGER DEFAULT 10,
                    status TEXT DEFAULT 'open',
                    assignee_id TEXT DEFAULT '',
                    created_at REAL NOT NULL,
                    assigned_at REAL,
                    completed_at REAL,
                    verification_code TEXT DEFAULT ''
                )
            """)
            # 贡献记录表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS contributions (
                    id TEXT PRIMARY KEY,
                    identity_id TEXT DEFAULT '',
                    contribution_type TEXT DEFAULT 'other',
                    task_title TEXT DEFAULT '',
                    task_description TEXT DEFAULT '',
                    description TEXT DEFAULT '',
                    category TEXT DEFAULT 'general',
                    score INTEGER DEFAULT 0,
                    points INTEGER DEFAULT 0,
                    completed_at REAL NOT NULL,
                    metadata TEXT DEFAULT '{}'
                )
            """)
            # 联系人表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS contacts (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    identity_id TEXT DEFAULT '',
                    public_key TEXT DEFAULT '',
                    note TEXT DEFAULT '',
                    added_at REAL NOT NULL,
                    trusted INTEGER DEFAULT 0
                )
            """)
            # 身份档案表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS identity_profiles (
                    identity_id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    display_name TEXT DEFAULT '',
                    level INTEGER DEFAULT 1,
                    exp INTEGER DEFAULT 0,
                    contribution_score INTEGER DEFAULT 0,
                    badges TEXT DEFAULT '[]',
                    skills TEXT DEFAULT '{}',
                    streak INTEGER DEFAULT 0,
                    last_active REAL,
                    created_at REAL NOT NULL,
                    settings TEXT DEFAULT '{}'
                )
            """)
            # 验证码表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS verification_codes (
                    id TEXT PRIMARY KEY,
                    code TEXT NOT NULL,
                    purpose TEXT DEFAULT '',
                    identity_id TEXT DEFAULT '',
                    created_at REAL NOT NULL,
                    expires_at REAL NOT NULL,
                    used INTEGER DEFAULT 0
                )
            """)

    def has_main_account(self) -> bool:
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT id FROM main_account WHERE id=1").fetchone()
            return row is not None

    def register_main(self, username: str, password: str,
                      email: str = "", phone: str = "") -> Dict:
        """注册主账户"""
        if self.has_main_account():
            return {"success": False, "error": "主账户已存在，每人只能注册一个"}
        if not username or len(username) < 2:
            return {"success": False, "error": "用户名至少2个字符"}
        if not password or len(password) < 6:
            return {"success": False, "error": "密码至少6个字符"}
        identity_id = generate_identity_id()
        password_hash = hash_password(password)
        now = time.time()
        try:
            with self._lock, self._get_conn() as conn:
                conn.execute("""
                    INSERT INTO main_account (id, identity_id, username, password_hash,
                        email, phone, ability_value, contribution_score, verified,
                        level, exp, badges, skills, streak, created_at, last_active)
                    VALUES (1, ?, ?, ?, ?, ?, 100, 0, 0, 1, 0, '[]', '{}', 0, ?, ?)
                """, (identity_id, username, password_hash, email, phone, now, now))
                # 同时创建身份档案
                conn.execute("""
                    INSERT INTO identity_profiles (identity_id, username, display_name,
                        level, exp, contribution_score, badges, skills, streak,
                        created_at, last_active, settings)
                    VALUES (?, ?, ?, 1, 0, 0, '[]', '{}', 0, ?, ?, '{}')
                """, (identity_id, username, username, now, now))
            return {
                "success": True,
                "identity_id": identity_id,
                "username": username,
                "ability_value": 100,
            }
        except sqlite3.IntegrityError:
            return {"success": False, "error": "用户名已存在"}

    def login_main(self, username: str, password: str) -> Dict:
        """登录主账户"""
        with self._lock, self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM main_account WHERE username=?", (username,)
            ).fetchone()
            if not row:
                return {"success": False, "error": "用户名不存在"}
            if not verify_password(password, row["password_hash"]):
                return {"success": False, "error": "密码错误"}
            now = time.time()
            conn.execute("UPDATE main_account SET last_login=?, last_active=? WHERE id=1",
                        (now, now))
            return {
                "success": True,
                "identity_id": row["identity_id"],
                "username": row["username"],
                "ability_value": row["ability_value"],
                "contribution_score": row["contribution_score"],
                "level": row["level"],
                "verified": bool(row["verified"]),
            }

    def get_main_info(self) -> Optional[Dict]:
        """获取主账户信息"""
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT * FROM main_account WHERE id=1").fetchone()
            if not row:
                return None
            return {
                "identity_id": row["identity_id"],
                "username": row["username"],
                "email": row["email"],
                "phone": row["phone"],
                "ability_value": row["ability_value"],
                "contribution_score": row["contribution_score"],
                "tasks_completed": row["tasks_completed"],
                "tasks_published": row["tasks_published"],
                "verified": bool(row["verified"]),
                "level": row["level"],
                "exp": row["exp"],
                "badges": json.loads(row["badges"]),
                "skills": json.loads(row["skills"]),
                "streak": row["streak"],
                "created_at": row["created_at"],
                "last_login": row["last_login"],
            }

    def verify_identity(self, verification_code: str) -> Dict:
        """验证身份（验证码）"""
        now = time.time()
        with self._lock, self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM verification_codes WHERE code=? AND used=0 AND expires_at>?",
                (verification_code, now)
            ).fetchone()
            if not row:
                return {"success": False, "error": "验证码无效或已过期"}
            conn.execute("UPDATE verification_codes SET used=1 WHERE id=?", (row["id"],))
            conn.execute("UPDATE main_account SET verified=1 WHERE id=1")
            return {"success": True, "purpose": row["purpose"]}
