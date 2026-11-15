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
from .models import ModelConfig, ModelRequest, ModelStatus


class ModelGenerationMixin:
    """模型生成、预算、缓存与请求历史。"""

    def _check_budget(self) -> bool:
        today = datetime.now().strftime("%Y-%m-%d")
        if self._cost_date != today:
            self._today_cost = 0.0
            self._cost_date = today
        return self._today_cost < self._daily_budget

    def _estimate_tokens(self, text: str) -> int:
        """估算 token 数"""
        import re
        chinese = len(re.findall(r'[\u4e00-\u9fff]', text))
        english = len(re.findall(r'[a-zA-Z]+', text))
        return int(chinese * 1.5 + english * 1.3) + 10

    def _get_cache_key(self, model: str, prompt: str, **kwargs) -> str:
        key_content = f"{model}:{prompt}:{json.dumps(kwargs, sort_keys=True, default=str)}"
        return hashlib.md5(key_content.encode()).hexdigest()

    def generate(self, prompt: str, model: str = "",
                 request_type: str = "chat", **kwargs) -> Dict[str, Any]:
        """生成请求（统一入口）"""
        if not self._check_budget():
            return {"success": False, "error": "超出每日预算", "error_code": "BUDGET_EXCEEDED"}
    
        model_name = model or self._default_model
        request = ModelRequest(model_name, prompt, request_type)
        start = time.time()
    
        # 缓存检查
        cache_key = self._get_cache_key(model_name, prompt, **kwargs)
        if self._cache_enabled and cache_key in self._cache:
            cached = self._cache[cache_key]
            if time.time() - cached["timestamp"] < self._cache_ttl:
                request.cache_hit = True
                request.status = "success"
                request.response = cached["response"]
                request.latency_ms = (time.time() - start) * 1000
                with self._lock:
                    self._requests.append(request)
                return {"success": True, "response": cached["response"],
                        "cache_hit": True, "model": model_name,
                        "request_id": request.request_id}
    
        # 尝试主模型和降级链
        models_to_try = [model_name] + [m for m in self._fallback_chain if m != model_name]
        last_error = ""
    
        for attempt_model in models_to_try:
            model_config = self._models.get(attempt_model)
            if not model_config or not model_config.enabled:
                continue
            if model_config.status == ModelStatus.OFFLINE:
                continue
    
            try:
                # 调用处理器
                handler = self._request_handlers.get(request_type)
                if handler:
                    response = handler(model_config, prompt, **kwargs)
                else:
                    # 默认处理（模拟）
                    response = f"[模型 {attempt_model} 响应] {prompt[:100]}..."
    
                # 计算成本
                input_tokens = self._estimate_tokens(prompt)
                output_tokens = self._estimate_tokens(response)
                cost = (input_tokens / 1000 * model_config.cost_per_1k_input +
                       output_tokens / 1000 * model_config.cost_per_1k_output)
    
                # 更新模型统计
                model_config.total_calls += 1
                model_config.total_tokens += input_tokens + output_tokens
                model_config.total_cost += cost
                model_config.last_called = time.time()
                model_config.avg_latency_ms = (model_config.avg_latency_ms * 0.9 +
                                               (time.time() - start) * 100 + 10)
    
                # 更新请求
                request.model = attempt_model
                request.response = response
                request.status = "success"
                request.latency_ms = (time.time() - start) * 1000
                request.input_tokens = input_tokens
                request.output_tokens = output_tokens
                request.cost = cost
    
                # 缓存
                if self._cache_enabled:
                    self._cache[cache_key] = {"response": response, "timestamp": time.time()}
    
                # 预算更新
                self._today_cost += cost
    
                with self._lock:
                    self._requests.append(request)
                    if len(self._requests) > 1000:
                        self._requests = self._requests[-500:]
    
                return {
                    "success": True,
                    "response": response,
                    "model": attempt_model,
                    "request_id": request.request_id,
                    "latency_ms": round(request.latency_ms, 1),
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cost": round(cost, 4),
                    "cache_hit": False,
                }
    
            except Exception as e:
                last_error = str(e)
                model_config.failure_count += 1
                model_config.last_error = str(e)
                if model_config.failure_count > 10:
                    model_config.status = ModelStatus.DEGRADED
                request.retry_count += 1
                continue
    
        # 所有模型失败
        request.status = "failed"
        request.error = last_error
        request.latency_ms = (time.time() - start) * 1000
        with self._lock:
            self._requests.append(request)
    
        return {"success": False, "error": last_error or "所有模型不可用",
                "error_code": "ALL_MODELS_FAILED", "request_id": request.request_id}

    def get_request_history(self, model: str = "", status: str = "",
                            limit: int = 50) -> List[ModelRequest]:
        requests = list(reversed(self._requests))
        if model:
            requests = [r for r in requests if r.model == model]
        if status:
            requests = [r for r in requests if r.status == status]
        return requests[:limit]

    def clear_cache(self):
        self._cache.clear()

    def _reset_stream_state(self):
        """重置流式检测状态"""
        self._stream_buf = ""
        self._stream_refusal_detected = False
        self._stream_refusal_pos = -1
        self._stream_protocol_leak = False
        self._stream_injection = False
        self._stream_thinking_closed = False
        self._stream_piece_count = 0
        self._stream_start_time = time.time()
