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


class AuthDatabaseMixin:
    """认证数据库建表。"""

    def _init_db(self):
        """初始化SQLite数据库（多表结构）"""
        try:
            conn = sqlite3.connect(self.db_path, timeout=10)
            # 许可证表（主账户信息）
            conn.execute("""
                CREATE TABLE IF NOT EXISTS licenses (
                    license_key TEXT PRIMARY KEY,
                    activation_code TEXT DEFAULT '',
                    username TEXT DEFAULT '',
                    identity_id TEXT DEFAULT '',
                    email TEXT DEFAULT '',
                    phone TEXT DEFAULT '',
                    tier TEXT DEFAULT 'registered',
                    activated INTEGER DEFAULT 0,
                    created_at REAL DEFAULT 0,
                    activated_at REAL,
                    ability_value INTEGER DEFAULT 0,
                    contribution_score INTEGER DEFAULT 0,
                    tasks_completed INTEGER DEFAULT 0,
                    tasks_published INTEGER DEFAULT 0,
                    password_hash TEXT DEFAULT '',
                    extra TEXT DEFAULT '{}'
                )
            """)
            # 子用户表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sub_users (
                    id TEXT PRIMARY KEY,
                    name TEXT DEFAULT '',
                    role TEXT DEFAULT 'sub',
                    identity TEXT DEFAULT '{}',
                    active INTEGER DEFAULT 0,
                    created_at REAL DEFAULT 0,
                    last_active REAL DEFAULT 0,
                    extra TEXT DEFAULT '{}'
                )
            """)
            # 贡献记录表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS contributions (
                    id TEXT PRIMARY KEY,
                    task_title TEXT NOT NULL,
                    task_description TEXT NOT NULL,
                    category TEXT DEFAULT 'general',
                    score INTEGER DEFAULT 0,
                    completed_at REAL NOT NULL
                )
            """)
            # 角色表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS roles (
                    name TEXT PRIMARY KEY,
                    description TEXT DEFAULT '',
                    permissions TEXT DEFAULT '{}',
                    inherits TEXT DEFAULT '[]',
                    is_system INTEGER DEFAULT 0
                )
            """)
            # 用户角色关联表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS user_roles (
                    user_id TEXT,
                    role_name TEXT,
                    PRIMARY KEY (user_id, role_name)
                )
            """)
            # ACL表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS acls (
                    acl_id TEXT PRIMARY KEY,
                    resource TEXT DEFAULT '',
                    subject TEXT DEFAULT '',
                    subject_type TEXT DEFAULT 'user',
                    actions TEXT DEFAULT '[]',
                    effect TEXT DEFAULT 'allow',
                    enabled INTEGER DEFAULT 1
                )
            """)
            # API令牌表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS api_tokens (
                    token TEXT PRIMARY KEY,
                    user_id TEXT DEFAULT '',
                    name TEXT DEFAULT '',
                    created_at REAL DEFAULT 0,
                    expires_at REAL DEFAULT 0,
                    enabled INTEGER DEFAULT 1,
                    last_used REAL DEFAULT 0,
                    extra TEXT DEFAULT '{}'
                )
            """)
            # 会话表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    user_id TEXT DEFAULT '',
                    ip_address TEXT DEFAULT '',
                    user_agent TEXT DEFAULT '',
                    created_at REAL DEFAULT 0,
                    expires_at REAL DEFAULT 0,
                    last_active REAL DEFAULT 0,
                    extra TEXT DEFAULT '{}'
                )
            """)
            # 审计日志表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT DEFAULT '',
                    subject TEXT DEFAULT '',
                    resource TEXT DEFAULT '',
                    result TEXT DEFAULT '',
                    details TEXT DEFAULT '',
                    created_at REAL DEFAULT 0
                )
            """)
            # 系统状态表（active_sub_user等简单状态）
            conn.execute("""
                CREATE TABLE IF NOT EXISTS system_state (
                    key TEXT PRIMARY KEY,
                    value TEXT DEFAULT ''
                )
            """)
            # 验证码表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS verification_codes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT DEFAULT '',
                    phone TEXT DEFAULT '',
                    code TEXT DEFAULT '',
                    purpose TEXT DEFAULT 'register',
                    created_at REAL DEFAULT 0,
                    expires_at REAL DEFAULT 0,
                    used INTEGER DEFAULT 0,
                    attempts INTEGER DEFAULT 0
                )
            """)
            # 迁移：为旧表添加缺失的列
            _alter_sqls = [
                ("licenses", "extra", "TEXT DEFAULT '{}'"),
                ("licenses", "password_hash", "TEXT DEFAULT ''"),
                ("licenses", "ability_value", "INTEGER DEFAULT 0"),
                ("licenses", "contribution_score", "INTEGER DEFAULT 0"),
                ("licenses", "tasks_completed", "INTEGER DEFAULT 0"),
                ("licenses", "tasks_published", "INTEGER DEFAULT 0"),
                ("sub_users", "extra", "TEXT DEFAULT '{}'"),
                ("sub_users", "last_active", "REAL DEFAULT 0"),
                ("api_tokens", "extra", "TEXT DEFAULT '{}'"),
                ("api_tokens", "last_used", "REAL DEFAULT 0"),
                ("sessions", "last_active", "REAL DEFAULT 0"),
                ("sessions", "user_agent", "TEXT DEFAULT ''"),
                ("sessions", "ip_address", "TEXT DEFAULT ''"),
            ]
            for table, col, coldef in _alter_sqls:
                try:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {coldef}")
                except Exception:
                    pass  # 列已存在
    
            conn.commit()
            conn.close()
        except Exception as e:
            terminal.warn(f"初始化认证数据库失败: {e}", "auth_manager")
