"""账号、验证码、许可证与子账号的 HTTP 适配。

从 `auth_api.py` 拆出，避免登录、注册、子账号与回路订阅共用一个超大类。
"""

from __future__ import annotations

import secrets
from typing import Optional

from libertas.foundation.ratelimit import get_rate_limiter


class AuthAccountMixin:
    """账号/验证码/许可证/子账号动作。"""

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

