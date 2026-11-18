"""API 网关职责：models。"""

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


class ResponseStatus(Enum):
    SUCCESS = "success"
    ERROR = "error"
    PARTIAL = "partial"
    PENDING = "pending"
    CANCELLED = "cancelled"

@dataclass
class UnifiedResponse:
    """统一响应格式

    所有API返回统一格式，前端只需处理一种结构。
    """
    status: str = "success"
    code: int = 200
    message: str = ""
    data: Any = None
    errors: List[Dict] = field(default_factory=list)
    warnings: List[Dict] = field(default_factory=list)
    pagination: Dict = field(default_factory=dict)
    metadata: Dict = field(default_factory=dict)
    request_id: str = ""
    timestamp: float = 0.0
    duration_ms: float = 0.0

    def __post_init__(self):
        if not self.request_id:
            self.request_id = f"req_{uuid.uuid4().hex[:16]}"
        if not self.timestamp:
            self.timestamp = time.time()

    def to_dict(self) -> Dict:
        return {
            "status": self.status,
            "code": self.code,
            "message": self.message,
            "data": self.data,
            "errors": self.errors,
            "warnings": self.warnings,
            "pagination": self.pagination,
            "metadata": self.metadata,
            "request_id": self.request_id,
            "timestamp": self.timestamp,
            "duration_ms": round(self.duration_ms, 2),
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, default=str)

    @classmethod
    def success(cls, data: Any = None, message: str = "OK",
                metadata: Dict = None) -> 'UnifiedResponse':
        return cls(status="success", code=200, message=message,
                    data=data, metadata=metadata or {})

    @classmethod
    def error(cls, code: int = 500, message: str = "Internal Server Error",
              errors: List[Dict] = None) -> 'UnifiedResponse':
        return cls(status="error", code=code, message=message,
                    errors=errors or [])

    @classmethod
    def not_found(cls, message: str = "Resource not found") -> 'UnifiedResponse':
        return cls(status="error", code=404, message=message)

    @classmethod
    def unauthorized(cls, message: str = "Unauthorized") -> 'UnifiedResponse':
        return cls(status="error", code=401, message=message)

    @classmethod
    def forbidden(cls, message: str = "Forbidden") -> 'UnifiedResponse':
        return cls(status="error", code=403, message=message)

    @classmethod
    def bad_request(cls, message: str = "Bad Request",
                     errors: List[Dict] = None) -> 'UnifiedResponse':
        return cls(status="error", code=400, message=message,
                    errors=errors or [])

    @classmethod
    def rate_limited(cls, message: str = "Rate limit exceeded",
                      retry_after: int = 60) -> 'UnifiedResponse':
        resp = cls(status="error", code=429, message=message)
        resp.metadata["retry_after"] = retry_after
        return resp

    @classmethod
    def paginated(cls, data: List, page: int, page_size: int,
                   total: int) -> 'UnifiedResponse':
        return cls(
            status="success", code=200, message="OK",
            data=data,
            pagination={
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": (total + page_size - 1) // page_size,
                "has_next": page * page_size < total,
                "has_prev": page > 1,
            }
        )
