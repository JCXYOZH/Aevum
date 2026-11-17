"""MrHua 身份认证 HTTP 适配层。

前端 `app-shell.js` 调用的是 `/api/auth/*`。这里不另造账户体系，而是把请求转给
`libertas.identity.user.UserManager`（账号、密码、会话）与
`libertas.identity.auth_manager.AuthManager`（验证码、许可证、激活、子用户）。
"""

from __future__ import annotations

import json
import os
import re
import secrets
import sqlite3
import time
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from libertas.data.backup import BackupItem, get_backup_manager
from libertas.foundation.ratelimit import get_rate_limiter
from libertas.identity.auth_manager import AuthManager
from libertas.identity.user import UserManager
from libertas.identity.user.storage import LOOP_PAGE_GROUPS

try:
    from .api.capabilities import create_router as create_capabilities_router
    from .api.governance import create_router as create_governance_router
    from .api.loop import create_router as create_loop_router
    from .api.system import create_router as create_system_router
    from .api.visitor import create_router as create_visitor_router
except ImportError:  # 直接以脚本方式运行
    from api.capabilities import create_router as create_capabilities_router
    from api.governance import create_router as create_governance_router
    from api.loop import create_router as create_loop_router
    from api.system import create_router as create_system_router
    from api.visitor import create_router as create_visitor_router

COOKIE_NAME = "mrhua_session"
MAX_BODY = 1_000_000


class AuthAPI:
    """把桌面监控服务的 HTTP 请求接到 Libertas 真实身份模块。"""

    def __init__(self) -> None:
        self.users = UserManager()
        self.auth = AuthManager()
        # 导出一次性票据：先验密码，再发一个 60 秒内只能用一次的 token。
        self._export_tickets: Dict[str, float] = {}
        # 每个登录账号各自记住激活的身份档案，不能共用一个全局 active。
        self._active_sub_by_user: Dict[str, str] = {}
        # 本地验证码登录：只在本机生成、一次性使用；按 user_id 绑定，不信任前端身份。
        self._local_codes: Dict[str, Dict[str, Any]] = {}
        # 订阅是公开接口，先按固定窗口压住枚举和误点重放。
        limiter = get_rate_limiter()
        limiter.configure_fixed_window("loop_subscribe_public", 3600, 60)
        limiter.configure_fixed_window("loop_visit_public", 3600, 600)
        # 本机验证码：同一台机器每分钟最多生成 5 次，避免被页面反复点。
        limiter.configure_fixed_window("auth_local_code", 60, 5)
        # 账号库与回路库分开备份；都走 SQLite 在线快照 + Fernet 加密，
        # 密钥在 LibertasData/config，不进备份目录。
        self.backup = get_backup_manager()
        self.backup.register(BackupItem(
            "users_db",
            self.users.db_path,
            compress=True,
            retention=7,
            sqlite_safe=True,
            encrypt=True,
        ))
        self.backup.register(BackupItem(
            "loop_db",
            self.users.loop_db_path,
            compress=True,
            retention=7,
            sqlite_safe=True,
            encrypt=True,
        ))
        self.backup.start_scheduler(86400.0)

    # ---------------------------------------------------------------- 基础工具
    @staticmethod
    def read_json(handler) -> Optional[dict]:
        try:
            length = int(handler.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                return None
            return json.loads(handler.rfile.read(length).decode("utf-8"))
        except (OSError, ValueError, TypeError):
            return None

    @staticmethod
    def session_token(handler) -> str:
        raw = handler.headers.get("Cookie", "")
        for item in raw.split(";"):
            name, _, value = item.strip().partition("=")
            if name == COOKIE_NAME:
                return value
        return ""

    @staticmethod
    def cookie_header(token: str, clear: bool = False) -> Dict[str, str]:
        if clear:
            return {"Set-Cookie": f"{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"}
        return {"Set-Cookie": f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400"}

    def current_user(self, handler):
        token = self.session_token(handler)
        if not token:
            return None
        return self.users.validate_session(token)

    def require_user(self, handler):
        user = self.current_user(handler)
        if user is None:
            handler._send_json({"success": False, "error": "请先登录", "message": "请先登录"}, 401)
        return user

    def account_info(self, user) -> Dict[str, Any]:
        info = dict(self.auth.get_info() or {})
        if user is not None:
            # 认证身份必须跟会话用户一致；不能把另一个账号的许可证信息读给当前用户。
            if str(info.get("username", "")) != str(user.username):
                info = {}
            info["username"] = user.username
            info["identity_id"] = info.get("identity_id") or user.username
            info["email"] = user.email or info.get("email", "")
            info["phone"] = getattr(user, "phone", "") or info.get("phone", "")
            info.setdefault("tier", "registered")
            info.setdefault("activated", False)
            info["data_scope"] = "user:" + user.user_id
        return info

    def _owned_sub_user(self, user, sid: str) -> Optional[Dict[str, Any]]:
        sub = self.auth.get_sub_user(sid)
        if not sub:
            return None
        if str(sub.get("owner_user_id", "")) != str(user.user_id):
            return None
        return sub

    def _active_sub_user(self, user) -> Optional[Dict[str, Any]]:
        sid = self._active_sub_by_user.get(user.user_id, "")
        if not sid:
            return None
        return self._owned_sub_user(user, sid)

    # ---------------------------------------------------------------- GET 路由
    def handle_get(self, handler, route: str) -> bool:
        if route == "/api/current_user":
            self.current_user_payload(handler)
            return True
        # 回路公开入口：确认 / 退订都靠 token，不需要登录。
        if route == "/api/loop/confirm":
            self.loop_confirm(handler)
            return True
        if route == "/api/loop/unsubscribe":
            self.loop_unsubscribe(handler)
            return True
        # 回路管理端：名单、汇总、来源、墙、导出。
        if route == "/api/loop/summary":
            user = self.require_user(handler)
            if not user:
                return True
            handler._send_json({"success": True, "summary": self.users.loop_summary()})
            return True
        if route == "/api/loop/subscriptions":
            user = self.require_user(handler)
            if not user:
                return True
            query = parse_qs(urlparse(handler.path).query)
            status = (query.get("status", [""])[0] or "").strip()
            reveal = (query.get("reveal", [""])[0] or "").strip().lower()
            rows = self.users.loop_list(
                status=status,
                include_email=reveal in {"1", "true", "yes"},
            )
            handler._send_json({"success": True, "subscriptions": rows})
            return True
        if route == "/api/loop/next":
            user = self.require_user(handler)
            if not user:
                return True
            query = parse_qs(urlparse(handler.path).query)
            scope = (query.get("scope", [""])[0] or "").strip()
            include_contacted = (
                (query.get("include_contacted", [""])[0] or "").strip().lower()
                in {"1", "true", "yes"}
            )
            result = self.users.loop_next_confirmed(
                scope=scope, include_contacted=include_contacted
            )
            status = 200 if result.get("ok") else 500
            handler._send_json({"success": bool(result.get("ok")), **result}, status)
            return True
        if route == "/api/loop/export":
            user = self.require_user(handler)
            if not user:
                return True
            ticket = (handler.headers.get("X-Loop-Export-Token", "") or "").strip()
            expires = self._export_tickets.pop(ticket, 0)
            if not ticket or expires < time.time():
                handler._send_json({"success": False, "message": "导出需要重新验证密码并申请一次性票据。"}, 403)
                return True
            rows = self.users.loop_export()
            handler._send_json({"success": True, "format": "json", "subscriptions": rows})
            return True
        if route == "/api/loop/sources":
            user = self.require_user(handler)
            if not user:
                return True
            handler._send_json({"success": True, "sources": self.users.loop_sources()})
            return True
        if route == "/api/loop/walls":
            user = self.require_user(handler)
            if not user:
                return True
            handler._send_json({"success": True, "walls": self.users.loop_walls()})
            return True
        if route == "/api/loop/acceptance":
            user = self.require_user(handler)
            if not user:
                return True
            with sqlite3.connect(self.users.db_path) as conn:
                user_tables = [
                    row[0] for row in conn.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    ).fetchall()
                ]
            handler._send_json({
                "success": True,
                "manual_send": True,
                "one_at_a_time": True,
                "email_encrypted": True,
                "page_groups": list(LOOP_PAGE_GROUPS),
                "loop_db": self.users.loop_db_path,
                "users_db_tables": user_tables,
                "no_loop_tables_in_users_db": not any(
                    name.startswith("loop_") for name in user_tables
                ),
            })
            return True
        if route == "/api/auth/status":
            self.status(handler)
            return True
        if route == "/api/auth/info":
            user = self.require_user(handler)
            if not user:
                return True
            handler._send_json({"success": True, "info": self.account_info(user)})
            return True
        if route == "/api/auth/subusers":
            user = self.require_user(handler)
            if not user:
                return True
            subs = self.auth.list_sub_users(owner_user_id=user.user_id)
            active_sid = self._active_sub_by_user.get(user.user_id, "")
            for sub in subs:
                sub["active"] = bool(active_sid and sub.get("id") == active_sid)
            handler._send_json({
                "success": True,
                "sub_users": subs,
                "active": self._active_sub_user(user),
                "data_scope": "user:" + user.user_id,
            })
            return True
        if route == "/api/auth/active_profile":
            user = self.require_user(handler)
            if not user:
                return True
            sub = self._active_sub_user(user)
            if not sub:
                handler._send_json({"success": True, "active": None})
            else:
                handler._send_json({
                    "success": True,
                    "active": {
                        "id": sub.get("id", ""),
                        "name": sub.get("name", ""),
                        "identity": sub.get("identity", {}),
                    },
                })
            return True
        return False

    # ---------------------------------------------------------------- POST 路由
    def handle_post(self, handler, route: str) -> bool:
        if route == "/api/loop/subscribe":
            self.loop_subscribe(handler)
            return True
        if route == "/api/loop/visit":
            self.loop_visit(handler)
            return True
        if route == "/api/loop/mark_contacted":
            self.loop_mark_contacted(handler)
            return True
        if route == "/api/loop/walls":
            self.loop_add_wall(handler)
            return True
        if route == "/api/loop/delete":
            self.loop_delete(handler)
            return True
        if route == "/api/loop/export_ticket":
            self.loop_export_ticket(handler)
            return True
        if route == "/api/auth/send_code":
            self.send_code(handler)
            return True
        if route == "/api/auth/verify_code":
            self.verify_code(handler)
            return True
        if route == "/api/auth/register":
            self.register(handler)
            return True
        if route == "/api/auth/login":
            self.login(handler)
            return True
        if route == "/api/auth/logout":
            self.logout(handler)
            return True
        if route == "/api/auth/activate":
            self.activate(handler)
            return True
        if route == "/api/auth/recover":
            self.recover(handler)
            return True
        if route == "/api/auth/reset":
            self.reset(handler)
            return True
        if route == "/api/auth/local_code":
            self.local_code(handler)
            return True
        if route == "/api/auth/local_login":
            self.local_login(handler)
            return True
        if route == "/api/auth/subusers":
            self.add_subuser(handler)
            return True
        if route == "/api/auth/subusers/deactivate":
            user = self.require_user(handler)
            if not user:
                return True
            self._active_sub_by_user.pop(user.user_id, None)
            self.auth.set_active_sub_user("")
            handler._send_json({"success": True})
            return True
        match = re.fullmatch(r"/api/auth/subusers/([^/]+)/identity", route)
        if match:
            self.update_subuser_identity(handler, match.group(1))
            return True
        match = re.fullmatch(r"/api/auth/subusers/([^/]+)/activate", route)
        if match:
            user = self.require_user(handler)
            if not user:
                return True
            if not self._owned_sub_user(user, match.group(1)):
                handler._send_json({"success": False, "error": "档案不存在或不属于当前账号"}, 403)
                return True
            self._active_sub_by_user[user.user_id] = match.group(1)
            self.auth.set_active_sub_user(match.group(1))
            handler._send_json({"success": True})
            return True
        return False

    def handle_delete(self, handler, route: str) -> bool:
        match = re.fullmatch(r"/api/auth/subusers/([^/]+)", route)
        if not match:
            return False
        user = self.require_user(handler)
        if not user:
            return True
        if not self._owned_sub_user(user, match.group(1)):
            handler._send_json({"success": False, "error": "档案不存在或不属于当前账号"}, 403)
            return True
        self._active_sub_by_user.pop(user.user_id, None)
        handler._send_json({"success": self.auth.delete_sub_user(match.group(1))})
        return True

    # ---------------------------------------------------------------- 回路动作
    def loop_confirm(self, handler) -> None:
        token = (parse_qs(urlparse(handler.path).query).get("token", [""])[0] or "").strip()
        result = self.users.loop_confirm(token)
        status = 200 if result.get("ok") else 400
        handler._send_json({
            "success": bool(result.get("ok")),
            "message": "已确认订阅。" if result.get("ok") else result.get("error", "确认失败"),
        }, status)

    def loop_unsubscribe(self, handler) -> None:
        token = (parse_qs(urlparse(handler.path).query).get("token", [""])[0] or "").strip()
        result = self.users.loop_unsubscribe(token)
        status = 200 if result.get("ok") else 400
        handler._send_json({
            "success": bool(result.get("ok")),
            "message": "已退订。" if result.get("ok") else result.get("error", "退订失败"),
        }, status)

    def loop_subscribe(self, handler) -> None:
        if not get_rate_limiter().check("loop_subscribe_public"):
            handler._send_json({"success": True, "message": "已收到。"}, 200)
            return
        body = self.read_json(handler) or {}
        email = str(body.get("email", "")).strip().lower()
        scope = str(body.get("scope", "release")).strip() or "release"
        page = str(body.get("page", "")).strip()
        if not email:
            handler._send_json({"success": False, "message": "请填写邮箱。"}, 400)
            return
        try:
            result = self.users.loop_subscribe(email, scope=scope, consent_page=page)
        except RuntimeError:
            handler._send_json({"success": False, "message": "订阅暂时不可用。"}, 503)
            return
        # 统一话术，不告诉外部这个邮箱是否已在名单里。
        handler._send_json({"success": True, "message": "已收到。请等确认链接点开后再算正式订阅。"}, 200)

    def loop_visit(self, handler) -> None:
        if not get_rate_limiter().check("loop_visit_public"):
            handler._send_json({"success": True}, 200)
            return
        body = self.read_json(handler) or {}
        source = str(body.get("source", "")).strip()
        if not source:
            source = handler.headers.get("Referer", "")
        # 只留域名；query、完整 URL、IP、UA 都在这里丢掉。
        source = self.users._loop_normalize_source(source)
        page_value = str(body.get("page_group", "") or body.get("page", "")).strip()
        page_group = self.users._loop_page_group(page_value)
        self.users.loop_record_source(time.strftime("%Y-%m-%d"), source, page_group)
        handler._send_json({"success": True}, 200)

    def loop_mark_contacted(self, handler) -> None:
        user = self.require_user(handler)
        if not user:
            return
        body = self.read_json(handler) or {}
        subscription_id = str(body.get("subscription_id", "")).strip()
        if not subscription_id:
            handler._send_json({"success": False, "message": "缺少订阅记录。"}, 400)
            return
        result = self.users.loop_mark_contacted(subscription_id)
        status = 200 if result.get("ok") else 400
        handler._send_json({"success": bool(result.get("ok")), **result}, status)

    def loop_add_wall(self, handler) -> None:
        user = self.require_user(handler)
        if not user:
            return
        body = self.read_json(handler) or {}
        platform = str(body.get("platform", "")).strip()
        symptom = str(body.get("symptom", "")).strip()
        if not platform or not symptom:
            handler._send_json({"success": False, "message": "平台和现象都必须填写。"}, 400)
            return
        result = self.users.loop_record_wall(
            platform=platform,
            symptom=symptom,
            target=str(body.get("target", "")).strip(),
            note=str(body.get("note", "")).strip(),
            observed_at=float(body.get("observed_at", 0) or 0),
        )
        handler._send_json({"success": True, "result": result})

    def loop_delete(self, handler) -> None:
        user = self.require_user(handler)
        if not user:
            return
        body = self.read_json(handler) or {}
        subscription_id = str(body.get("subscription_id", "")).strip()
        if not subscription_id:
            handler._send_json({"success": False, "message": "缺少订阅记录。"}, 400)
            return
        result = self.users.loop_delete(subscription_id)
        status = 200 if result.get("ok") else 400
        handler._send_json({"success": bool(result.get("ok")), **result}, status)

    def loop_export_ticket(self, handler) -> None:
        user = self.require_user(handler)
        if not user:
            return
        body = self.read_json(handler) or {}
        password = str(body.get("password", ""))
        if not password or not user.verify_password(password):
            handler._send_json({"success": False, "message": "密码错误，不能导出名单。"}, 403)
            return
        # 清掉过期票据，再发新票据；票据只存在内存，60 秒后失效。
        now = time.time()
        for key, expires in list(self._export_tickets.items()):
            if expires < now:
                self._export_tickets.pop(key, None)
        ticket = secrets.token_urlsafe(24)
        self._export_tickets[ticket] = now + 60
        handler._send_json({
            "success": True,
            "ticket": ticket,
            "expires_in": 60,
            "message": "把 ticket 放到 X-Loop-Export-Token 请求头里，60 秒内只能用一次。",
        })

    # ---------------------------------------------------------------- 具体动作
    def status(self, handler) -> None:
        user = self.current_user(handler)
        # 未登录时不要读全局许可证：那可能是另一个账号的邮箱/手机/许可证。
        info = self.account_info(user) if user is not None else {}
        token = self.session_token(handler)
        handler._send_json({
            "success": True,
            "has_account": bool(self.auth.has_main_account()),
            "authenticated": user is not None,
            "activated": bool(info.get("activated", False)),
            "username": user.username if user is not None else "",
            "identity_id": info.get("identity_id", ""),
            "tier": info.get("tier", "unregistered"),
            "info": info,
        }, headers=self.cookie_header(token) if token else None)

    def current_user_payload(self, handler) -> None:
        user = self.current_user(handler)
        if user is None:
            handler._send_json({"logged_in": False})
            return
        info = self.account_info(user)
        handler._send_json({
            "logged_in": True,
            "username": user.username,
            "identity_id": info.get("identity_id") or user.username,
            "activated": bool(info.get("activated", False)),
            "tier": info.get("tier", "registered"),
            "data_scope": info.get("data_scope", "user:" + user.user_id),
        })

    def send_code(self, handler) -> None:
        body = self.read_json(handler) or {}
        result = self.auth.send_verification_code(
            str(body.get("email", "")).strip(),
            str(body.get("phone", "")).strip(),
            str(body.get("purpose", "register")),
        )
        handler._send_json(result)

    def verify_code(self, handler) -> None:
        body = self.read_json(handler) or {}
        result = self.auth.verify_code(
            str(body.get("email", "")).strip(),
            str(body.get("phone", "")).strip(),
            str(body.get("code", "")).strip(),
            str(body.get("purpose", "register")),
        )
        handler._send_json(result)

    def _find_email_phone_user(self, email: str, phone: str):
        for user in self.users.list_users(limit=500):
            if email and user.email.strip().lower() == email.strip().lower():
                return user
            if phone and getattr(user, "phone", "").strip() == phone.strip():
                return user
        return None

    def register(self, handler) -> None:
        body = self.read_json(handler) or {}
        email = str(body.get("email", "")).strip()
        phone = str(body.get("phone", "")).strip()
        password = str(body.get("password", ""))
        code = str(body.get("verification_code", "") or body.get("code", "")).strip()
        if not email or not phone:
            handler._send_json({"success": False, "error": "邮箱和手机号都必须填写", "message": "邮箱和手机号都必须填写"}, 400)
            return
        if not password or len(password) < 6:
            handler._send_json({"success": False, "error": "密码至少6个字符", "message": "密码至少6个字符"}, 400)
            return
        if not code:
            handler._send_json({"success": False, "error": "验证码不能为空", "message": "验证码不能为空"}, 400)
            return
        if self.auth.has_main_account() or self._find_email_phone_user(email, phone):
            handler._send_json({"success": False, "error": "本地已有主账户，请直接登录或先重置账户",
                                "message": "本地已有主账户，请直接登录或先重置账户"}, 400)
            return
        verified = self.auth.verify_code(email, phone, code, "register")
        if not verified.get("success"):
            handler._send_json(verified, 400)
            return

        license_info = self.auth.generate_license(email=email, phone=phone, tier="registered")
        user, message = self.users.register(license_info["username"], password, email, phone)
        if user is None:
            with self.auth._lock:
                self.auth._licenses.pop(license_info.get("license_key", ""), None)
                self.auth._save()
            handler._send_json({"success": False, "error": message, "message": message}, 400)
            return
        session, login_message = self.users.login(user.username, password)
        if session is None:
            handler._send_json({"success": False, "error": login_message, "message": login_message}, 500)
            return
        handler._send_json({
            "success": True,
            "message": "注册成功！请保存好许可证和激活码，两者同时验证才能激活。",
            "username": user.username,
            "identity_id": license_info.get("identity_id", user.username),
            "license_key": license_info.get("license_key", ""),
            "activation_code": license_info.get("activation_code", ""),
            "tier": "registered",
            "activated": False,
        }, headers=self.cookie_header(session.token))

    def login(self, handler) -> None:
        body = self.read_json(handler) or {}
        username = str(body.get("username", "")).strip()
        password = str(body.get("password", ""))
        if not username or not password:
            handler._send_json({"success": False, "error": "用户名和密码不能为空", "message": "用户名和密码不能为空"}, 400)
            return
        user = self.users.get_user(username)
        if user is None and ("@" in username or username.isdigit()):
            user = self._find_email_phone_user(username, username)
        if user is None:
            handler._send_json({"success": False, "error": "用户名或密码错误", "message": "用户名或密码错误"}, 401)
            return
        session, message = self.users.login(user.username, password)
        if session is None:
            handler._send_json({"success": False, "error": message, "message": message}, 401)
            return
        info = self.account_info(user)
        handler._send_json({
            "success": True,
            "message": "登录成功",
            "username": user.username,
            "identity_id": info.get("identity_id") or user.username,
            "tier": info.get("tier", "registered"),
            "activated": bool(info.get("activated", False)),
            "data_scope": info.get("data_scope", "user:" + user.user_id),
        }, headers=self.cookie_header(session.token))

    def logout(self, handler) -> None:
        token = self.session_token(handler)
        user = self.current_user(handler)
        if token:
            self.users.logout(token)
        if user is not None:
            self.users.logout_all(user.user_id)
        handler._send_json({"success": True}, headers=self.cookie_header("", clear=True))

    def activate(self, handler) -> None:
        user = self.require_user(handler)
        if not user:
            return
        body = self.read_json(handler) or {}
        result = self.auth.activate(
            str(body.get("license_key", "")).strip(),
            str(body.get("activation_code", "")).strip(),
            str(body.get("code", "")).strip(),
        )
        handler._send_json(result)

    def _license_for(self, email: str, phone: str) -> Optional[dict]:
        for item in self.auth._licenses.values():
            if email and str(item.get("email", "")).strip().lower() == email.strip().lower():
                return item
            if phone and str(item.get("phone", "")).strip() == phone.strip():
                return item
        return None

    def recover(self, handler) -> None:
        body = self.read_json(handler) or {}
        email = str(body.get("email", "")).strip()
        phone = str(body.get("phone", "")).strip()
        license_info = self._license_for(email, phone)
        if license_info is None:
            handler._send_json({"success": False, "error": "本地没有注册过该邮箱/手机号", "message": "本地没有注册过该邮箱/手机号"}, 404)
            return
        handler._send_json({
            "success": True,
            "message": "已找到账户",
            "username": license_info.get("username", ""),
            "identity_id": license_info.get("identity_id", ""),
            "license_key": license_info.get("license_key", ""),
            "created_at": self._created_at(license_info),
            "activated": bool(license_info.get("activated", False)),
        })

    @staticmethod
    def _created_at(license_info: dict) -> str:
        from datetime import datetime

        try:
            return datetime.fromtimestamp(float(license_info.get("created_at", 0))).strftime("%Y-%m-%d")
        except (TypeError, ValueError, OSError):
            return ""

    def reset(self, handler) -> None:
        body = self.read_json(handler) or {}
        email = str(body.get("email", "")).strip()
        phone = str(body.get("phone", "")).strip()
        password = str(body.get("password", ""))
        if not email or not phone or not password:
            handler._send_json({"success": False, "error": "邮箱、手机号、密码都必须填写",
                                "message": "邮箱、手机号、密码都必须填写"}, 400)
            return
        license_info = self._license_for(email, phone)
        if license_info is None:
            handler._send_json({"success": False, "error": "本地没有注册过该邮箱/手机号",
                                "message": "本地没有注册过该邮箱/手机号"}, 404)
            return
        username = str(license_info.get("username", ""))

        def verify(password_value: str) -> bool:
            candidate = self.users.get_user(username)
            return bool(candidate and candidate.verify_password(password_value))

        result = self.auth.reset_account(email, phone, password, verify_password_cb=verify)
        if result.get("success"):
            self.users.delete_user(username)
            self.users.logout_all()
        handler._send_json(result, headers=self.cookie_header("", clear=True) if result.get("success") else None)

    # ---------------------------------------------------------------- 子用户
    def add_subuser(self, handler) -> None:
        user = self.require_user(handler)
        if not user:
            return
        body = self.read_json(handler) or {}
        result = self.auth.add_sub_user(
            str(body.get("name", "")).strip(),
            str(body.get("role", "sub")),
            body.get("identity") or {},
            owner_user_id=user.user_id,
        )
        if result.get("success"):
            # 身份档案同时落成一个独立登录账号：这样每个档案有自己的 user_id、
            # 会话和数据作用域，不会和主账号共用一个身份。
            login_name = str(body.get("login_name", "")).strip() or ("sub_" + result["sub_id"])
            password = str(body.get("password", "")) or secrets.token_urlsafe(12)
            sub_user, message = self.users.register(
                login_name, password, email="", phone="", role="sub",
            )
            if sub_user is not None:
                self.auth.update_sub_user_extra(
                    result["sub_id"],
                    login_name=sub_user.username,
                    account_user_id=sub_user.user_id,
                )
                result["login_name"] = sub_user.username
                result["data_scope"] = "user:" + sub_user.user_id
            else:
                result["warning"] = message
        handler._send_json(result)

    def update_subuser_identity(self, handler, sid: str) -> None:
        user = self.require_user(handler)
        if not user:
            return
        body = self.read_json(handler) or {}
        if not self._owned_sub_user(user, sid):
            handler._send_json({"success": False, "error": "档案不存在或不属于当前账号"}, 403)
            return
        handler._send_json({"success": self.auth.update_sub_user_identity(sid, body.get("identity") or {})})


    # ---------------------------------------------------------------- 本地验证码登录
    def _is_local_request(self, handler) -> bool:
        """只允许本机生成验证码；远端页面拿不到码，也拿不到登录入口。"""
        try:
            host = str(handler.client_address[0])
        except Exception:
            return False
        return host in {"127.0.0.1", "::1", "localhost"}

    def local_code(self, handler) -> None:
        """本机中继生成一次性登录码。

        码只在本机生成、只在本机显示，页面用户拿到码后可以登录；
        不经过邮件/短信，也不把码写进 URL。
        """
        if not self._is_local_request(handler):
            handler._send_json({"success": False, "error": "本机验证码只能在本地生成"}, 403)
            return
        if not get_rate_limiter().check("auth_local_code"):
            handler._send_json({"success": False, "error": "请求过于频繁，请稍后再试"}, 429)
            return
        body = self.read_json(handler) or {}
        username = str(body.get("username", "")).strip()
        user = self.users.get_user(username)
        if user is None:
            handler._send_json({"success": False, "error": "用户不存在"}, 404)
            return
        code = str(secrets.randbelow(900000) + 100000)
        self._local_codes[user.user_id] = {
            "code": code,
            "username": user.username,
            "created_at": time.time(),
            "expires_at": time.time() + 300,
            "attempts": 0,
        }
        handler._send_json({
            "success": True,
            "message": "本机验证码已生成，请在 5 分钟内输入",
            "code": code,
            "username": user.username,
            "expires_in": 300,
        })

    def local_login(self, handler) -> None:
        """用本机生成的一次性码登录，签发普通会话。"""
        body = self.read_json(handler) or {}
        username = str(body.get("username", "")).strip()
        code = str(body.get("code", "")).strip()
        user = self.users.get_user(username)
        if user is None:
            handler._send_json({"success": False, "error": "用户不存在"}, 401)
            return
        record = self._local_codes.get(user.user_id)
        if not record:
            handler._send_json({"success": False, "error": "请先在本机生成验证码"}, 400)
            return
        if time.time() > record["expires_at"]:
            self._local_codes.pop(user.user_id, None)
            handler._send_json({"success": False, "error": "验证码已过期"}, 400)
            return
        record["attempts"] += 1
        if record["attempts"] > 5:
            self._local_codes.pop(user.user_id, None)
            handler._send_json({"success": False, "error": "尝试次数过多，请重新生成"}, 429)
            return
        if not secrets.compare_digest(str(record["code"]), code):
            handler._send_json({"success": False, "error": "验证码错误"}, 401)
            return
        self._local_codes.pop(user.user_id, None)
        session = self.users.issue_session(user, self._client_ip(handler), self._user_agent(handler))
        info = self.account_info(user)
        handler._send_json({
            "success": True,
            "message": "登录成功",
            "username": user.username,
            "identity_id": info.get("identity_id") or user.username,
            "tier": info.get("tier", "registered"),
            "activated": bool(info.get("activated", False)),
            "data_scope": info.get("data_scope", "user:" + user.user_id),
        }, headers=self.cookie_header(session.token))

    def _client_ip(self, handler) -> str:
        try:
            return str(handler.client_address[0])
        except Exception:
            return ""

    def _user_agent(self, handler) -> str:
        try:
            return str(handler.headers.get("User-Agent", ""))[:200]
        except Exception:
            return ""


def create_fastapi_app():
    """FastAPI 按领域装载：capabilities / system / loop / visitor。

    账号认证与 /api/auth/* 仍由 desktop_server 里的 AuthAPI 适配；这里只承载
    FastAPI 侧的回路、系统状态、能力清单和访客入口。

    启动示例：
        uvicorn apps.console.monitor.auth_api:create_fastapi_app --factory \
            --host 127.0.0.1 --port 8781 --no-access-log

    必须带 --no-access-log：确认/退订 token 在 URL 里，访问日志不能记。
    """
    api = AuthAPI()

    app = FastAPI(
        title="Aevum Loop API",
        version="0.2",
        description="发出去 → 听见 → 下次发得更准。只接回路，不搬内容。",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:8799",
            "http://localhost:8799",
            "http://127.0.0.1:8781",
            "http://localhost:8781",
            "https://mrhua.cn",
            "https://www.mrhua.cn",
        ],
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    app.state.loop_api = api
    app.include_router(create_capabilities_router())
    app.include_router(create_system_router(api))
    app.include_router(create_loop_router(api))
    app.include_router(create_visitor_router(api))
    app.include_router(create_governance_router(api))

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, error: HTTPException):
        return JSONResponse(
            status_code=error.status_code,
            content={"success": False, "message": str(error.detail)},
        )

    return app

