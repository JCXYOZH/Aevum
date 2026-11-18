"""回路订阅的 HTTP 适配。

只负责把 `/api/loop/*` 请求转成 `UserManager` 的订阅动作；账号与会话
仍由 `AuthAPI` 基础层处理。
"""

from __future__ import annotations

import secrets
import time
from urllib.parse import parse_qs, urlparse

from libertas.foundation.ratelimit import get_rate_limiter
from libertas.identity.user.storage import LOOP_PAGE_GROUPS


class AuthLoopMixin:
    """回路公开入口与管理端动作。"""

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

