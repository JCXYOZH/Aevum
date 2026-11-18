"""系统状态 API：只返回服务自身的健康信息，不混入账号或回路路由。"""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter


def create_router(api: Any) -> APIRouter:
    router = APIRouter(tags=["system"])

    @router.get("/api/health")
    def health():
        return {
            "success": True,
            "service": "aevum-loop-api",
            "loop_db": os.path.basename(api.users.loop_db_path),
            "manual_send": True,
            "one_at_a_time": True,
        }

    return router
