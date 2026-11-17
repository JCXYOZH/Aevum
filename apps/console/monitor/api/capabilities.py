"""MrHua 后端能力清单。

前端只渲染这里标记为 ready 的启动项；其余窗口保留源码，等真实 API
接入后再逐个放回，不在前端继续堆空壳样式。

这个模块只负责声明能力，不搬业务逻辑：
- 账号/身份 -> auth_api
- 对话 -> chat_api
- 广域网 -> wan_api
- 订阅/回路 -> loop_api
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter

READY_TOOLS: List[Dict[str, str]] = [
    {
        "id": "identity",
        "name": "身份认证",
        "cat": "系统",
        "backend": "auth_api",
        "route": "/api/auth/*",
    },
    {
        "id": "chat",
        "name": "对话",
        "cat": "核心",
        "backend": "chat_api",
        "route": "/api/chat/*",
    },
    {
        "id": "wanshare",
        "name": "广域网",
        "cat": "协作",
        "backend": "wan_api",
        "route": "/api/wan/*",
    },
    {
        "id": "subscribe",
        "name": "订阅",
        "cat": "系统",
        "backend": "loop_api",
        "route": "/api/loop/*",
    },
]


def capabilities_payload() -> Dict[str, Any]:
    return {
        "success": True,
        "tools": READY_TOOLS,
        "count": len(READY_TOOLS),
        "note": "未列出的启动项没有后端功能，暂不渲染。",
    }


def create_router() -> APIRouter:
    router = APIRouter(tags=["capabilities"])

    @router.get("/api/capabilities")
    def capabilities():
        return capabilities_payload()

    return router
