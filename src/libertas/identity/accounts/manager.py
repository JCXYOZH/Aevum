"""账户职责：manager。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from .constants import ACCOUNT_TIERS
from .constants import DEFAULT_QUOTAS
from .crypto import hash_password
from .crypto import verify_license_key
from .crypto import verify_password
from libertas.foundation.config import get_data_dir

class AccountManager:
    """账户管理器（SQLite多表结构）"""

    def __init__(self, db_path: str = ""):
        if not db_path:
            # 默认数据目录：优先非系统盘，其次用户目录
            db_path = self._default_db_path()
        self.db_path = db_path
        self._lock = threading.Lock()
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._init_db()

    @staticmethod
    def _default_db_path() -> str:
        """默认数据库路径跟随 LIBERTAS_DATA_DIR，避免数据根搬家后分裂。"""
        return os.path.join(get_data_dir(), "auth.db")

    def _get_conn(self) -> sqlite3.Connection:
        """获取数据库连接"""
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_db(self):
        """初始化数据库表结构"""
        with self._lock, self._get_conn() as conn:
            # 账户表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS accounts (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    email TEXT DEFAULT '',
                    phone TEXT DEFAULT '',
                    tier TEXT DEFAULT 'registered',
                    license_key TEXT DEFAULT '',
                    activated INTEGER DEFAULT 0,
                    activation_code TEXT DEFAULT '',
                    created_at REAL NOT NULL,
                    activated_at REAL,
                    last_login REAL,
                    settings TEXT DEFAULT '{}'
                )
            """)
            # API Key 表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS api_keys (
                    key_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    key_hash TEXT NOT NULL,
                    name TEXT DEFAULT '',
                    created_at REAL NOT NULL,
                    last_used REAL,
                    revoked INTEGER DEFAULT 0,
                    FOREIGN KEY (user_id) REFERENCES accounts(id) ON DELETE CASCADE
                )
            """)
            # 使用量表（按天统计）
            conn.execute("""
                CREATE TABLE IF NOT EXISTS usage (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    usage_type TEXT NOT NULL,
                    amount INTEGER DEFAULT 1,
                    date TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES accounts(id) ON DELETE CASCADE
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_usage_user_date
                ON usage(user_id, usage_type, date)
            """)

    # ============================================================
    # 核心认证方法
    # ============================================================

    def register(self, username: str, password: str,
                 email: str = "", phone: str = "") -> Dict[str, Any]:
        """注册新账户"""
        if not username or len(username) < 2:
            return {"success": False, "error": "用户名至少2个字符"}
        if not password or len(password) < 6:
            return {"success": False, "error": "密码至少6个字符"}

        uid = secrets.token_hex(16)
        now = time.time()
        activation_code = secrets.token_hex(6)

        with self._lock, self._get_conn() as conn:
            try:
                conn.execute(
                    "INSERT INTO accounts (id, username, password_hash, email, phone, tier, activation_code, created_at) VALUES (?,?,?,?,?,?,?,?)",
                    (uid, username, hash_password(password), email, phone, "registered", activation_code, now)
                )
            except sqlite3.IntegrityError:
                return {"success": False, "error": "用户名已存在"}

        return {
            "success": True,
            "user_id": uid,
            "username": username,
            "tier": "registered",
            "activation_code": activation_code,
            "message": "注册成功！请输入激活码激活账户。",
        }

    def activate(self, username: str, activation_code: str = "",
                 license_key: str = "") -> Dict[str, Any]:
        """激活账户（激活码或许可证密钥）"""
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT * FROM accounts WHERE username=?", (username,)).fetchone()
            if not row:
                return {"success": False, "error": "账户不存在"}
            if row["activated"]:
                return {"success": True, "message": "账户已激活", "tier": row["tier"]}

            # 许可证激活
            if license_key:
                result = verify_license_key(license_key)
                if not result["valid"]:
                    return {"success": False, "error": result["error"]}
                tier = result["payload"].get("t", "activated")
                conn.execute(
                    "UPDATE accounts SET activated=1, license_key=?, tier=?, activated_at=? WHERE username=?",
                    (license_key, tier, time.time(), username)
                )
                return {
                    "success": True,
                    "tier": tier,
                    "message": f"许可证激活成功，等级：{ACCOUNT_TIERS.get(tier, {}).get('label', tier)}",
                }

            # 激活码激活
            if activation_code and hmac.compare_digest(activation_code, row["activation_code"]):
                conn.execute(
                    "UPDATE accounts SET activated=1, activated_at=?, tier='activated' WHERE username=?",
                    (time.time(), username)
                )
                return {"success": True, "tier": "activated", "message": "激活成功！"}

            return {"success": False, "error": "激活码或许可证密钥无效"}

    def login(self, username: str, password: str) -> Dict[str, Any]:
        """登录验证"""
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT * FROM accounts WHERE username=?", (username,)).fetchone()
            if not row:
                return {"success": False, "error": "用户名或密码错误"}
            if not verify_password(password, row["password_hash"]):
                return {"success": False, "error": "用户名或密码错误"}
            conn.execute("UPDATE accounts SET last_login=? WHERE username=?", (time.time(), username))

            tier_info = ACCOUNT_TIERS.get(row["tier"], ACCOUNT_TIERS["unregistered"])
            return {
                "success": True,
                "user_id": row["id"],
                "username": username,
                "tier": row["tier"],
                "tier_label": tier_info["label"],
                "activated": bool(row["activated"]),
                "features": tier_info["features"],
                "can_network": tier_info["can_network"],
                "can_cloud": tier_info["can_cloud"],
                "can_governance": tier_info["can_governance"],
                "can_fork": tier_info["can_fork"],
            }

    def get_account(self, username: str) -> Optional[Dict[str, Any]]:
        """获取账户信息"""
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT * FROM accounts WHERE username=?", (username,)).fetchone()
            if not row:
                return None
            tier_info = ACCOUNT_TIERS.get(row["tier"], ACCOUNT_TIERS["unregistered"])
            return {
                "user_id": row["id"],
                "username": row["username"],
                "email": row["email"],
                "phone": row["phone"],
                "tier": row["tier"],
                "tier_label": tier_info["label"],
                "activated": bool(row["activated"]),
                "license_key": row["license_key"],
                "created_at": datetime.fromtimestamp(row["created_at"]).strftime("%Y-%m-%d %H:%M:%S"),
                "last_login": datetime.fromtimestamp(row["last_login"]).strftime("%Y-%m-%d %H:%M:%S") if row["last_login"] else None,
                "features": tier_info["features"],
                "can_network": tier_info["can_network"],
                "can_cloud": tier_info["can_cloud"],
                "settings": json.loads(row["settings"] or "{}"),
            }

    def list_accounts(self) -> List[Dict[str, Any]]:
        """列出所有账户（简要信息）"""
        with self._lock, self._get_conn() as conn:
            rows = conn.execute(
                "SELECT id, username, email, phone, tier, activated, created_at, last_login FROM accounts ORDER BY created_at"
            ).fetchall()
            return [dict(r) for r in rows]

    def has_feature(self, username: str, feature: str) -> bool:
        """检查账户是否有指定功能权限"""
        acct = self.get_account(username)
        if not acct:
            return feature in ACCOUNT_TIERS["unregistered"]["features"]
        features = acct["features"]
        return "*" in features or feature in features

    # ============================================================
    # 账户管理方法
    # ============================================================

    def update_account(self, username: str, **kwargs) -> Dict[str, Any]:
        """更新账户信息（邮箱、手机号、设置等）"""
        allowed_fields = ["email", "phone", "settings"]
        updates = []
        values = []
        for key, value in kwargs.items():
            if key in allowed_fields:
                updates.append(f"{key}=?")
                if key == "settings" and isinstance(value, dict):
                    values.append(json.dumps(value, ensure_ascii=False))
                else:
                    values.append(value)
        if not updates:
            return {"success": False, "error": "没有可更新的字段"}

        values.append(username)
        with self._lock, self._get_conn() as conn:
            conn.execute(f"UPDATE accounts SET {', '.join(updates)} WHERE username=?", values)
        return {"success": True, "message": "账户信息已更新"}

    def change_password(self, username: str, old_password: str, new_password: str) -> Dict[str, Any]:
        """修改密码"""
        if not new_password or len(new_password) < 6:
            return {"success": False, "error": "新密码至少6个字符"}
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT password_hash FROM accounts WHERE username=?", (username,)).fetchone()
            if not row:
                return {"success": False, "error": "账户不存在"}
            if not verify_password(old_password, row["password_hash"]):
                return {"success": False, "error": "原密码错误"}
            conn.execute("UPDATE accounts SET password_hash=? WHERE username=?",
                         (hash_password(new_password), username))
        return {"success": True, "message": "密码修改成功"}

    def reset_password(self, username: str, new_password: str) -> Dict[str, Any]:
        """重置密码（无需原密码，用于账号找回后）"""
        if not new_password or len(new_password) < 6:
            return {"success": False, "error": "新密码至少6个字符"}
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT id FROM accounts WHERE username=?", (username,)).fetchone()
            if not row:
                return {"success": False, "error": "账户不存在"}
            conn.execute("UPDATE accounts SET password_hash=? WHERE username=?",
                         (hash_password(new_password), username))
        return {"success": True, "message": "密码重置成功"}

    # ============================================================
    # API Key 管理
    # ============================================================

    def create_api_key(self, username: str, name: str = "") -> Dict[str, Any]:
        """创建 API Key（只返回一次明文，之后只存哈希）"""
        acct = self.get_account(username)
        if not acct:
            return {"success": False, "error": "账户不存在"}

        key_id = secrets.token_hex(8)
        api_key = f"libertas_{secrets.token_hex(24)}"
        key_hash = hashlib.sha256(api_key.encode()).hexdigest()

        with self._lock, self._get_conn() as conn:
            conn.execute(
                "INSERT INTO api_keys (key_id, user_id, key_hash, name, created_at) VALUES (?,?,?,?,?)",
                (key_id, acct["user_id"], key_hash, name, time.time())
            )
        return {
            "success": True,
            "key_id": key_id,
            "api_key": api_key,  # 只返回一次
            "name": name,
            "message": "API Key 创建成功，请妥善保存（只显示一次）",
        }

    def verify_api_key(self, api_key: str) -> Optional[Dict[str, Any]]:
        """验证 API Key，返回对应用户信息"""
        if not api_key or not api_key.startswith("libertas_"):
            return None
        key_hash = hashlib.sha256(api_key.encode()).hexdigest()
        with self._lock, self._get_conn() as conn:
            row = conn.execute("""
                SELECT a.*, k.key_id, k.name as key_name, k.last_used
                FROM api_keys k
                JOIN accounts a ON k.user_id = a.id
                WHERE k.key_hash=? AND k.revoked=0
            """, (key_hash,)).fetchone()
            if not row:
                return None
            conn.execute("UPDATE api_keys SET last_used=? WHERE key_hash=?", (time.time(), key_hash))
            tier_info = ACCOUNT_TIERS.get(row["tier"], ACCOUNT_TIERS["unregistered"])
            return {
                "user_id": row["id"],
                "username": row["username"],
                "tier": row["tier"],
                "key_id": row["key_id"],
                "key_name": row["key_name"],
                "features": tier_info["features"],
            }

    def list_api_keys(self, username: str) -> List[Dict[str, Any]]:
        """列出用户的所有 API Key（不包含密钥本身）"""
        acct = self.get_account(username)
        if not acct:
            return []
        with self._lock, self._get_conn() as conn:
            rows = conn.execute(
                "SELECT key_id, name, created_at, last_used, revoked FROM api_keys WHERE user_id=? ORDER BY created_at DESC",
                (acct["user_id"],)
            ).fetchall()
            return [dict(r) for r in rows]

    def revoke_api_key(self, username: str, key_id: str) -> Dict[str, Any]:
        """撤销 API Key"""
        acct = self.get_account(username)
        if not acct:
            return {"success": False, "error": "账户不存在"}
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "UPDATE api_keys SET revoked=1 WHERE user_id=? AND key_id=?",
                (acct["user_id"], key_id)
            )
        return {"success": True, "message": "API Key 已撤销"}

    # ============================================================
    # 配额与使用量管理
    # ============================================================

    def check_quota(self, username: str, usage_type: str) -> Dict[str, Any]:
        """检查配额（返回是否允许、已用、限额）"""
        acct = self.get_account(username)
        if not acct:
            tier = "unregistered"
        else:
            tier = acct["tier"]

        quotas = DEFAULT_QUOTAS.get(tier, DEFAULT_QUOTAS["unregistered"])
        limit = quotas.get(usage_type, 0)
        if limit == -1:
            return {"allowed": True, "used": 0, "limit": -1, "message": "无限制"}

        today = datetime.now().strftime("%Y-%m-%d")
        with self._lock, self._get_conn() as conn:
            row = conn.execute(
                "SELECT COALESCE(SUM(amount), 0) as used FROM usage WHERE user_id=? AND usage_type=? AND date=?",
                (acct["user_id"] if acct else "", usage_type, today)
            ).fetchone()
            used = row["used"] if row else 0

        return {
            "allowed": used < limit,
            "used": used,
            "limit": limit,
            "remaining": max(0, limit - used),
            "message": f"已用 {used}/{limit}" if limit > 0 else "该类型无配额限制",
        }

    def record_usage(self, username: str, usage_type: str, amount: int = 1) -> Dict[str, Any]:
        """记录使用量"""
        acct = self.get_account(username)
        if not acct:
            return {"success": False, "error": "账户不存在"}
        today = datetime.now().strftime("%Y-%m-%d")
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "INSERT INTO usage (user_id, usage_type, amount, date, created_at) VALUES (?,?,?,?,?)",
                (acct["user_id"], usage_type, amount, today, time.time())
            )
        return {"success": True, "message": "使用量已记录"}

    def get_usage_stats(self, username: str, days: int = 7) -> List[Dict[str, Any]]:
        """获取最近N天的使用统计"""
        acct = self.get_account(username)
        if not acct:
            return []
        with self._lock, self._get_conn() as conn:
            rows = conn.execute("""
                SELECT date, usage_type, SUM(amount) as total
                FROM usage
                WHERE user_id=? AND date >= date('now', ?)
                GROUP BY date, usage_type
                ORDER BY date DESC
            """, (acct["user_id"], f"-{days} days")).fetchall()
            return [dict(r) for r in rows]

    # ============================================================
    # 统计信息
    # ============================================================

    def get_stats(self) -> Dict[str, Any]:
        """获取系统统计信息"""
        with self._lock, self._get_conn() as conn:
            total = conn.execute("SELECT COUNT(*) as c FROM accounts").fetchone()["c"]
            activated = conn.execute("SELECT COUNT(*) as c FROM accounts WHERE activated=1").fetchone()["c"]
            tiers = {}
            for row in conn.execute("SELECT tier, COUNT(*) as c FROM accounts GROUP BY tier").fetchall():
                tiers[row["tier"]] = row["c"]
            api_keys = conn.execute("SELECT COUNT(*) as c FROM api_keys WHERE revoked=0").fetchone()["c"]
        return {
            "total_accounts": total,
            "activated_accounts": activated,
            "unactivated_accounts": total - activated,
            "tiers": tiers,
            "active_api_keys": api_keys,
            "db_path": self.db_path,
        }
