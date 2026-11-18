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
    from .auth_loop import AuthLoopMixin
    from .auth_account import AuthAccountMixin
except ImportError:  # 以脚本方式运行
    from auth_loop import AuthLoopMixin
    from auth_account import AuthAccountMixin

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


class AuthAPI(AuthLoopMixin, AuthAccountMixin):
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

