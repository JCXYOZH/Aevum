"""
模型控制层

统一管理AI模型的调用、路由、限流、降级、缓存、成本控制、模型切换。
"""
import os
import re
import json
import time
import uuid
import hashlib
import threading
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


class ModelStatus(Enum):
    ACTIVE = "active"
    DEGRADED = "degraded"
    OFFLINE = "offline"
    MAINTENANCE = "maintenance"
    OVERLOADED = "overloaded"

class ModelConfig:
    """模型配置"""

    def __init__(self, name: str = "", model_type: str = "chat",
                 provider: str = "", endpoint: str = "",
                 api_key: str = "", max_tokens: int = 4096,
                 temperature: float = 0.7, top_p: float = 1.0,
                 cost_per_1k_input: float = 0.0,
                 cost_per_1k_output: float = 0.0,
                 rpm_limit: int = 60, tpm_limit: int = 100000,
                 priority: int = 0, enabled: bool = True,
                 capabilities: Optional[List[str]] = None):
        self.model_id = f"model_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.model_type = model_type  # chat / completion / embedding / vision / audio
        self.provider = provider
        self.endpoint = endpoint
        self.api_key = api_key
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.top_p = top_p
        self.cost_per_1k_input = cost_per_1k_input
        self.cost_per_1k_output = cost_per_1k_output
        self.rpm_limit = rpm_limit
        self.tpm_limit = tpm_limit
        self.priority = priority
        self.enabled = enabled
        self.capabilities = capabilities or []
        self.status = ModelStatus.ACTIVE
        self.total_calls = 0
        self.total_tokens = 0
        self.total_cost = 0.0
        self.failure_count = 0
        self.last_called = 0.0
        self.last_error = ""
        self.avg_latency_ms = 0.0
        self.created_at = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "model_id": self.model_id,
            "name": self.name,
            "model_type": self.model_type,
            "provider": self.provider,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
            "cost_per_1k_input": self.cost_per_1k_input,
            "cost_per_1k_output": self.cost_per_1k_output,
            "rpm_limit": self.rpm_limit,
            "priority": self.priority,
            "enabled": self.enabled,
            "status": self.status.value,
            "total_calls": self.total_calls,
            "total_tokens": self.total_tokens,
            "total_cost": round(self.total_cost, 4),
            "failure_count": self.failure_count,
            "avg_latency_ms": round(self.avg_latency_ms, 1),
            "capabilities": self.capabilities,
        }

class ModelRequest:
    """模型请求记录"""

    def __init__(self, model: str = "", prompt: str = "",
                 request_type: str = "chat"):
        self.request_id = f"req_{uuid.uuid4().hex[:8]}"
        self.model = model
        self.prompt = prompt
        self.request_type = request_type
        self.timestamp = time.time()
        self.response = ""
        self.status = "pending"
        self.latency_ms = 0.0
        self.input_tokens = 0
        self.output_tokens = 0
        self.cost = 0.0
        self.error = ""
        self.retry_count = 0
        self.cache_hit = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "request_id": self.request_id,
            "model": self.model,
            "request_type": self.request_type,
            "timestamp": self.timestamp,
            "status": self.status,
            "latency_ms": round(self.latency_ms, 1),
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cost": round(self.cost, 4),
            "error": self.error,
            "retry_count": self.retry_count,
            "cache_hit": self.cache_hit,
        }
