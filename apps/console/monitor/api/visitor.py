"""访客入口、公开社区概览与隔离数据作用域。

这一层只做两件事：
1. 给未登录访客一个稳定的、可撤销的访客身份和数据作用域；
2. 把作用域解析成本机目录，目录路径永远不进入 API 响应。

WAN 只应该传播 ``user:<id>`` / ``guest:<id>`` 这种不透明作用域，不传播
``D:\\...`` 之类的服务器路径。其它节点拿到作用域后，只能在自己本机
``user_data`` 下解析出对应目录，不能直接访问本机路径。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from libertas.foundation.config import get_data_dir

VISITOR_COOKIE = "mrhua_visitor"
SESSION_COOKIE = "mrhua_session"
VISITOR_MAX_AGE = 30 * 86400
GUEST_DAILY_MESSAGES = 30
GUEST_RETENTION_DAYS = 30
_SCOPE_RE = re.compile(r"^(user|guest):([A-Za-z0-9_-]{1,80})$")
_GUEST_RE = re.compile(r"^g_[A-Za-z0-9_-]{8,80}$")

# 访客能做什么/不能做什么。这不是角色模型，只是公开接口的权限说明；
# 真正写操作仍由各 API 自己校验，前端不能拿这段 JSON 当授权凭证。
GUEST_PERMISSIONS = {
    "community.view": True,
    "community.wan": True,
    "community.chat_text": True,
    "chat.send": True,
    "chat.files": False,
    "community.create_room": False,
    "community.vote": False,
    "community.propose": False,
    "community.manage": False,
}

ROLE_CULTURE = [
    {
        "id": "guest",
        "label": "访客",
        "description": "不用注册就能看社区概览、进入公共广域网房间、和 AI 对话；不能上传文件、不能投票或管理社区。",
    },
    {
        "id": "member",
        "label": "成员",
        "description": "注册用户。拥有自己的隔离数据目录，可保存对话、使用文件与回路订阅。",
    },
    {
        "id": "contributor",
        "label": "贡献者",
        "description": "持续参与文档、代码或社区内容建设的成员；权限仍按社区规则单独授予。",
    },
    {
        "id": "maintainer",
        "label": "维护者",
        "description": "维护一个具体项目或模块，不自动获得平台管理权。",
    },
]

_PRUNE_LOCK = threading.Lock()
_LAST_PRUNE = 0.0


def new_guest_id() -> str:
    """生成不可预测的访客 ID；不包含邮箱、IP 或设备指纹。"""
    return "g_" + secrets.token_urlsafe(18)


def scope_for_user(user_id: str) -> str:
    return "user:" + str(user_id)


def scope_for_guest(visitor_id: str) -> str:
    """Cookie 里是访客口令，广域网上只传播它的单向摘要。

    这样即使 presence 被别的节点看到，也无法拿摘要反推出 Cookie、冒充访客。
    """
    visitor_id = str(visitor_id or "").strip()
    if not visitor_id:
        return ""
    digest = hashlib.sha256(("mrhua_visitor:" + visitor_id).encode("utf-8")).hexdigest()[:32]
    return "guest:" + digest


def parse_scope(scope: str) -> Tuple[str, str]:
    match = _SCOPE_RE.match(str(scope or ""))
    if not match:
        raise ValueError("invalid data scope")
    return match.group(1), match.group(2)


def scope_dir(scope: str) -> Path:
    """把作用域解析成本机目录；调用方拿不到路径。"""
    kind, ident = parse_scope(scope)
    root = Path(get_data_dir()) / "user_data" / ("users" if kind == "user" else "guests") / ident
    root.mkdir(parents=True, exist_ok=True)
    return root


def chat_history_path(scope: str) -> Path:
    return scope_dir(scope) / "chat_history.json"


def quota_path(scope: str) -> Path:
    return scope_dir(scope) / "chat_quota.json"


def read_json_file(path: Path, default: Any) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError, TypeError):
        return default


def write_json_file(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def cookie_from_header(handler, name: str) -> str:
    try:
        raw = str(handler.headers.get("Cookie", ""))
    except Exception:
        return ""
    for part in raw.split(";"):
        key, _, value = part.strip().partition("=")
        if key == name:
            return value.strip()
    return ""


def visitor_id_from_handler(handler) -> str:
    value = cookie_from_header(handler, VISITOR_COOKIE)
    return value if _GUEST_RE.match(value) else ""


def visitor_cookie_header(visitor_id: str) -> str:
    return (
        f"{VISITOR_COOKIE}={visitor_id}; Path=/; HttpOnly; SameSite=Lax; "
        f"Max-Age={VISITOR_MAX_AGE}"
    )


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def quota_status(scope: str) -> Dict[str, Any]:
    payload = read_json_file(quota_path(scope), {})
    if payload.get("date") != _today():
        payload = {"date": _today(), "used": 0}
    used = max(0, int(payload.get("used", 0) or 0))
    remaining = max(0, GUEST_DAILY_MESSAGES - used)
    return {
        "date": _today(),
        "used": used,
        "limit": GUEST_DAILY_MESSAGES,
        "remaining": remaining,
        "exhausted": remaining <= 0,
    }


def consume_quota(scope: str) -> Dict[str, Any]:
    status = quota_status(scope)
    if status["exhausted"]:
        return status
    payload = {"date": _today(), "used": status["used"] + 1}
    write_json_file(quota_path(scope), payload)
    return {**status, "used": payload["used"], "remaining": max(0, status["remaining"] - 1)}


def _prune_guests() -> None:
    """低频清理过期访客目录，避免零维护变成无限增长。"""
    global _LAST_PRUNE
    now = time.time()
    if now - _LAST_PRUNE < 3600:
        return
    with _PRUNE_LOCK:
        if now - _LAST_PRUNE < 3600:
            return
        _LAST_PRUNE = now
        base = Path(get_data_dir()) / "user_data" / "guests"
        if not base.is_dir():
            return
        cutoff = now - GUEST_RETENTION_DAYS * 86400
        for child in base.iterdir():
            try:
                if child.is_dir() and child.stat().st_mtime < cutoff:
                    for entry in child.rglob("*"):
                        if entry.is_file():
                            entry.unlink(missing_ok=True)
                    for entry in sorted(child.rglob("*"), reverse=True):
                        if entry.is_dir():
                            entry.rmdir()
                    child.rmdir()
            except OSError:
                continue


def community_overview(auth_api: Any, wan_api: Any = None) -> Dict[str, Any]:
    stats: Dict[str, Any] = {}
    try:
        stats = auth_api.users.get_stats() if auth_api is not None else {}
    except Exception:
        stats = {}
    wan_connected = False
    room_id = ""
    rooms = 0
    online = 0
    try:
        if wan_api is not None:
            wan = wan_api.wan
            wan_connected = bool(wan.is_connected())
            room_id = str(getattr(wan, "room_id", "") or "")
            if wan_connected:
                overview = wan.get_all_rooms_overview()
                rooms = len(overview)
                online = sum(max(0, int(item.get("peer_count", 0) or 0)) for item in overview)
    except Exception:
        pass
    return {
        "registered": int(stats.get("total_users", 0) or 0),
        "active_users": int(stats.get("active_users", 0) or 0),
        "active_sessions": int(stats.get("active_sessions", 0) or 0),
        "roles": stats.get("by_role", {}) if isinstance(stats.get("by_role"), dict) else {},
        "wan": {
            "connected": wan_connected,
            "room_id": room_id,
            "rooms": rooms,
            "online": online,
        },
        "culture": ROLE_CULTURE,
    }


def _public_user_payload(user: Any) -> Dict[str, Any]:
    return {
        "kind": "user",
        "visitor_id": "",
        "data_scope": scope_for_user(user.user_id),
        "role": str(getattr(user, "role", "member") or "member"),
        "display_name": str(getattr(user, "display_name", "") or ""),
        "permissions": {**GUEST_PERMISSIONS, "chat.files": True, "community.create_room": True},
        "chat": {"limit": None, "used": 0, "remaining": None, "exhausted": False},
    }


def visitor_payload(handler=None, auth_api: Any = None, wan_api: Any = None,
                    user: Any = None, create_guest: bool = True,
                    visitor_id: str = "") -> Tuple[Dict[str, Any], str]:
    """返回访客/用户的作用域说明，以及需要下发的 Set-Cookie。"""
    _prune_guests()
    cookie = ""
    if user is not None:
        actor = _public_user_payload(user)
    else:
        visitor_id = visitor_id or (visitor_id_from_handler(handler) if handler is not None else "")
        is_new = False
        if not visitor_id and create_guest:
            visitor_id = new_guest_id()
            is_new = True
        if visitor_id:
            scope = scope_for_guest(visitor_id)
            quota = quota_status(scope)
            actor = {
                "kind": "guest",
                "visitor_id": visitor_id,
                "data_scope": scope,
                "role": "guest",
                "display_name": "访客",
                "permissions": GUEST_PERMISSIONS,
                "chat": quota,
            }
            if is_new:
                cookie = visitor_cookie_header(visitor_id)
        else:
            actor = {
                "kind": "anonymous",
                "visitor_id": "",
                "data_scope": "",
                "role": "guest",
                "display_name": "访客",
                "permissions": GUEST_PERMISSIONS,
                "chat": {"limit": GUEST_DAILY_MESSAGES, "used": 0,
                         "remaining": GUEST_DAILY_MESSAGES, "exhausted": False},
            }
    return {
        "success": True,
        "actor": actor,
        "community": community_overview(auth_api, wan_api),
        "data_policy": "scope-only; paths stay local",
        "first_visit": bool(cookie),
    }, cookie


def create_router(api: Any) -> APIRouter:
    """FastAPI 侧的最小访客入口；8799 的桌面入口另由 desktop_server 挂载。"""
    router = APIRouter(tags=["visitor"])

    def _user_from_request(request: Request):
        token = request.cookies.get(SESSION_COOKIE, "")
        try:
            return api.users.validate_session(token) if token else None
        except Exception:
            return None

    @router.get("/api/visitor/bootstrap")
    def bootstrap(request: Request):
        payload, cookie = visitor_payload(
            handler=None,
            auth_api=api,
            user=_user_from_request(request),
            create_guest=True,
            visitor_id=request.cookies.get(VISITOR_COOKIE, ""),
        )
        response = JSONResponse(payload)
        if cookie:
            response.headers.append("set-cookie", cookie)
        return response

    @router.get("/api/community/overview")
    def overview():
        return {"success": True, **community_overview(api)}

    return router
