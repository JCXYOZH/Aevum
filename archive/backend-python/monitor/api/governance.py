"""社区治理只读适配层。

治理窗口先只开放“看”的能力：角色、在线/注册统计、提案和分叉列表。
投票、提案、分叉这些写操作仍要经过未来的角色权限校验，这里统一返回
403，避免把尚未收口的 `Governance` 写入口直接暴露到浏览器。
"""

from __future__ import annotations

import threading
from typing import Any, Dict, Optional

from fastapi import APIRouter, Request

from libertas.tools.legacy_tools.governance.constants import (
    FORK_COOLDOWN_DAYS,
    FORK_MIN_COMMUNITY,
    FORK_MIN_CONTRIBUTION,
    PROPOSAL_TYPES,
    ROLE_PERMISSIONS,
)
from libertas.tools.legacy_tools.governance.governance import Governance

try:
    from .visitor import community_overview, visitor_payload
except ImportError:  # 以脚本方式启动 desktop_server 时
    from api.visitor import community_overview, visitor_payload

_GOVERNANCE: Optional[Governance] = None
_GOVERNANCE_LOCK = threading.Lock()


def _governance() -> Governance:
    global _GOVERNANCE
    if _GOVERNANCE is None:
        with _GOVERNANCE_LOCK:
            if _GOVERNANCE is None:
                _GOVERNANCE = Governance()
    return _GOVERNANCE


def _actor(handler, auth_api: Any, wan_api: Any):
    user = None
    try:
        if auth_api is not None and handler is not None:
            user = auth_api.current_user(handler)
    except Exception:
        user = None
    try:
        payload, _cookie = visitor_payload(
            handler, auth_api, wan_api, user=user, create_guest=False,
        )
    except Exception:
        payload = {
            "actor": {
                "kind": "guest", "role": "guest", "display_name": "访客",
                "permissions": {},
            },
            "community": community_overview(auth_api, wan_api),
        }
    return user, payload


def _role_payload(actor: Dict[str, Any]) -> Dict[str, Any]:
    role_id = str(actor.get("role", "guest") or "guest")
    info = ROLE_PERMISSIONS.get(role_id, ROLE_PERMISSIONS["guest"])
    desc = info.get("desc", "")
    if role_id == "guest":
        # 旧常量里写的是“不可发言”，与访客当前可进公共社区、可发文本的口径冲突。
        desc = "未注册访客：可查看公开概览、进入公共广域网、和 AI 对话、发送文本；不能上传文件、投票或管理社区。"
    source = actor.get("permissions", {}) if isinstance(actor.get("permissions"), dict) else {}
    return {
        "role": role_id,
        "label": info.get("label", role_id),
        "desc": desc,
        # 治理窗口沿用旧的 can_* 字段；这里只映射已经确认的公开能力，
        # 未接权限的写操作一律为 False。
        "permissions": {
            "can_send": bool(source.get("chat.send")),
            "can_send_files": bool(source.get("chat.files")),
            "can_invite": False,
            "can_kick": False,
            "can_ban": False,
            "can_change_roles": bool(source.get("community.manage")),
            "can_view_history": True,
            "can_delete": False,
            "can_change_room": False,
            "can_vote": bool(source.get("community.vote")),
            "can_fork": False,
            "can_review_content": False,
            "can_arbitrate": False,
            "can_pin": False,
            "can_publish": False,
        },
        "expired": False,
        "expires_at": "",
        "days_remaining": None,
        "needs_review": False,
    }


def _peers(wan_api: Any) -> list[dict]:
    if wan_api is None:
        return []
    try:
        wan = wan_api.wan
        if not wan.is_connected():
            return []
        peers = wan.get_room_peers(getattr(wan, "room_id", "") or "")
        return [
            {
                "peer_id": str(item.get("peer_id", "")),
                "nickname": str(item.get("display_name") or item.get("nickname") or "未知"),
                "role": str(item.get("role", "guest") or "guest"),
            }
            for item in peers
        ]
    except Exception:
        return []


def status_payload(handler, auth_api: Any, wan_api: Any) -> Dict[str, Any]:
    _user, actor_payload = _actor(handler, auth_api, wan_api)
    actor = actor_payload.get("actor", {})
    community = actor_payload.get("community", {}) or community_overview(auth_api, wan_api)
    wan = community.get("wan", {}) if isinstance(community.get("wan"), dict) else {}
    return {
        "success": True,
        "role": _role_payload(actor),
        "global_stats": {
            "online": int(wan.get("online", 0) or 0),
            "total_registered": int(community.get("registered", 0) or 0),
            "rooms": int(wan.get("rooms", 0) or 0),
            "peers": _peers(wan_api),
        },
        "read_only": True,
    }


def requirements_payload(handler, auth_api: Any, wan_api: Any) -> Dict[str, Any]:
    user, actor_payload = _actor(handler, auth_api, wan_api)
    community = actor_payload.get("community", {}) or community_overview(auth_api, wan_api)
    info: Dict[str, Any] = {}
    try:
        if auth_api is not None and user is not None:
            info = auth_api.account_info(user) or {}
    except Exception:
        info = {}
    return {
        "success": True,
        "user": {
            "activated": bool(info.get("activated", False)),
            "contribution_score": 0,
        },
        "community": {
            "total_peers": int(community.get("registered", 0) or 0)
            or int((community.get("wan", {}) or {}).get("online", 0) or 0),
        },
        "proposal_types": PROPOSAL_TYPES,
        "thresholds": {
            "fork_min_contribution": FORK_MIN_CONTRIBUTION,
            "fork_min_community": FORK_MIN_COMMUNITY,
            "fork_cooldown_days": FORK_COOLDOWN_DAYS,
        },
        "read_only": True,
    }


def _safe_response(payload: Dict[str, Any], status: int = 200):
    return payload, status


def handle_get(handler, route: str, auth_api: Any, wan_api: Any) -> bool:
    if route == "/api/governance/status":
        payload, status = _safe_response(status_payload(handler, auth_api, wan_api))
    elif route == "/api/governance/proposals":
        status_filter = "active"
        try:
            from urllib.parse import parse_qs, urlparse
            status_filter = (parse_qs(urlparse(handler.path).query).get("status") or ["active"])[0]
        except Exception:
            pass
        proposals = _governance().list_proposals(status_filter)
        payload, status = _safe_response({"success": True, "proposals": proposals})
    elif route == "/api/governance/forks":
        forks = _governance().list_forks()
        for item in forks:
            item["voter_count"] = int(item.get("voters", 0) or 0)
        payload, status = _safe_response({"success": True, "forks": forks})
    elif route == "/api/governance/requirements":
        payload, status = _safe_response(requirements_payload(handler, auth_api, wan_api))
    elif route == "/api/community/stats":
        community = community_overview(auth_api, wan_api)
        wan = community.get("wan", {})
        payload, status = _safe_response({
            "success": True,
            "wan_connected": bool(wan.get("connected")),
            "current_room": wan.get("room_id", ""),
            "online": int(wan.get("online", 0) or 0),
            "registered": int(community.get("registered", 0) or 0),
            "rooms": int(wan.get("rooms", 0) or 0),
        })
    else:
        return False
    handler._send_json(payload, status)
    return True


def handle_post(handler, route: str, auth_api: Any, wan_api: Any) -> bool:
    if not route.startswith("/api/governance/"):
        return False
    if route in {
        "/api/governance/proposals",
        "/api/governance/vote",
        "/api/governance/fork",
    }:
        handler._send_json({
            "success": False,
            "error": "治理写操作尚未开放：先接角色权限和投票校验，再开放提案与分叉。",
        }, 403)
        return True
    return False


def create_router(api: Any) -> APIRouter:
    router = APIRouter(tags=["governance"])

    def _user_from_request(request):
        token = request.cookies.get("mrhua_session", "")
        try:
            return api.users.validate_session(token) if token else None
        except Exception:
            return None

    @router.get("/api/governance/status")
    def status(request: Request):
        # FastAPI 侧没有 WAN 适配层时，统计会退化为注册/会话数据。
        return status_payload(None, api, getattr(api, "wan_api", None))

    @router.get("/api/governance/proposals")
    def proposals(request: Request, status: str = "active"):
        return {"success": True, "proposals": _governance().list_proposals(status)}

    @router.get("/api/governance/forks")
    def forks(request: Request):
        items = _governance().list_forks()
        for item in items:
            item["voter_count"] = int(item.get("voters", 0) or 0)
        return {"success": True, "forks": items}

    @router.get("/api/governance/requirements")
    def requirements(request: Request):
        return requirements_payload(None, api, getattr(api, "wan_api", None))

    @router.get("/api/community/stats")
    def community_stats(request: Request):
        community = community_overview(api, getattr(api, "wan_api", None))
        wan = community.get("wan", {})
        return {
            "success": True,
            "wan_connected": bool(wan.get("connected")),
            "current_room": wan.get("room_id", ""),
            "online": int(wan.get("online", 0) or 0),
            "registered": int(community.get("registered", 0) or 0),
            "rooms": int(wan.get("rooms", 0) or 0),
        }

    return router
