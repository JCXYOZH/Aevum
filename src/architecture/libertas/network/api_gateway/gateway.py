"""API 网关职责：gateway。"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import threading
import time
import uuid
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

from .docs import APIDocumentGenerator
from .limiter import CORSManager
from .docs import FrontendSDKGenerator
from .limiter import RateLimiter
from .sse import SSEManager
from .models import UnifiedResponse
from .websocket import WebSocketManager

class APIGateway:
    """API网关

    前后端通信的统一入口，在保持前后端分离的同时提供：
    - 统一响应格式
    - 请求路由和转发
    - CORS跨域处理
    - 请求限流
    - WebSocket实时通信
    - SSE流式输出
    - API文档自动生成
    - 前端SDK生成
    - 请求日志和审计
    """

    def __init__(self, base_url: str = "/api/v1"):
        self.base_url = base_url
        self.routes: Dict[str, Callable] = {}
        self.middlewares: List[Callable] = []
        self.rate_limiter = RateLimiter()
        self.cors_manager = CORSManager()
        self.ws_manager = WebSocketManager()
        self.sse_manager = SSEManager()
        self.api_doc = APIDocumentGenerator()
        self.sdk_generator = FrontendSDKGenerator(self.api_doc)
        self.request_log: deque = deque(maxlen=10000)
        self._lock = threading.Lock()

    def register_route(self, method: str, path: str, handler: Callable,
                       summary: str = "", description: str = "",
                       tags: List[str] = None, rate_limit: int = None):
        """注册API路由"""
        key = f"{method.upper()}:{path}"
        self.routes[key] = handler

        if rate_limit:
            self.rate_limiter.set_limit(f"route:{key}", rate_limit)

        if summary:
            self.api_doc.register_endpoint(
                method=method, path=path, summary=summary,
                description=description, tags=tags or ["default"],
            )

    def add_middleware(self, middleware: Callable):
        """添加中间件"""
        self.middlewares.append(middleware)

    async def handle_request(self, method: str, path: str,
                              headers: Dict = None, body: Any = None,
                              query: Dict = None, client_ip: str = "") -> UnifiedResponse:
        """处理API请求（统一入口）"""
        start_time = time.time()
        headers = headers or {}
        query = query or {}
        request_id = f"req_{uuid.uuid4().hex[:16]}"

        # CORS预检
        if method.upper() == "OPTIONS":
            status, cors_headers, _ = self.cors_manager.handle_preflight(headers)
            resp = UnifiedResponse(status="success", code=status, request_id=request_id)
            resp.metadata["cors_headers"] = cors_headers
            return resp

        # 限流检查
        rate_key = f"{client_ip}:{method}:{path}"
        allowed, rate_info = self.rate_limiter.allow(rate_key)
        if not allowed:
            return UnifiedResponse.rate_limited(retry_after=rate_info["retry_after"])

        # 查找路由
        key = f"{method.upper()}:{path}"
        handler = self.routes.get(key)

        if not handler:
            # 尝试路径参数匹配
            handler = self._match_dynamic_route(method, path)

        if not handler:
            return UnifiedResponse.not_found(f"端点不存在: {method} {path}")

        try:
            # 执行中间件
            request_context = {
                "method": method,
                "path": path,
                "headers": headers,
                "body": body,
                "query": query,
                "client_ip": client_ip,
                "request_id": request_id,
            }

            for middleware in self.middlewares:
                result = middleware(request_context)
                if isinstance(result, UnifiedResponse) and result.status == "error":
                    return result

            # 执行处理器
            if asyncio.iscoroutinefunction(handler):
                data = await handler(request_context)
            else:
                data = handler(request_context)

            # 统一响应格式
            if isinstance(data, UnifiedResponse):
                resp = data
            elif isinstance(data, dict) and "status" in data:
                resp = UnifiedResponse(**data)
            else:
                resp = UnifiedResponse.success(data=data)

            resp.request_id = request_id
            resp.duration_ms = (time.time() - start_time) * 1000
            resp.metadata["rate_limit"] = rate_info
            resp.metadata["cors_headers"] = self.cors_manager.get_cors_headers(
                headers.get("Origin", "")
            )

            # 记录请求日志
            self._log_request(request_context, resp)

            return resp

        except Exception as e:
            resp = UnifiedResponse.error(
                code=500,
                message=str(e),
                errors=[{"type": "internal_error", "message": str(e)}]
            )
            resp.request_id = request_id
            resp.duration_ms = (time.time() - start_time) * 1000
            self._log_request(request_context, resp)
            return resp

    def _match_dynamic_route(self, method: str, path: str) -> Optional[Callable]:
        """匹配动态路由（含路径参数）"""
        for route_key, handler in self.routes.items():
            route_method, route_path = route_key.split(":", 1)
            if route_method != method.upper():
                continue
            # 转换路由模式为正则
            pattern = re.sub(r'\{[^}]+\}', r'[^/]+', route_path)
            if re.fullmatch(pattern, path):
                return handler
        return None

    def _log_request(self, context: Dict, response: UnifiedResponse):
        """记录请求日志"""
        with self._lock:
            self.request_log.append({
                "request_id": context["request_id"],
                "method": context["method"],
                "path": context["path"],
                "client_ip": context["client_ip"],
                "status": response.status,
                "code": response.code,
                "duration_ms": response.duration_ms,
                "timestamp": time.time(),
            })

    def get_request_log(self, limit: int = 100, method: str = None,
                         status: str = None) -> List[Dict]:
        """获取请求日志"""
        logs = list(self.request_log)
        if method:
            logs = [l for l in logs if l["method"] == method.upper()]
        if status:
            logs = [l for l in logs if l["status"] == status]
        return logs[-limit:]

    def generate_sdk(self, output_path: str, language: str = "typescript"):
        """生成前端SDK"""
        return self.sdk_generator.save_sdk(output_path, language)

    def get_stats(self) -> Dict:
        return {
            "total_routes": len(self.routes),
            "middlewares": len(self.middlewares),
            "rate_limiter": self.rate_limiter.get_stats(),
            "websocket": self.ws_manager.get_stats(),
            "sse": self.sse_manager.get_stats(),
            "api_doc_endpoints": len(self.api_doc.endpoints),
            "request_log_count": len(self.request_log),
        }
