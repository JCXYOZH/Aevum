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

from .constants import _EMPTY_REPLY_PATTERNS, _EVASION_PATTERNS, _INJECTION_PATTERNS, _PROTOCOL_LEAK_PATTERNS, _REFUSAL_EN, _REFUSAL_ZH
from .generation import ModelGenerationMixin
from .models import ModelConfig, ModelRequest, ModelStatus
from .prompts import ModelPromptMixin
from .registry import ModelRegistryMixin
from .routing import ModelRoutingMixin
from .streaming import ModelStreamingMixin


class ModelController(ModelRegistryMixin, ModelGenerationMixin, ModelPromptMixin, ModelStreamingMixin, ModelRoutingMixin):
    """模型控制层。"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "model_control")
        os.makedirs(self.data_dir, exist_ok=True)
        self._models: Dict[str, ModelConfig] = {}
        self._requests: List[ModelRequest] = []
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._session_state: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()
        self._default_model = ""
        self._fallback_chain: List[str] = []
        self._max_retries = 3
        self.MAX_ENFORCEMENT_ROUNDS = 3
        self._retry_delay = 2.0
        self._cache_enabled = True
        self._cache_ttl = 3600
        self._daily_budget = 10.0  # 美元
        self._today_cost = 0.0
        self._cost_date = ""
        self._request_handlers: Dict[str, Callable] = {}
        # 控制层：正则模式预编译（0.1.5版本）
        self._refusal_zh = [re.compile(p, re.IGNORECASE | re.DOTALL) for p in _REFUSAL_ZH]
        self._refusal_en = [re.compile(p, re.IGNORECASE | re.DOTALL) for p in _REFUSAL_EN]
        self._evasion = [re.compile(p, re.IGNORECASE | re.DOTALL) for p in _EVASION_PATTERNS]
        self._injection = [re.compile(p, re.IGNORECASE | re.DOTALL) for p in _INJECTION_PATTERNS]
        self._protocol_leak = [re.compile(p, re.IGNORECASE | re.DOTALL) for p in _PROTOCOL_LEAK_PATTERNS]
        self._empty = [re.compile(p, re.IGNORECASE | re.DOTALL) for p in _EMPTY_REPLY_PATTERNS]
        from collections import defaultdict
        self.stats = defaultdict(int)
        self._reset_stream_state()
        self._init_default_models()
        self._load()

    def get_stats(self) -> Dict[str, Any]:
        total_calls = sum(m.total_calls for m in self._models.values())
        total_tokens = sum(m.total_tokens for m in self._models.values())
        total_cost = sum(m.total_cost for m in self._models.values())
        success_rate = 0
        if self._requests:
            success = sum(1 for r in self._requests if r.status == "success")
            success_rate = success / len(self._requests) * 100
        return {
            "total_models": len(self._models),
            "active_models": sum(1 for m in self._models.values() if m.status == ModelStatus.ACTIVE),
            "default_model": self._default_model,
            "total_calls": total_calls,
            "total_tokens": total_tokens,
            "total_cost": round(total_cost, 4),
            "today_cost": round(self._today_cost, 4),
            "daily_budget": self._daily_budget,
            "success_rate": round(success_rate, 1),
            "cache_size": len(self._cache),
            "fallback_chain": self._fallback_chain,
            "session_count": len(self._session_state),
        }
