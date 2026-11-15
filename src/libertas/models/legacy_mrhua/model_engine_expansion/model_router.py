"""
models/model_engine_expansion.py - 模型引擎综合扩展模块

高级模型管理功能：模型路由调度器、多模型负载均衡、模型健康监控、
模型性能基准测试、模型缓存层、模型请求队列、模型成本追踪器。
"""
import os
import json
import time
import uuid
import math
import hashlib
import threading
import queue
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter
from enum import Enum
from libertas.foundation.terminal import terminal


# ================================================================
# 模型状态
# ================================================================
from .models import *  # noqa: F401,F403

class ModelRouter:
    """模型路由调度器"""

    def __init__(self):
        self.router_id = f"router_{uuid.uuid4().hex[:8]}"
        self.models: Dict[str, ModelConfig] = {}
        self.routing_rules: List[Dict[str, Any]] = []
        self.routing_history: deque = deque(maxlen=500)
        self.default_strategy = "least_latency"  # least_latency / least_cost / round_robin / best_quality / weighted
        self._lock = threading.RLock()

    def register_model(self, config: ModelConfig) -> str:
        with self._lock:
            self.models[config.model_id] = config
        terminal.info(f"模型已注册: {config.name} ({config.model_type})", "model_router")
        return config.model_id

    def remove_model(self, model_id: str) -> bool:
        with self._lock:
            return self.models.pop(model_id, None) is not None

    def add_routing_rule(self, condition: str, model_id: str,
                         priority: int = 0, description: str = ""):
        rule = {
            "rule_id": f"rule_{uuid.uuid4().hex[:6]}",
            "condition": condition,
            "model_id": model_id,
            "priority": priority,
            "description": description,
            "created_at": time.time(),
            "usage_count": 0,
        }
        self.routing_rules.append(rule)
        self.routing_rules.sort(key=lambda r: r["priority"], reverse=True)

    def route(self, request: ModelRequest,
              strategy: str = "") -> Optional[ModelConfig]:
        """路由请求到最合适的模型"""
        strategy = strategy or self.default_strategy
        candidates = [m for m in self.models.values()
                     if m.status == ModelStatus.ONLINE and m.model_type == request.model_type]
        if not candidates:
            # 尝试其他类型
            candidates = [m for m in self.models.values() if m.status == ModelStatus.ONLINE]
        if not candidates:
            return None

        # 检查路由规则
        for rule in self.routing_rules:
            if self._match_rule(rule, request):
                model = self.models.get(rule["model_id"])
                if model and model.status == ModelStatus.ONLINE:
                    rule["usage_count"] += 1
                    self._record_routing(request, model, "rule")
                    return model

        # 按策略选择
        if strategy == "least_latency":
            selected = min(candidates, key=lambda m: m.latency_ms)
        elif strategy == "least_cost":
            selected = min(candidates, key=lambda m: m.cost_per_1k_input + m.cost_per_1k_output)
        elif strategy == "round_robin":
            idx = int(time.time() * 1000) % len(candidates)
            selected = candidates[idx]
        elif strategy == "best_quality":
            selected = max(candidates, key=lambda m: m.health_score)
        elif strategy == "weighted":
            total_weight = sum(m.health_score for m in candidates)
            if total_weight > 0:
                r = hash(request.request_id) % 1000 / 1000.0 * total_weight
                cumulative = 0
                for m in candidates:
                    cumulative += m.health_score
                    if cumulative >= r:
                        selected = m
                        break
                else:
                    selected = candidates[-1]
            else:
                selected = candidates[0]
        else:
            selected = candidates[0]

        self._record_routing(request, selected, strategy)
        return selected

    def _match_rule(self, rule: Dict, request: ModelRequest) -> bool:
        condition = rule["condition"]
        try:
            # 简单条件匹配
            if condition.startswith("model_type=="):
                return request.model_type == condition.split("==")[1].strip('"')
            if condition.startswith("prompt_length>"):
                return len(request.prompt) > int(condition.split(">")[1])
            if condition.startswith("has_function"):
                return len(request.functions) > 0
            if condition == "default":
                return True
        except Exception:
            pass
        return False

    def _record_routing(self, request: ModelRequest, model: ModelConfig,
                        strategy: str):
        self.routing_history.append({
            "request_id": request.request_id,
            "model_id": model.model_id,
            "model_name": model.name,
            "strategy": strategy,
            "timestamp": time.time(),
        })

    def get_model(self, model_id: str) -> Optional[ModelConfig]:
        return self.models.get(model_id)

    def list_models(self, model_type: str = "", status: str = "") -> List[ModelConfig]:
        models = list(self.models.values())
        if model_type:
            models = [m for m in models if m.model_type == model_type]
        if status:
            models = [m for m in models if m.status.value == status]
        return models

    def get_stats(self) -> Dict[str, Any]:
        return {
            "router_id": self.router_id,
            "total_models": len(self.models),
            "online_models": sum(1 for m in self.models.values() if m.status == ModelStatus.ONLINE),
            "routing_rules": len(self.routing_rules),
            "routing_history": len(self.routing_history),
            "default_strategy": self.default_strategy,
            "by_type": {t: sum(1 for m in self.models.values() if m.model_type == t)
                        for t in set(m.model_type for m in self.models.values())},
        }

class ModelLoadBalancer:
    """多模型负载均衡器"""

    def __init__(self):
        self.balancer_id = f"lb_{uuid.uuid4().hex[:8]}"
        self.pools: Dict[str, List[ModelConfig]] = {}
        self.weights: Dict[str, Dict[str, float]] = {}
        self.current_index: Dict[str, int] = {}
        self._lock = threading.RLock()

    def add_to_pool(self, pool_name: str, model: ModelConfig, weight: float = 1.0):
        with self._lock:
            if pool_name not in self.pools:
                self.pools[pool_name] = []
                self.weights[pool_name] = {}
                self.current_index[pool_name] = 0
            self.pools[pool_name].append(model)
            self.weights[pool_name][model.model_id] = weight

    def remove_from_pool(self, pool_name: str, model_id: str) -> bool:
        with self._lock:
            if pool_name in self.pools:
                self.pools[pool_name] = [m for m in self.pools[pool_name] if m.model_id != model_id]
                self.weights[pool_name].pop(model_id, None)
                return True
        return False

    def select(self, pool_name: str, strategy: str = "round_robin") -> Optional[ModelConfig]:
        with self._lock:
            pool = self.pools.get(pool_name, [])
            online = [m for m in pool if m.status == ModelStatus.ONLINE]
            if not online:
                return None
            if strategy == "round_robin":
                idx = self.current_index.get(pool_name, 0) % len(online)
                self.current_index[pool_name] = idx + 1
                return online[idx]
            elif strategy == "least_connections":
                return min(online, key=lambda m: m.active_connections)
            elif strategy == "weighted":
                total = sum(self.weights[pool_name].get(m.model_id, 1.0) for m in online)
                r = hash(str(time.time())) % 1000 / 1000.0 * total
                cumulative = 0
                for m in online:
                    cumulative += self.weights[pool_name].get(m.model_id, 1.0)
                    if cumulative >= r:
                        return m
                return online[-1]
            elif strategy == "least_latency":
                return min(online, key=lambda m: m.latency_ms)
            return online[0]

    def get_pool_stats(self, pool_name: str) -> Dict[str, Any]:
        pool = self.pools.get(pool_name, [])
        return {
            "pool_name": pool_name,
            "total_models": len(pool),
            "online_models": sum(1 for m in pool if m.status == ModelStatus.ONLINE),
            "total_connections": sum(m.active_connections for m in pool),
            "avg_latency": sum(m.latency_ms for m in pool) / max(len(pool), 1),
            "weights": self.weights.get(pool_name, {}),
        }

    def get_stats(self) -> Dict[str, Any]:
        return {
            "balancer_id": self.balancer_id,
            "total_pools": len(self.pools),
            "pools": {name: len(models) for name, models in self.pools.items()},
        }
