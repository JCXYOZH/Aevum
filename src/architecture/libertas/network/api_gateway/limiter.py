"""API 网关职责：limiter。"""

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


class RateLimiter:
    """请求限流器

    基于令牌桶算法的限流，支持按IP/用户/端点限流。
    """

    def __init__(self, default_rate: int = 100, default_window: int = 60):
        self.default_rate = default_rate
        self.default_window = default_window
        self.buckets: Dict[str, deque] = defaultdict(deque)
        self.custom_limits: Dict[str, Tuple[int, int]] = {}
        self._lock = threading.Lock()

    def set_limit(self, key: str, rate: int, window: int = 60):
        """设置自定义限流"""
        self.custom_limits[key] = (rate, window)

    def allow(self, key: str) -> Tuple[bool, Dict]:
        """检查是否允许请求

        Returns:
            (allowed, info) - info包含剩余配额和重置时间
        """
        now = time.time()
        rate, window = self.custom_limits.get(key, (self.default_rate, self.default_window))

        with self._lock:
            bucket = self.buckets[key]
            # 移除过期的请求记录
            while bucket and now - bucket[0] > window:
                bucket.popleft()

            if len(bucket) >= rate:
                oldest = bucket[0] if bucket else now
                retry_after = int(window - (now - oldest)) + 1
                return False, {
                    "limit": rate,
                    "remaining": 0,
                    "window": window,
                    "retry_after": max(1, retry_after),
                }

            bucket.append(now)
            return True, {
                "limit": rate,
                "remaining": rate - len(bucket),
                "window": window,
                "retry_after": 0,
            }

    def get_stats(self) -> Dict:
        return {
            "total_keys": len(self.buckets),
            "custom_limits": len(self.custom_limits),
            "default_rate": self.default_rate,
            "default_window": self.default_window,
        }

class CORSManager:
    """跨域资源共享管理器

    在保持前后端分离的同时，安全地处理跨域请求。
    """

    def __init__(self):
        self.allowed_origins: List[str] = ["*"]
        self.allowed_methods: List[str] = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
        self.allowed_headers: List[str] = [
            "Content-Type", "Authorization", "X-Requested-With",
            "X-Request-ID", "X-Auth-Token", "Accept", "Origin",
        ]
        self.exposed_headers: List[str] = ["X-Request-ID", "X-RateLimit-Remaining"]
        self.allow_credentials: bool = True
        self.max_age: int = 86400

    def configure(self, allowed_origins: List[str] = None,
                  allow_credentials: bool = None):
        """配置CORS"""
        if allowed_origins is not None:
            self.allowed_origins = allowed_origins
        if allow_credentials is not None:
            self.allow_credentials = allow_credentials

    def is_origin_allowed(self, origin: str) -> bool:
        """检查来源是否允许"""
        if "*" in self.allowed_origins:
            return True
        return origin in self.allowed_origins

    def get_cors_headers(self, origin: str = None) -> Dict[str, str]:
        """获取CORS响应头"""
        headers = {}
        if origin and self.is_origin_allowed(origin):
            headers["Access-Control-Allow-Origin"] = origin
        elif "*" in self.allowed_origins:
            headers["Access-Control-Allow-Origin"] = "*"

        headers["Access-Control-Allow-Methods"] = ", ".join(self.allowed_methods)
        headers["Access-Control-Allow-Headers"] = ", ".join(self.allowed_headers)
        headers["Access-Control-Expose-Headers"] = ", ".join(self.exposed_headers)
        headers["Access-Control-Max-Age"] = str(self.max_age)

        if self.allow_credentials:
            headers["Access-Control-Allow-Credentials"] = "true"

        return headers

    def handle_preflight(self, request_headers: Dict) -> Tuple[int, Dict, str]:
        """处理OPTIONS预检请求"""
        origin = request_headers.get("Origin", "")
        headers = self.get_cors_headers(origin)
        return 204, headers, ""
