"""发布密钥职责：manager。"""

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
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

from .constants import CONTRIB_BONUS_STEP
from .constants import HARD_CAP
from .models import KeyStatus
from .constants import ROLE_KEY_CONFIG
from .models import ReleaseKey
from .constants import TASK_BONUS_STEP
from .crypto import _generate_key
from .crypto import _hash_key

class ReleaseKeyManager:
    """发布密钥系统"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "release_keys")
        os.makedirs(self.data_dir, exist_ok=True)
        self._keys: Dict[str, ReleaseKey] = {}
        self._lock = threading.RLock()
        self._key_rotation_interval = 90 * 86400  # 90天
        # 发布密钥数据库（0.1.5兼容）
        self.release_db_path = os.path.join(self.data_dir, "release_keys.db")
        self._init_release_db()
        self._load()

    def _load(self):
        keys_file = os.path.join(self.data_dir, "keys.json")
        try:
            if os.path.exists(keys_file):
                with open(keys_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for k_data in data.get("keys", []):
                    key = ReleaseKey(
                        name=k_data.get("name", ""),
                        key_type=k_data.get("key_type", "release"),
                        owner=k_data.get("owner", ""),
                        description=k_data.get("description", ""),
                        permissions=k_data.get("permissions", []),
                        expires_at=k_data.get("expires_at", 0),
                        max_uses=k_data.get("max_uses", 0),
                    )
                    key.key_id = k_data.get("key_id", key.key_id)
                    key.status = KeyStatus(k_data.get("status", "active"))
                    key.secret_hash = k_data.get("secret_hash", "")
                    key.secret_prefix = k_data.get("secret_prefix", "")
                    key.use_count = k_data.get("use_count", 0)
                    key.last_used = k_data.get("last_used", 0)
                    key.rotated_from = k_data.get("rotated_from", "")
                    key.rotated_to = k_data.get("rotated_to", "")
                    key.ip_whitelist = k_data.get("ip_whitelist", [])
                    self._keys[key.key_id] = key
        except Exception as e:
            terminal.warn(f"加载密钥失败: {e}", "release_key")

    def _save(self):
        keys_file = os.path.join(self.data_dir, "keys.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                "keys": [k.to_dict() for k in self._keys.values()],
            }
            with open(keys_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def create_key(self, name: str, key_type: str = "release",
                   owner: str = "", description: str = "",
                   permissions: Optional[List[str]] = None,
                   expires_in_days: int = 90,
                   max_uses: int = 0) -> Tuple[ReleaseKey, str]:
        """创建密钥，返回(密钥对象, 密钥明文)"""
        expires_at = time.time() + expires_in_days * 86400 if expires_in_days > 0 else 0
        key = ReleaseKey(
            name=name, key_type=key_type, owner=owner,
            description=description, permissions=permissions,
            expires_at=expires_at, max_uses=max_uses,
        )
        secret = key.generate_secret()
        with self._lock:
            self._keys[key.key_id] = key
            self._save()
        terminal.info(f"创建密钥: {name} ({key_type})", "release_key")
        return key, secret

    def get_key(self, key_id: str) -> Optional[ReleaseKey]:
        return self._keys.get(key_id)

    def get_key_by_prefix(self, prefix: str) -> Optional[ReleaseKey]:
        for key in self._keys.values():
            if key.secret_prefix == prefix:
                return key
        return None

    def verify_key(self, secret: str, permission: str = "",
                    ip: str = "") -> Tuple[bool, Optional[ReleaseKey], str]:
        """验证密钥"""
        prefix = secret[:12] if len(secret) >= 12 else ""
        key = self.get_key_by_prefix(prefix)
        if not key:
            return False, None, "密钥不存在"
        if not key.verify_secret(secret):
            return False, None, "密钥验证失败"
        if not key.is_valid():
            if key.status == KeyStatus.REVOKED:
                return False, key, "密钥已被吊销"
            if key.status == KeyStatus.SUSPENDED:
                return False, key, "密钥已被暂停"
            if key.expires_at and time.time() > key.expires_at:
                return False, key, "密钥已过期"
            if key.max_uses and key.use_count >= key.max_uses:
                return False, key, "密钥使用次数已达上限"
        if permission and not key.has_permission(permission):
            return False, key, f"密钥没有权限: {permission}"
        if key.ip_whitelist and ip not in key.ip_whitelist:
            return False, key, "IP不在白名单中"
        key.record_use(ip)
        self._save()
        return True, key, "验证成功"

    def revoke_key(self, key_id: str, revoked_by: str = "",
                   reason: str = "") -> bool:
        key = self._keys.get(key_id)
        if not key:
            return False
        key.status = KeyStatus.REVOKED
        key.revoked_at = time.time()
        key.revoked_by = revoked_by
        key.revocation_reason = reason
        self._save()
        terminal.info(f"吊销密钥: {key.name} ({reason})", "release_key")
        return True

    def suspend_key(self, key_id: str) -> bool:
        key = self._keys.get(key_id)
        if key:
            key.status = KeyStatus.SUSPENDED
            self._save()
            return True
        return False

    def activate_key(self, key_id: str) -> bool:
        key = self._keys.get(key_id)
        if key and key.status == KeyStatus.SUSPENDED:
            key.status = KeyStatus.ACTIVE
            self._save()
            return True
        return False

    def rotate_key(self, key_id: str) -> Tuple[Optional[ReleaseKey], str]:
        """轮换密钥"""
        old_key = self._keys.get(key_id)
        if not old_key:
            return None, ""
        # 创建新密钥
        new_key, new_secret = self.create_key(
            name=f"{old_key.name}_rotated",
            key_type=old_key.key_type,
            owner=old_key.owner,
            description=f"轮换自 {old_key.key_id}",
            permissions=old_key.permissions,
            expires_in_days=90,
            max_uses=old_key.max_uses,
        )
        new_key.rotated_from = old_key.key_id
        old_key.rotated_to = new_key.key_id
        old_key.status = KeyStatus.ROTATED
        self._save()
        terminal.info(f"密钥轮换: {old_key.name} -> {new_key.name}", "release_key")
        return new_key, new_secret

    def list_keys(self, key_type: str = "", status: str = "",
                   owner: str = "") -> List:
        # 兼容0.1.5：如果第一个参数是用户名（不是已知密钥类型），则列出用户的发布密钥
        known_types = {"release", "signing", "api", "encryption", "deploy", ""}
        if key_type and key_type not in known_types:
            return self.list_user_keys(key_type)
        keys = list(self._keys.values())
        if key_type:
            keys = [k for k in keys if k.key_type == key_type]
        if status:
            keys = [k for k in keys if k.status.value == status]
        if owner:
            keys = [k for k in keys if k.owner == owner]
        return sorted(keys, key=lambda k: k.created_at, reverse=True)

    def get_active_keys(self) -> List[ReleaseKey]:
        return [k for k in self._keys.values() if k.status == KeyStatus.ACTIVE]

    def get_expiring_keys(self, days: int = 7) -> List[ReleaseKey]:
        cutoff = time.time() + days * 86400
        return [k for k in self._keys.values()
                if k.status == KeyStatus.ACTIVE and k.expires_at
                and k.expires_at < cutoff]

    def sign_data(self, key_id: str, data: str) -> Optional[Dict[str, Any]]:
        key = self._keys.get(key_id)
        if key and key.is_valid():
            return key.sign(data)
        return None

    def verify_data_signature(self, key_id: str, data: str,
                              signature: str, timestamp: int,
                              nonce: str) -> bool:
        key = self._keys.get(key_id)
        if key:
            return key.verify_signature(data, signature, timestamp, nonce)
        return False

    def add_ip_whitelist(self, key_id: str, ip: str) -> bool:
        key = self._keys.get(key_id)
        if key and ip not in key.ip_whitelist:
            key.ip_whitelist.append(ip)
            self._save()
            return True
        return False

    def remove_ip_whitelist(self, key_id: str, ip: str) -> bool:
        key = self._keys.get(key_id)
        if key and ip in key.ip_whitelist:
            key.ip_whitelist.remove(ip)
            self._save()
            return True
        return False

    def get_stats(self) -> Dict[str, Any]:
        total = len(self._keys)
        active = sum(1 for k in self._keys.values() if k.status == KeyStatus.ACTIVE)
        revoked = sum(1 for k in self._keys.values() if k.status == KeyStatus.REVOKED)
        suspended = sum(1 for k in self._keys.values() if k.status == KeyStatus.SUSPENDED)
        expired = sum(1 for k in self._keys.values()
                     if k.expires_at and time.time() > k.expires_at and k.status == KeyStatus.ACTIVE)
        total_uses = sum(k.use_count for k in self._keys.values())
        total_signatures = sum(len(k.signatures) for k in self._keys.values())
        return {
            "total_keys": total,
            "active": active,
            "revoked": revoked,
            "suspended": suspended,
            "expired": expired,
            "expiring_7d": len(self.get_expiring_keys(7)),
            "total_uses": total_uses,
            "total_signatures": total_signatures,
            "by_type": {t: sum(1 for k in self._keys.values() if k.key_type == t)
                        for t in set(k.key_type for k in self._keys.values())},
        }

    # ================================================================
    # 发布密钥系统（0.1.5兼容 - SQLite）
    # ================================================================
    def _init_release_db(self):
        try:
            conn = sqlite3.connect(self.release_db_path, timeout=10)
            conn.execute("""CREATE TABLE IF NOT EXISTS key_chain (
                id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL,
                identity_id TEXT NOT NULL, seq INTEGER NOT NULL,
                key_hash TEXT NOT NULL UNIQUE, key_preview TEXT NOT NULL,
                role_at_gen TEXT NOT NULL, created_at REAL NOT NULL,
                revoked INTEGER DEFAULT 0, revoke_reason TEXT DEFAULT '',
                UNIQUE(username, seq))""")
            conn.execute("""CREATE TABLE IF NOT EXISTS publish_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL,
                key_seq INTEGER NOT NULL, version TEXT NOT NULL,
                published_at REAL NOT NULL, platform TEXT DEFAULT '')""")
            conn.commit()
            conn.close()
        except Exception as e:
            terminal.warn(f"初始化发布密钥数据库失败: {e}", "release_key")

    def _get_release_conn(self):
        conn = sqlite3.connect(self.release_db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def get_key_quota(self, role, contribution_score=0, tasks_completed=0):
        cfg = ROLE_KEY_CONFIG.get(role, ROLE_KEY_CONFIG["guest"])
        base = cfg["max_base"]
        contrib_bonus = contribution_score // CONTRIB_BONUS_STEP
        task_bonus = tasks_completed // TASK_BONUS_STEP
        total = min(base + contrib_bonus + task_bonus, HARD_CAP)
        return {"role": role, "base_quota": base, "contrib_bonus": contrib_bonus,
                "task_bonus": task_bonus, "total_quota": total,
                "interval_seconds": cfg["interval"], "min_contrib": cfg["min_contrib"],
                "min_tasks": cfg["min_tasks"]}

    def get_key_status(self, username, identity_id, role, contribution_score=0, tasks_completed=0):
        quota = self.get_key_quota(role, contribution_score, tasks_completed)
        try:
            with self._get_release_conn() as conn:
                used = conn.execute("SELECT COUNT(*) as cnt FROM key_chain WHERE username=? AND revoked=0", (username,)).fetchone()["cnt"]
                last = conn.execute("SELECT seq, key_preview, created_at, role_at_gen FROM key_chain WHERE username=? ORDER BY seq DESC LIMIT 1", (username,)).fetchone()
                pub_count = conn.execute("SELECT COUNT(*) as cnt FROM publish_usage WHERE username=?", (username,)).fetchone()["cnt"]
        except Exception:
            used, last, pub_count = 0, None, 0
        remaining = quota["total_quota"] - used
        now = time.time()
        cooldown = 0
        if last and quota["interval_seconds"] > 0:
            cooldown = max(0, quota["interval_seconds"] - (now - last["created_at"]))
        return {**quota, "used": used, "remaining": max(0, remaining),
                "can_generate": remaining > 0 and cooldown == 0,
                "cooldown_remaining": cooldown, "cooldown_str": self._fmt_duration(cooldown),
                "last_key": dict(last) if last else None, "publish_count": pub_count,
                "has_any_key": last is not None}

    def generate_key(self, username, identity_id, role, contribution_score=0, tasks_completed=0, previous_key=""):
        if not username or not identity_id:
            return {"success": False, "error": "缺少用户信息"}
        cfg = ROLE_KEY_CONFIG.get(role, ROLE_KEY_CONFIG["guest"])
        if cfg["max_base"] == 0:
            return {"success": False, "error": f"角色「{role}」无权生成发布密钥"}
        if contribution_score < cfg["min_contrib"]:
            return {"success": False, "error": f"贡献分不足：需要 {cfg['min_contrib']}，当前 {contribution_score}"}
        if tasks_completed < cfg["min_tasks"]:
            return {"success": False, "error": f"任务完成数不足：需要 {cfg['min_tasks']}，当前 {tasks_completed}"}
        status = self.get_key_status(username, identity_id, role, contribution_score, tasks_completed)
        if status["remaining"] <= 0:
            return {"success": False, "error": f"密钥额度已用完（{status['used']}/{status['total_quota']}）"}
        if status["cooldown_remaining"] > 0:
            return {"success": False, "error": f"距离上次生成还需等待 {status['cooldown_str']}"}
        try:
            with self._get_release_conn() as conn:
                last = conn.execute("SELECT seq, key_hash FROM key_chain WHERE username=? ORDER BY seq DESC LIMIT 1", (username,)).fetchone()
                if last:
                    if not previous_key:
                        return {"success": False, "error": "必须提供上一把发布密钥才能生成新密钥", "need_previous": True}
                    if _hash_key(previous_key) != last["key_hash"]:
                        return {"success": False, "error": "上一把密钥验证失败"}
                    seq = last["seq"] + 1
                else:
                    seq = 1
                new_key = _generate_key(username, identity_id, seq)
                now = time.time()
                preview = f"{new_key[:12]}...{new_key[-8:]}"
                conn.execute("INSERT INTO key_chain (username, identity_id, seq, key_hash, key_preview, role_at_gen, created_at) VALUES (?,?,?,?,?,?,?)",
                    (username, identity_id, seq, _hash_key(new_key), preview, role, now))
                conn.commit()
        except sqlite3.IntegrityError:
            return {"success": False, "error": "密钥生成失败（序列号冲突），请重试"}
        except Exception as e:
            return {"success": False, "error": f"密钥生成失败: {e}"}
        return {"success": True, "key": new_key, "seq": seq, "preview": preview,
                "message": "密钥生成成功，请立即复制保存。密钥丢失后无法找回，只能用旧密钥生成新密钥。",
                "is_first": seq == 1}

    def verify_release_key(self, username, key):
        if not key:
            return {"valid": False, "error": "请输入发布密钥"}
        try:
            with self._get_release_conn() as conn:
                row = conn.execute("SELECT * FROM key_chain WHERE username=? AND key_hash=? AND revoked=0 ORDER BY seq DESC LIMIT 1",
                    (username, _hash_key(key))).fetchone()
        except Exception:
            return {"valid": False, "error": "密钥验证失败"}
        if not row:
            return {"valid": False, "error": "密钥无效或已被吊销"}
        return {"valid": True, "seq": row["seq"], "preview": row["key_preview"], "role_at_gen": row["role_at_gen"]}

    def record_publish(self, username, key, version, platform=""):
        try:
            with self._get_release_conn() as conn:
                row = conn.execute("SELECT seq FROM key_chain WHERE username=? AND key_hash=?", (username, _hash_key(key))).fetchone()
                if row:
                    conn.execute("INSERT INTO publish_usage (username, key_seq, version, published_at, platform) VALUES (?,?,?,?,?)",
                        (username, row["seq"], version, time.time(), platform))
                    conn.commit()
        except Exception:
            pass

    def revoke_release_key(self, username, key, reason=""):
        try:
            with self._get_release_conn() as conn:
                cur = conn.execute("UPDATE key_chain SET revoked=1, revoke_reason=? WHERE username=? AND key_hash=?",
                    (reason, username, _hash_key(key)))
                conn.commit()
                if cur.rowcount:
                    return {"success": True, "message": "密钥已吊销"}
        except Exception:
            pass
        return {"success": False, "error": "密钥不存在"}

    def list_user_keys(self, username):
        try:
            with self._get_release_conn() as conn:
                rows = conn.execute("SELECT seq, key_preview, role_at_gen, created_at, revoked, revoke_reason FROM key_chain WHERE username=? ORDER BY seq", (username,)).fetchall()
        except Exception:
            return []
        return [{"seq": r["seq"], "preview": r["key_preview"], "role": r["role_at_gen"],
                 "created": datetime.fromtimestamp(r["created_at"]).strftime("%Y-%m-%d %H:%M"),
                 "revoked": bool(r["revoked"]), "revoke_reason": r["revoke_reason"]} for r in rows]

    def get_publish_history(self, username):
        try:
            with self._get_release_conn() as conn:
                rows = conn.execute("SELECT * FROM publish_usage WHERE username=? ORDER BY published_at DESC", (username,)).fetchall()
        except Exception:
            return []
        return [{"version": r["version"], "key_seq": r["key_seq"], "platform": r["platform"],
                 "published_at": datetime.fromtimestamp(r["published_at"]).strftime("%Y-%m-%d %H:%M")} for r in rows]

    @staticmethod
    def _fmt_duration(seconds):
        if seconds <= 0:
            return ""
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        if h > 0:
            return f"{h}小时{m}分"
        if m > 0:
            return f"{m}分{s}秒"
        return f"{s}秒"
