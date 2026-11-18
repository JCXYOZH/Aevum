"""回路订阅、来源、墙与内部提醒的持久化 mixin。

从 ``storage.py`` 拆出，避免用户账号持久化与回路业务表混在一个文件里。
本模块只依赖 ``loop.db`` 和站长邮件配置，不读写 ``users.db``。
"""

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from typing import Any, Dict, List, Tuple
from urllib.parse import urlparse

from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

# 回路页面组白名单：只允许这些值落库，未知路径统一落到 other。
LOOP_PAGE_GROUPS = ("home", "mrhua", "desktop", "subscribe", "docs", "other")


class LoopStorageMixin:
    """回路独立库：订阅、来源、墙、审计和站长内部提醒。"""

    _LOOP_TABLES = ("loop_subscriptions", "loop_sources", "loop_walls", "loop_audit")

    def _loop_conn(self):
        conn = sqlite3.connect(self.loop_db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_loop_db(self) -> None:
        """回路独立库；users.db 只留账号，不再留报名和访问记录。"""
        try:
            conn = sqlite3.connect(self.loop_db_path, timeout=10)
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS loop_subscriptions (
                    subscription_id TEXT PRIMARY KEY,
                    email_enc TEXT DEFAULT '',
                    email_masked TEXT DEFAULT '',
                    email_hash TEXT UNIQUE NOT NULL,
                    scope TEXT NOT NULL,
                    consent_at REAL DEFAULT 0,
                    consent_page TEXT DEFAULT '',
                    confirm_token_hash TEXT DEFAULT '',
                    confirm_token_enc TEXT DEFAULT '',
                    unsubscribe_token_hash TEXT DEFAULT '',
                    unsubscribe_token_enc TEXT DEFAULT '',
                    status TEXT DEFAULT 'pending',
                    confirmed_at REAL DEFAULT 0,
                    unsubscribed_at REAL DEFAULT 0,
                    last_contacted REAL DEFAULT 0,
                    created_at REAL DEFAULT 0,
                    updated_at REAL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_loop_subscriptions_status
                    ON loop_subscriptions(status, consent_at);
                CREATE TABLE IF NOT EXISTS loop_sources (
                    day TEXT NOT NULL,
                    source TEXT NOT NULL,
                    page_group TEXT NOT NULL,
                    count INTEGER DEFAULT 0,
                    updated_at REAL DEFAULT 0,
                    PRIMARY KEY (day, source, page_group)
                );
                CREATE TABLE IF NOT EXISTS loop_walls (
                    wall_id TEXT PRIMARY KEY,
                    platform TEXT NOT NULL,
                    target TEXT DEFAULT '',
                    symptom TEXT NOT NULL,
                    note TEXT DEFAULT '',
                    observed_at REAL DEFAULT 0,
                    created_at REAL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS loop_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT NOT NULL,
                    subject TEXT DEFAULT '',
                    resource TEXT DEFAULT '',
                    created_at REAL DEFAULT 0
                );
            """)
            conn.commit()
            conn.close()
            self._migrate_loop_from_users_db()
            self._scrub_loop_sources()
        except Exception as error:
            terminal.warn(f"初始化回路数据库失败: {error}", "loop")

    def _scrub_loop_sources(self) -> None:
        """把历史来源里的完整 URL/query 清洗成域名 + 页面组，并按新键合并。"""
        try:
            with self._lock, sqlite3.connect(self.loop_db_path, timeout=10) as conn:
                rows = conn.execute(
                    "SELECT day, source, page_group, count FROM loop_sources"
                ).fetchall()
                normalized: Dict[Tuple[str, str, str], int] = {}
                changed = False
                for day, source, page_group, count in rows:
                    new_source = self._loop_normalize_source(source)
                    new_group = self._loop_page_group(page_group)
                    key = ((day or "")[:10], new_source, new_group)
                    normalized[key] = normalized.get(key, 0) + int(count or 0)
                    if new_source != source or new_group != page_group:
                        changed = True
                if not changed:
                    return
                conn.execute("DELETE FROM loop_sources")
                conn.executemany(
                    """INSERT INTO loop_sources (day, source, page_group, count, updated_at)
                       VALUES (?,?,?,?,?)""",
                    [
                        (day, source, group, count, time.time())
                        for (day, source, group), count in normalized.items()
                    ],
                )
        except Exception as error:
            terminal.warn(f"回路来源清洗失败: {error}", "loop")

    def _migrate_loop_from_users_db(self) -> None:
        """把旧 users.db 里的回路表复制到 loop.db，确认后再删旧表。"""
        if not os.path.exists(self.db_path):
            return
        source = None
        target = None
        try:
            source = sqlite3.connect(self.db_path, timeout=10)
            target = sqlite3.connect(self.loop_db_path, timeout=10)
            existing = {
                row[0] for row in source.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            for table in self._LOOP_TABLES:
                if table not in existing:
                    continue
                source_cols = [
                    row[1] for row in source.execute(f"PRAGMA table_info({table})").fetchall()
                ]
                target_cols = {
                    row[1] for row in target.execute(f"PRAGMA table_info({table})").fetchall()
                }
                shared_cols = [col for col in source_cols if col in target_cols]
                if not shared_cols:
                    continue
                select_sql = f"SELECT {','.join(shared_cols)} FROM {table}"
                rows = source.execute(select_sql).fetchall()
                source_count = len(rows)
                if rows:
                    placeholders = ",".join("?" for _ in shared_cols)
                    insert_sql = (
                        f"INSERT OR IGNORE INTO {table} ({','.join(shared_cols)}) "
                        f"VALUES ({placeholders})"
                    )
                    target.executemany(insert_sql, rows)
                    target.commit()
                target_count = target.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                if target_count < source_count:
                    terminal.warn(
                        f"回路迁移未完整，保留 users.db 中的 {table}: "
                        f"{target_count}/{source_count}",
                        "loop",
                    )
                    continue
                source.execute(f"DROP TABLE IF EXISTS {table}")
                source.commit()
        except Exception as error:
            terminal.warn(f"回路数据迁移失败，旧表保持不变: {error}", "loop")
        finally:
            try:
                if source is not None:
                    source.close()
                if target is not None:
                    target.close()
            except Exception:
                pass

    @staticmethod
    def _loop_normalize_source(value: str) -> str:
        """只留来源域名；完整 URL、query、IP、UA 都不进库。"""
        raw = (value or "").strip()
        if not raw:
            return "direct"
        try:
            if raw.startswith(("http://", "https://")):
                host = urlparse(raw).hostname or ""
            else:
                host = urlparse("//" + raw).hostname or ""
        except Exception:
            host = ""
        host = (host or "").strip().lower().strip(".")
        if host.startswith("www."):
            host = host[4:]
        # 不存 IP：IPv4、IPv6 都当未知来源，避免“来源”变成人的地址。
        if re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", host) or ":" in host:
            return "unknown"
        if not re.fullmatch(r"[a-z0-9.-]{1,120}", host):
            return "unknown"
        return host

    @staticmethod
    def _loop_page_group(value: str) -> str:
        """页面组白名单；未知页面统一归 other。"""
        raw = (value or "").strip()
        if raw in LOOP_PAGE_GROUPS:
            return raw
        if not raw:
            return "other"
        try:
            path = urlparse(raw).path if raw.startswith(("http://", "https://")) else raw
        except Exception:
            path = raw
        path = "/" + path.split("?")[0].split("#")[0].strip().lstrip("/")
        path = path.lower()
        if path in {"/", "/index.html", "/index.htm"}:
            return "home"
        if path == "/mrhua" or path.startswith("/mrhua/"):
            return "mrhua"
        if path in {"/desktop", "/desktop.html"} or path.startswith("/desktop/"):
            return "desktop"
        if path in {"/subscribe", "/subscribe.html"} or path.startswith("/subscribe/"):
            return "subscribe"
        if path == "/docs" or path.startswith("/docs/"):
            return "docs"
        return "other"

    @staticmethod
    def _loop_path_only(value: str) -> str:
        raw = (value or "").strip()
        if not raw:
            return ""
        try:
            path = urlparse(raw).path if raw.startswith(("http://", "https://")) else raw
        except Exception:
            path = raw
        return "/" + path.split("?")[0].split("#")[0].strip().lstrip("/")

    @staticmethod
    def _loop_config_path(name: str) -> str:
        path = os.path.join(get_data_dir(), "config", name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        return path

    def _loop_pepper(self) -> str:
        env_value = os.environ.get("AEVUM_LOOP_HASH_PEPPER", "").strip()
        if env_value:
            return env_value
        path = self._loop_config_path("loop.pepper")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as handle:
                value = handle.read().strip()
            if value:
                return value
        value = secrets.token_hex(32)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(value)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        return value

    def _loop_fernet(self):
        """邮箱字段加密；密钥不进数据库、不进备份。"""
        try:
            from cryptography.fernet import Fernet
        except Exception as error:
            raise RuntimeError(
                "邮箱加密不可用：当前 Python 缺少 cryptography。"
                "请在 D:\\venv 或部署环境安装后重试。"
            ) from error
        env_key = os.environ.get("AEVUM_LOOP_KEY", "").strip()
        if env_key:
            return Fernet(env_key.encode("utf-8"))
        path = self._loop_config_path("loop.key")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as handle:
                key = handle.read().strip()
        else:
            key = Fernet.generate_key().decode("ascii")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(key)
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass
        return Fernet(key.encode("utf-8"))

    def _loop_email_hash(self, email: str) -> str:
        pepper = self._loop_pepper().encode("utf-8")
        normalized = email.strip().lower()
        return hmac.new(pepper, normalized.encode("utf-8"), hashlib.sha256).hexdigest()

    @staticmethod
    def _loop_mask_email(email: str) -> str:
        email = email.strip()
        if "@" not in email:
            return ""
        local, domain = email.split("@", 1)
        return f"{local[:1]}***@{domain}"

    @staticmethod
    def _loop_token_hash(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def _loop_new_token(self, fernet) -> Tuple[str, str, str]:
        token = secrets.token_urlsafe(32)
        return (
            self._loop_token_hash(token),
            fernet.encrypt(token.encode("utf-8")).decode("ascii"),
            token,
        )

    def _loop_audit(self, action: str, subject: str = "", resource: str = "") -> None:
        # 只记动作与对象，不记邮箱、不记 token。
        try:
            with self._lock, sqlite3.connect(self.loop_db_path, timeout=10) as conn:
                conn.execute(
                    "INSERT INTO loop_audit (action, subject, resource, created_at) VALUES (?,?,?,?)",
                    (action, subject, resource, time.time()),
                )
        except Exception as error:
            terminal.warn(f"回路审计写入失败: {error}", "loop")

    def _loop_mail_config(self) -> Dict[str, Any]:
        """内部提醒的 SMTP 配置。口令只放本地 config/mail.json 或环境变量。"""
        config: Dict[str, Any] = {
            "smtp_host": "smtp.qiye.aliyun.com",
            "smtp_port": 465,
            "use_ssl": True,
            "username": "open@mrhua.cn",
            "password": "",
            "from_addr": "open@mrhua.cn",
            "to_addr": "open@mrhua.cn",
        }
        path = self._loop_config_path("mail.json")
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    saved = json.load(handle)
                if isinstance(saved, dict):
                    for key in config:
                        if key in saved and saved[key] not in (None, ""):
                            config[key] = saved[key]
            except Exception as error:
                terminal.warn(f"读取 mail.json 失败: {error}", "loop")
        env_map = {
            "smtp_host": "AEVUM_LOOP_MAIL_HOST",
            "smtp_port": "AEVUM_LOOP_MAIL_PORT",
            "username": "AEVUM_LOOP_MAIL_USER",
            "password": "AEVUM_LOOP_MAIL_PASSWORD",
            "from_addr": "AEVUM_LOOP_MAIL_FROM",
            "to_addr": "AEVUM_LOOP_MAIL_TO",
        }
        for key, env_name in env_map.items():
            value = os.environ.get(env_name, "").strip()
            if value:
                config[key] = value
        use_ssl = os.environ.get("AEVUM_LOOP_MAIL_SSL", "").strip().lower()
        if use_ssl:
            config["use_ssl"] = use_ssl in {"1", "true", "yes", "on"}
        try:
            config["smtp_port"] = int(config["smtp_port"])
        except (TypeError, ValueError):
            config["smtp_port"] = 465
        config["use_ssl"] = bool(config["use_ssl"] or config["smtp_port"] == 465)
        config["enabled"] = bool(
            config["smtp_host"] and config["username"] and config["password"] and config["to_addr"]
        )
        return config

    def _loop_notify_owner(self, email: str, scope: str, page: str, subscription_id: str) -> None:
        """只给站长企业邮箱发内部提醒；订阅者不会收到这封信。"""
        config = self._loop_mail_config()
        if not config.get("enabled"):
            terminal.warn("回路内部提醒未启用：缺少 config/mail.json 的 SMTP 口令", "loop")
            return
        try:
            from libertas.observability.notifications import get_notification_center
            center = get_notification_center()
            center.configure_channel(
                "email",
                smtp_server=config["smtp_host"],
                smtp_port=config["smtp_port"],
                username=config["username"],
                password=config["password"],
                from_addr=config["from_addr"],
                to_addrs=[config["to_addr"]],
                use_ssl=config["use_ssl"],
                min_level="info",
                enabled=True,
            )
            center.start_worker()
            center.notify(
                title="Aevum 新订阅待确认 · " + self._loop_mask_email(email),
                message=(
                    "收到一条新的订阅登记，尚未确认。\n\n"
                    f"邮箱：{email}\n"
                    f"订阅范围：{scope}\n"
                    f"同意页面：{page or '/subscribe'}\n"
                    f"登记时间：{time.strftime('%Y-%m-%d %H:%M:%S')}\n"
                    f"订阅编号：{subscription_id}\n\n"
                    "这封信只发给站长；订阅者不会收到它。\n"
                    "确认链接没有附在邮件里，请在管理端查看完整邮箱和确认链接，再手动发信。"
                ),
                level="info",
                source="loop",
                category="subscription:" + subscription_id,
                channels=["email"],
            )
        except Exception as error:
            terminal.warn(f"回路内部提醒发送失败: {error}", "loop")

    @staticmethod
    def _loop_valid_email(email: str) -> bool:
        return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email))

    def loop_subscribe(
        self,
        email: str,
        scope: str = "release",
        consent_page: str = "",
    ) -> Dict[str, Any]:
        """登记一条待确认订阅；公开接口永远不返回 token。"""
        email = (email or "").strip().lower()
        if not self._loop_valid_email(email):
            return {"ok": False, "error": "邮箱格式不正确"}
        scope = (scope or "release").strip()[:120]
        if not scope:
            return {"ok": False, "error": "订阅事项不能为空"}
        # 同意页只留路径，不带 query；报名证据不需要搜索词和完整 URL。
        consent_page = self._loop_path_only(consent_page)[:240]
        email_hash = self._loop_email_hash(email)
        fernet = self._loop_fernet()
        now = time.time()

        with self._lock, sqlite3.connect(self.loop_db_path, timeout=10) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT * FROM loop_subscriptions WHERE email_hash=?",
                (email_hash,),
            ).fetchone()
            if row and row["status"] == "confirmed":
                return {
                    "ok": True,
                    "status": "confirmed",
                    "subscription_id": row["subscription_id"],
                    "message": "这个邮箱已经在名单里，不需要重复报名。",
                }
            # 同一邮箱重复提交待确认记录时不再提醒，避免站长邮箱被重复打扰。
            should_notify = row is None or row["status"] != "pending"

            confirm_hash, confirm_enc, _confirm_token = self._loop_new_token(fernet)
            unsub_hash, unsub_enc, _unsub_token = self._loop_new_token(fernet)
            subscription_id = (
                row["subscription_id"] if row else "sub_" + secrets.token_hex(12)
            )
            values = (
                fernet.encrypt(email.encode("utf-8")).decode("ascii"),
                self._loop_mask_email(email),
                email_hash,
                scope,
                now,
                consent_page,
                confirm_hash,
                confirm_enc,
                unsub_hash,
                unsub_enc,
                "pending",
                now,
                now,
            )
            if row:
                conn.execute(
                    """UPDATE loop_subscriptions SET
                       email_enc=?, email_masked=?, email_hash=?, scope=?, consent_at=?,
                       consent_page=?, confirm_token_hash=?, confirm_token_enc=?,
                       unsubscribe_token_hash=?, unsubscribe_token_enc=?, status=?,
                       confirmed_at=0, unsubscribed_at=0, updated_at=?
                       WHERE subscription_id=?""",
                    values + (subscription_id,),
                )
            else:
                conn.execute(
                    """INSERT INTO loop_subscriptions
                       (email_enc, email_masked, email_hash, scope, consent_at,
                        consent_page, confirm_token_hash, confirm_token_enc,
                        unsubscribe_token_hash, unsubscribe_token_enc, status,
                        created_at, updated_at, subscription_id)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    values + (subscription_id,),
                )
        self._loop_audit("subscribe_pending", subscription_id, scope)
        if should_notify:
            self._loop_notify_owner(email, scope, consent_page, subscription_id)
        return {
            "ok": True,
            "status": "pending",
            "subscription_id": subscription_id,
            "message": "已登记。请等确认链接点开后再算正式订阅。",
        }

    def loop_confirm(self, token: str) -> Dict[str, Any]:
        token = (token or "").strip()
        if not token:
            return {"ok": False, "error": "缺少确认令牌"}
        token_hash = self._loop_token_hash(token)
        with self._lock, sqlite3.connect(self.loop_db_path, timeout=10) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT * FROM loop_subscriptions WHERE confirm_token_hash=?",
                (token_hash,),
            ).fetchone()
            if not row:
                return {"ok": False, "error": "确认链接无效或已过期"}
            if row["status"] == "unsubscribed":
                return {"ok": False, "error": "这个邮箱已经退订"}
            # 确认链接一次性使用：确认后清掉确认 token，避免重放。
            conn.execute(
                """UPDATE loop_subscriptions SET status='confirmed', confirmed_at=?,
                   confirm_token_hash='', confirm_token_enc='', updated_at=?
                   WHERE subscription_id=?""",
                (time.time(), time.time(), row["subscription_id"]),
            )
        self._loop_audit("confirm", row["subscription_id"], "")
        return {"ok": True, "subscription_id": row["subscription_id"]}

    def loop_unsubscribe(self, token: str) -> Dict[str, Any]:
        token = (token or "").strip()
        if not token:
            return {"ok": False, "error": "缺少退订令牌"}
        token_hash = self._loop_token_hash(token)
        with self._lock, sqlite3.connect(self.loop_db_path, timeout=10) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT * FROM loop_subscriptions WHERE unsubscribe_token_hash=?",
                (token_hash,),
            ).fetchone()
            if not row:
                return {"ok": False, "error": "退订链接无效或已过期"}
            # 退订后立即删除邮箱密文与掩码，只保留 email_hash 作抑制记录。
            conn.execute(
                """UPDATE loop_subscriptions SET status='unsubscribed',
                   unsubscribed_at=?, email_enc='', email_masked='',
                   confirm_token_hash='', confirm_token_enc='',
                   unsubscribe_token_hash='', unsubscribe_token_enc='', updated_at=?
                   WHERE subscription_id=?""",
                (time.time(), time.time(), row["subscription_id"]),
            )
        self._loop_audit("unsubscribe", row["subscription_id"], "")
        return {"ok": True, "subscription_id": row["subscription_id"]}

    def loop_list(self, status: str = "", include_email: bool = True) -> List[Dict[str, Any]]:
        """管理端名单；include_email=True 时解密邮箱，用于手动发件。"""
        fernet = self._loop_fernet() if include_email else None
        with self._lock, sqlite3.connect(self.loop_db_path, timeout=10) as conn:
            conn.row_factory = sqlite3.Row
            if status:
                rows = conn.execute(
                    "SELECT * FROM loop_subscriptions WHERE status=? ORDER BY consent_at DESC",
                    (status,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM loop_subscriptions ORDER BY consent_at DESC"
                ).fetchall()
        result: List[Dict[str, Any]] = []
        for row in rows:
            email = ""
            if include_email and row["email_enc"]:
                try:
                    email = fernet.decrypt(row["email_enc"].encode("ascii")).decode("utf-8")
                except Exception:
                    email = ""
            confirm_token = ""
            unsub_token = ""
            # token 只给已解锁的管理端；默认打码视图不返回 token 路径。
            if include_email and fernet is not None:
                try:
                    if row["confirm_token_enc"]:
                        confirm_token = fernet.decrypt(
                            row["confirm_token_enc"].encode("ascii")
                        ).decode("utf-8")
                    if row["unsubscribe_token_enc"]:
                        unsub_token = fernet.decrypt(
                            row["unsubscribe_token_enc"].encode("ascii")
                        ).decode("utf-8")
                except Exception:
                    pass
            result.append({
                "subscription_id": row["subscription_id"],
                "email": email,
                "email_masked": row["email_masked"],
                "scope": row["scope"],
                "consent_at": row["consent_at"],
                "consent_page": row["consent_page"],
                "confirmed_at": row["confirmed_at"],
                "unsubscribed_at": row["unsubscribed_at"],
                "status": row["status"],
                "last_contacted": row["last_contacted"],
                "confirm_path": f"/api/loop/confirm?token={confirm_token}" if confirm_token else "",
                "unsubscribe_path": f"/api/loop/unsubscribe?token={unsub_token}" if unsub_token else "",
            })
        return result

    def loop_next_confirmed(self, scope: str = "", include_contacted: bool = False) -> Dict[str, Any]:
        """一屏一人：默认只取下一位从未联系过的已确认订阅者。"""
        scope = (scope or "").strip()[:120]
        fernet = self._loop_fernet()
        with self._lock, sqlite3.connect(self.loop_db_path, timeout=10) as conn:
            conn.row_factory = sqlite3.Row
            where = ["status='confirmed'", "email_enc != ''"]
            params: List[Any] = []
            if scope:
                where.append("scope=?")
                params.append(scope)
            if not include_contacted:
                where.append("last_contacted=0")
            order = (
                "last_contacted ASC, confirmed_at ASC"
                if include_contacted
                else "confirmed_at ASC"
            )
            row = conn.execute(
                f"""SELECT * FROM loop_subscriptions
                    WHERE {' AND '.join(where)}
                    ORDER BY {order}
                    LIMIT 1""",
                tuple(params),
            ).fetchone()
        if not row:
            message = (
                "没有待发送的已确认订阅。"
                if include_contacted
                else "本轮已联系完；若要重发，需要显式打开已联系名单。"
            )
            return {"ok": True, "subscription": None, "message": message}
        email = ""
        unsub_token = ""
        try:
            email = fernet.decrypt(row["email_enc"].encode("ascii")).decode("utf-8")
            if row["unsubscribe_token_enc"]:
                unsub_token = fernet.decrypt(
                    row["unsubscribe_token_enc"].encode("ascii")
                ).decode("utf-8")
        except Exception:
            return {"ok": False, "error": "订阅记录无法解密，请检查 loop.key。"}
        return {
            "ok": True,
            "subscription": {
                "subscription_id": row["subscription_id"],
                "email": email,
                "email_masked": row["email_masked"],
                "scope": row["scope"],
                "confirmed_at": row["confirmed_at"],
                "last_contacted": row["last_contacted"],
                "unsubscribe_path": (
                    f"/api/loop/unsubscribe?token={unsub_token}" if unsub_token else ""
                ),
                "one_at_a_time": True,
            },
        }

    def loop_export(self, status: str = "confirmed") -> List[Dict[str, Any]]:
        rows = self.loop_list(status=status, include_email=True)
        self._loop_audit("export", status, f"{len(rows)} rows")
        return rows

    def loop_mark_contacted(self, subscription_id: str) -> Dict[str, Any]:
        subscription_id = (subscription_id or "").strip()
        if not subscription_id:
            return {"ok": False, "error": "缺少订阅记录"}
        with self._lock, sqlite3.connect(self.loop_db_path, timeout=10) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT status FROM loop_subscriptions WHERE subscription_id=?",
                (subscription_id,),
            ).fetchone()
            if not row:
                return {"ok": False, "error": "订阅记录不存在"}
            if row["status"] != "confirmed":
                return {"ok": False, "error": "只有已确认订阅才能标记已联系"}
            conn.execute(
                "UPDATE loop_subscriptions SET last_contacted=?, updated_at=? WHERE subscription_id=?",
                (time.time(), time.time(), subscription_id),
            )
        self._loop_audit("mark_contacted", subscription_id, "")
        return {"ok": True}

    def loop_delete(self, subscription_id: str) -> Dict[str, Any]:
        subscription_id = (subscription_id or "").strip()
        if not subscription_id:
            return {"ok": False, "error": "缺少订阅记录"}
        with self._lock, sqlite3.connect(self.loop_db_path, timeout=10) as conn:
            exists = conn.execute(
                "SELECT 1 FROM loop_subscriptions WHERE subscription_id=?",
                (subscription_id,),
            ).fetchone()
            if not exists:
                return {"ok": False, "error": "订阅记录不存在"}
            conn.execute("DELETE FROM loop_subscriptions WHERE subscription_id=?", (subscription_id,))
        self._loop_audit("delete", subscription_id, "")
        return {"ok": True}

    def loop_record_source(self, day: str, source: str, page_group: str = "/") -> Dict[str, Any]:
        day = (day or time.strftime("%Y-%m-%d"))[:10]
        # 服务端兜底再清洗一次，调用方塞完整 URL 或搜索词也落不进来。
        source = self._loop_normalize_source(source)
        page_group = self._loop_page_group(page_group)
        with self._lock, sqlite3.connect(self.loop_db_path, timeout=10) as conn:
            conn.execute(
                """INSERT INTO loop_sources (day, source, page_group, count, updated_at)
                   VALUES (?,?,?,1,?)
                   ON CONFLICT(day, source, page_group)
                   DO UPDATE SET count=count+1, updated_at=excluded.updated_at""",
                (day, source, page_group, time.time()),
            )
        return {"ok": True}

    def loop_sources(self, limit: int = 400) -> List[Dict[str, Any]]:
        with self._lock, sqlite3.connect(self.loop_db_path, timeout=10) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM loop_sources ORDER BY day DESC, count DESC LIMIT ?",
                (max(1, min(2000, limit)),),
            ).fetchall()
        return [dict(row) for row in rows]

    def loop_record_wall(
        self,
        platform: str,
        symptom: str,
        target: str = "",
        note: str = "",
        observed_at: float = 0,
    ) -> Dict[str, Any]:
        wall_id = "wall_" + secrets.token_hex(12)
        with self._lock, sqlite3.connect(self.loop_db_path, timeout=10) as conn:
            conn.execute(
                """INSERT INTO loop_walls
                   (wall_id, platform, target, symptom, note, observed_at, created_at)
                   VALUES (?,?,?,?,?,?,?)""",
                (
                    wall_id,
                    (platform or "").strip()[:80],
                    (target or "").strip()[:240],
                    (symptom or "").strip()[:240],
                    (note or "").strip()[:1000],
                    float(observed_at or time.time()),
                    time.time(),
                ),
            )
        self._loop_audit("wall", wall_id, platform)
        return {"ok": True, "wall_id": wall_id}

    def loop_walls(self, limit: int = 200) -> List[Dict[str, Any]]:
        with self._lock, sqlite3.connect(self.loop_db_path, timeout=10) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM loop_walls ORDER BY observed_at DESC LIMIT ?",
                (max(1, min(500, limit)),),
            ).fetchall()
        return [dict(row) for row in rows]

    def loop_summary(self) -> Dict[str, Any]:
        with self._lock, sqlite3.connect(self.loop_db_path, timeout=10) as conn:
            conn.row_factory = sqlite3.Row
            status_rows = conn.execute(
                "SELECT status, COUNT(*) AS count FROM loop_subscriptions GROUP BY status"
            ).fetchall()
            source_total = conn.execute(
                "SELECT COALESCE(SUM(count), 0) FROM loop_sources"
            ).fetchone()[0]
            wall_total = conn.execute("SELECT COUNT(*) FROM loop_walls").fetchone()[0]
            uncontacted = conn.execute(
                """SELECT COUNT(*) FROM loop_subscriptions
                   WHERE status='confirmed' AND email_enc != '' AND last_contacted=0"""
            ).fetchone()[0]
        counts = {row["status"]: row["count"] for row in status_rows}
        return {
            "subscriptions": {
                "pending": counts.get("pending", 0),
                "confirmed": counts.get("confirmed", 0),
                "unsubscribed": counts.get("unsubscribed", 0),
                "total": sum(counts.values()),
                "confirmed_uncontacted": int(uncontacted),
            },
            "source_visits": int(source_total),
            "walls": int(wall_total),
            "manual_send": True,
            "email_encrypted": True,
        }
