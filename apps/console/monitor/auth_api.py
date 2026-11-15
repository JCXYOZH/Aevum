"""MrHua 身份认证 HTTP 适配层。

前端 `app-shell.js` 调用的是 `/api/auth/*`。这里不另造账户体系，而是把请求转给
`libertas.identity.user.UserManager`（账号、密码、会话）与
`libertas.identity.auth_manager.AuthManager`（验证码、许可证、激活、子用户）。
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional

from libertas.identity.auth_manager import AuthManager
from libertas.identity.user import UserManager

COOKIE_NAME = "mrhua_session"
MAX_BODY = 1_000_000


class AuthAPI:
    """把桌面监控服务的 HTTP 请求接到 Libertas 真实身份模块。"""

    def __init__(self) -> None:
        self.users = UserManager()
        self.auth = AuthManager()

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
            # 许可证里的用户名才是认证身份；会话用户名只用于校验。
            if not info.get("username"):
                info["username"] = user.username
            if not info.get("identity_id"):
                info["identity_id"] = user.username
        return info

    # ---------------------------------------------------------------- GET 路由
    def handle_get(self, handler, route: str) -> bool:
        if route == "/api/current_user":
            self.current_user_payload(handler)
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
            handler._send_json({
                "success": True,
                "sub_users": self.auth.list_sub_users(),
                "active": self.auth.get_active_sub_user(),
            })
            return True
        if route == "/api/auth/active_profile":
            user = self.require_user(handler)
            if not user:
                return True
            sub = self.auth.get_active_sub_user()
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
        if route == "/api/auth/subusers":
            self.add_subuser(handler)
            return True
        if route == "/api/auth/subusers/deactivate":
            user = self.require_user(handler)
            if not user:
                return True
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
        handler._send_json({"success": self.auth.delete_sub_user(match.group(1))})
        return True

    # ---------------------------------------------------------------- 具体动作
    def status(self, handler) -> None:
        user = self.current_user(handler)
        info = self.account_info(user)
        if user is None:
            info = {k: v for k, v in info.items() if k not in ("license_key", "activation_code")}
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
        )
        handler._send_json(result)

    def update_subuser_identity(self, handler, sid: str) -> None:
        user = self.require_user(handler)
        if not user:
            return
        body = self.read_json(handler) or {}
        handler._send_json({"success": self.auth.update_sub_user_identity(sid, body.get("identity") or {})})
