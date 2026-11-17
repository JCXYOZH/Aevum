"""回路订阅 API：只处理“发出去 → 听见 → 下次发得更准”。

从 auth_api.py 拆出来，账号/身份继续留在 auth_api，回路路由只在这里注册。
"""

from __future__ import annotations

import re
import secrets
import sqlite3
import time
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, field_validator

from libertas.foundation.ratelimit import get_rate_limiter
from libertas.identity.user.storage import LOOP_PAGE_GROUPS

COOKIE_NAME = "mrhua_session"


class LoopSubscribeBody(BaseModel):
    email: str
    scope: str = "release"
    page: str = ""

    @field_validator("email")
    @classmethod
    def email_shape(cls, value: str) -> str:
        value = (value or "").strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", value):
            raise ValueError("邮箱格式不正确")
        return value


class LoopVisitBody(BaseModel):
    source: str = ""
    page_group: str = ""
    page: str = ""


class LoopMarkContactedBody(BaseModel):
    subscription_id: str


class LoopDeleteBody(BaseModel):
    subscription_id: str


class LoopWallBody(BaseModel):
    platform: str
    symptom: str
    target: str = ""
    note: str = ""
    observed_at: float = 0


class LoopExportTicketBody(BaseModel):
    password: str


def create_router(api: Any) -> APIRouter:
    router = APIRouter(tags=["loop"])

    def require_user(request: Request):
        token = request.cookies.get(COOKIE_NAME, "")
        user = api.users.validate_session(token) if token else None
        if user is None:
            raise HTTPException(status_code=401, detail="请先登录")
        return user

    @router.post("/api/loop/subscribe")
    def subscribe(body: LoopSubscribeBody):
        if not get_rate_limiter().check("loop_subscribe_public"):
            return {"success": True, "message": "已收到。"}
        try:
            api.users.loop_subscribe(
                body.email,
                scope=body.scope or "release",
                consent_page=body.page,
            )
        except RuntimeError:
            raise HTTPException(status_code=503, detail="订阅暂时不可用")
        # 统一话术：不告诉外部这个邮箱是否已在名单里。
        return {
            "success": True,
            "message": "已收到。请等确认链接点开后再算正式订阅。",
        }

    @router.get("/api/loop/confirm")
    def confirm(token: str = Query("")):
        result = api.users.loop_confirm(token)
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail=result.get("error", "确认失败"))
        return {"success": True, "message": "已确认订阅。"}

    @router.get("/api/loop/unsubscribe")
    def unsubscribe(token: str = Query("")):
        result = api.users.loop_unsubscribe(token)
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail=result.get("error", "退订失败"))
        return {"success": True, "message": "已退订。"}

    @router.post("/api/loop/visit")
    def visit(body: LoopVisitBody, request: Request):
        if not get_rate_limiter().check("loop_visit_public"):
            return {"success": True}
        source = body.source or request.headers.get("referer", "")
        source = api.users._loop_normalize_source(source)
        page_group = api.users._loop_page_group(body.page_group or body.page)
        api.users.loop_record_source(time.strftime("%Y-%m-%d"), source, page_group)
        return {"success": True}

    @router.get("/api/loop/summary")
    def summary(user=Depends(require_user)):
        return {"success": True, "summary": api.users.loop_summary()}

    @router.get("/api/loop/subscriptions")
    def subscriptions(
        status: str = Query(""),
        reveal: bool = Query(False),
        user=Depends(require_user),
    ):
        rows = api.users.loop_list(status=status, include_email=reveal)
        return {"success": True, "subscriptions": rows}

    @router.get("/api/loop/next")
    def next_subscription(
        scope: str = Query(""),
        include_contacted: bool = Query(False),
        user=Depends(require_user),
    ):
        result = api.users.loop_next_confirmed(
            scope=scope, include_contacted=include_contacted
        )
        if not result.get("ok"):
            raise HTTPException(status_code=500, detail=result.get("error", "读取失败"))
        return {"success": True, **result}

    @router.get("/api/loop/sources")
    def sources(limit: int = Query(400), user=Depends(require_user)):
        return {"success": True, "sources": api.users.loop_sources(limit=limit)}

    @router.get("/api/loop/walls")
    def walls(limit: int = Query(200), user=Depends(require_user)):
        return {"success": True, "walls": api.users.loop_walls(limit=limit)}

    @router.post("/api/loop/walls")
    def add_wall(body: LoopWallBody, user=Depends(require_user)):
        if not body.platform.strip() or not body.symptom.strip():
            raise HTTPException(status_code=400, detail="平台和现象都必须填写")
        result = api.users.loop_record_wall(
            platform=body.platform,
            symptom=body.symptom,
            target=body.target,
            note=body.note,
            observed_at=body.observed_at,
        )
        return {"success": True, "result": result}

    @router.post("/api/loop/mark_contacted")
    def mark_contacted(body: LoopMarkContactedBody, user=Depends(require_user)):
        result = api.users.loop_mark_contacted(body.subscription_id)
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail=result.get("error", "标记失败"))
        return {"success": True, **result}

    @router.post("/api/loop/delete")
    def delete(body: LoopDeleteBody, user=Depends(require_user)):
        result = api.users.loop_delete(body.subscription_id)
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail=result.get("error", "删除失败"))
        return {"success": True, **result}

    @router.post("/api/loop/export_ticket")
    def export_ticket(body: LoopExportTicketBody, user=Depends(require_user)):
        if not body.password or not user.verify_password(body.password):
            raise HTTPException(status_code=403, detail="密码错误，不能导出名单")
        now = time.time()
        for key, expires in list(api._export_tickets.items()):
            if expires < now:
                api._export_tickets.pop(key, None)
        ticket = secrets.token_urlsafe(24)
        api._export_tickets[ticket] = now + 60
        return {
            "success": True,
            "ticket": ticket,
            "expires_in": 60,
            "message": "把 ticket 放到 X-Loop-Export-Token 请求头里，60 秒内只能用一次。",
        }

    @router.get("/api/loop/export")
    def export(
        x_loop_export_token: str = Header("", alias="X-Loop-Export-Token"),
        user=Depends(require_user),
    ):
        ticket = (x_loop_export_token or "").strip()
        expires = api._export_tickets.pop(ticket, 0)
        if not ticket or expires < time.time():
            raise HTTPException(
                status_code=403,
                detail="导出需要重新验证密码并申请一次性票据。",
            )
        rows = api.users.loop_export()
        return {
            "success": True,
            "format": "json",
            "count": len(rows),
            "subscriptions": rows,
        }

    @router.get("/api/loop/acceptance")
    def acceptance(user=Depends(require_user)):
        with sqlite3.connect(api.users.db_path) as users_conn:
            user_tables = [
                row[0] for row in users_conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            ]
        return {
            "success": True,
            "manual_send": True,
            "one_at_a_time": True,
            "email_encrypted": True,
            "page_groups": list(LOOP_PAGE_GROUPS),
            "loop_db": api.users.loop_db_path,
            "users_db_tables": user_tables,
            "no_loop_tables_in_users_db": not any(
                name.startswith("loop_") for name in user_tables
            ),
        }

    return router
