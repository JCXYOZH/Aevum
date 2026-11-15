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
from .model_router import *  # noqa: F401,F403

class ModelHealthMonitor:
    """模型健康监控器"""

    def __init__(self, check_interval: float = 30.0):
        self.monitor_id = f"health_{uuid.uuid4().hex[:8]}"
        self.check_interval = check_interval
        self.models: Dict[str, ModelConfig] = {}
        self.health_history: Dict[str, deque] = {}
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.RLock()
        self.alert_callbacks: List[Callable] = []

    def register_model(self, model: ModelConfig):
        with self._lock:
            self.models[model.model_id] = model
            if model.model_id not in self.health_history:
                self.health_history[model.model_id] = deque(maxlen=200)

    def unregister_model(self, model_id: str):
        with self._lock:
            self.models.pop(model_id, None)
            self.health_history.pop(model_id, None)

    def check_health(self, model_id: str) -> Dict[str, Any]:
        """检查单个模型健康状态"""
        model = self.models.get(model_id)
        if not model:
            return {"error": "model not found"}
        # 简化健康检查：基于历史指标
        health_score = 1.0
        factors = {}
        # 延迟因素
        if model.latency_ms > 5000:
            health_score -= 0.3
            factors["high_latency"] = model.latency_ms
        elif model.latency_ms > 2000:
            health_score -= 0.1
        # 错误率因素
        if model.error_rate > 0.2:
            health_score -= 0.4
            factors["high_error_rate"] = model.error_rate
        elif model.error_rate > 0.1:
            health_score -= 0.2
        # 吞吐量因素
        if model.throughput_rpm < 1:
            health_score -= 0.1
        # 连接数因素
        if model.max_concurrent and model.active_connections >= model.max_concurrent:
            health_score -= 0.2
            factors["overloaded"] = model.active_connections

        health_score = max(0.0, min(1.0, health_score))
        model.health_score = health_score

        # 更新状态
        if health_score < 0.3:
            model.status = ModelStatus.DEGRADED
        elif health_score < 0.1:
            model.status = ModelStatus.OVERLOADED
        elif model.status in (ModelStatus.DEGRADED, ModelStatus.OVERLOADED) and health_score > 0.5:
            model.status = ModelStatus.ONLINE

        model.last_health_check = time.time()
        record = {
            "timestamp": time.time(),
            "health_score": health_score,
            "latency_ms": model.latency_ms,
            "error_rate": model.error_rate,
            "active_connections": model.active_connections,
            "status": model.status.value,
            "factors": factors,
        }
        self.health_history[model_id].append(record)

        # 告警
        if health_score < 0.3:
            for callback in self.alert_callbacks:
                try:
                    callback(model_id, record)
                except Exception:
                    pass

        return record

    def check_all(self) -> Dict[str, Dict]:
        results = {}
        for model_id in list(self.models.keys()):
            results[model_id] = self.check_health(model_id)
        return results

    def start(self):
        if self._running:
            return
        self._running = True

        def _loop():
            while self._running:
                try:
                    self.check_all()
                except Exception as e:
                    terminal.warn(f"健康检查失败: {e}", "model_health")
                time.sleep(self.check_interval)

        self._thread = threading.Thread(target=_loop, daemon=True)
        self._thread.start()
        terminal.info(f"模型健康监控已启动 (间隔{self.check_interval}s)", "model_health")

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)

    def get_health_history(self, model_id: str, limit: int = 50) -> List[Dict]:
        history = self.health_history.get(model_id, deque())
        return list(reversed(list(history)[-limit:]))

    def get_stats(self) -> Dict[str, Any]:
        return {
            "monitor_id": self.monitor_id,
            "monitored_models": len(self.models),
            "running": self._running,
            "check_interval": self.check_interval,
            "avg_health": (sum(m.health_score for m in self.models.values()) /
                           max(len(self.models), 1)),
            "degraded_models": sum(1 for m in self.models.values()
                                  if m.status in (ModelStatus.DEGRADED, ModelStatus.OVERLOADED)),
        }

class ModelCache:
    """模型响应缓存层"""

    def __init__(self, max_size: int = 1000, ttl: float = 3600.0):
        self.cache_id = f"cache_{uuid.uuid4().hex[:8]}"
        self.max_size = max_size
        self.ttl = ttl
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._access_order: deque = deque()
        self._lock = threading.RLock()
        self.hits = 0
        self.misses = 0
        self.evictions = 0

    def _make_key(self, prompt: str, model: str = "",
                  temperature: float = 0.7, max_tokens: int = 0) -> str:
        key_str = f"{prompt}|{model}|{temperature}|{max_tokens}"
        return hashlib.md5(key_str.encode()).hexdigest()

    def get(self, prompt: str, model: str = "",
            temperature: float = 0.7, max_tokens: int = 0) -> Optional[Dict]:
        key = self._make_key(prompt, model, temperature, max_tokens)
        with self._lock:
            entry = self._cache.get(key)
            if entry:
                if time.time() - entry["timestamp"] < self.ttl:
                    self.hits += 1
                    self._access_order.append(key)
                    return entry["data"]
                else:
                    del self._cache[key]
                    self.evictions += 1
            self.misses += 1
            return None

    def set(self, prompt: str, data: Dict, model: str = "",
            temperature: float = 0.7, max_tokens: int = 0):
        key = self._make_key(prompt, model, temperature, max_tokens)
        with self._lock:
            if len(self._cache) >= self.max_size:
                # LRU淘汰
                oldest = self._access_order.popleft() if self._access_order else None
                if oldest and oldest in self._cache:
                    del self._cache[oldest]
                    self.evictions += 1
            self._cache[key] = {
                "data": data,
                "timestamp": time.time(),
                "prompt_hash": hashlib.md5(prompt.encode()).hexdigest()[:16],
            }
            self._access_order.append(key)

    def invalidate(self, prompt: str = "", model: str = ""):
        with self._lock:
            if prompt:
                key_prefix = hashlib.md5(prompt.encode()).hexdigest()[:8]
                keys_to_delete = [k for k in self._cache if k.startswith(key_prefix)]
                for k in keys_to_delete:
                    del self._cache[k]
            elif model:
                keys_to_delete = [k for k, v in self._cache.items()
                                 if v.get("data", {}).get("model_id") == model]
                for k in keys_to_delete:
                    del self._cache[k]
            else:
                self._cache.clear()

    def clear(self):
        with self._lock:
            self._cache.clear()
            self._access_order.clear()

    def get_hit_rate(self) -> float:
        total = self.hits + self.misses
        return self.hits / total if total > 0 else 0.0

    def get_stats(self) -> Dict[str, Any]:
        return {
            "cache_id": self.cache_id,
            "size": len(self._cache),
            "max_size": self.max_size,
            "ttl": self.ttl,
            "hits": self.hits,
            "misses": self.misses,
            "evictions": self.evictions,
            "hit_rate": round(self.get_hit_rate(), 4),
            "memory_estimate_mb": round(len(self._cache) * 0.01, 2),
        }

class ModelRequestQueue:
    """模型请求队列"""

    def __init__(self, max_size: int = 1000, num_workers: int = 4):
        self.queue_id = f"queue_{uuid.uuid4().hex[:8]}"
        self.max_size = max_size
        self.num_workers = num_workers
        self._queue: "queue.PriorityQueue[Tuple[int, str, ModelRequest]]" = queue.PriorityQueue(maxsize=max_size)
        self._requests: Dict[str, ModelRequest] = {}
        self._running = False
        self._workers: List[threading.Thread] = []
        self._lock = threading.RLock()
        self.total_processed = 0
        self.total_failed = 0
        self.total_cancelled = 0
        self.processing_handler: Optional[Callable] = None

    def submit(self, request: ModelRequest, priority: int = 0) -> str:
        with self._lock:
            self._requests[request.request_id] = request
            request.priority = priority
            request.status = "queued"
        self._queue.put((-priority, request.request_id, request))
        return request.request_id

    def cancel(self, request_id: str) -> bool:
        request = self._requests.get(request_id)
        if request and request.status in ("pending", "queued"):
            request.status = "cancelled"
            self.total_cancelled += 1
            return True
        return False

    def get_request(self, request_id: str) -> Optional[ModelRequest]:
        return self._requests.get(request_id)

    def get_queue_size(self) -> int:
        return self._queue.qsize()

    def start(self, handler: Callable):
        if self._running:
            return
        self._running = True
        self.processing_handler = handler
        for i in range(self.num_workers):
            worker = threading.Thread(target=self._worker_loop, args=(i,), daemon=True)
            worker.start()
            self._workers.append(worker)
        terminal.info(f"模型请求队列已启动 ({self.num_workers}个工作线程)", "model_queue")

    def stop(self, wait: bool = True):
        self._running = False
        if wait:
            for worker in self._workers:
                worker.join(timeout=10)

    def _worker_loop(self, worker_id: int):
        while self._running:
            try:
                _, request_id, request = self._queue.get(timeout=1.0)
                if request.status == "cancelled":
                    continue
                request.status = "running"
                request.started_at = time.time()
                try:
                    if self.processing_handler:
                        result = self.processing_handler(request)
                        request.result = result if isinstance(result, str) else str(result)
                        request.status = "success"
                        self.total_processed += 1
                except Exception as e:
                    request.error = str(e)
                    request.status = "failed"
                    self.total_failed += 1
                request.completed_at = time.time()
                request.duration_ms = (request.completed_at - request.started_at) * 1000
                if request.callback:
                    try:
                        request.callback(request)
                    except Exception:
                        pass
            except queue.Empty:
                continue
            except Exception as e:
                terminal.warn(f"工作线程{worker_id}错误: {e}", "model_queue")

    def list_requests(self, status: str = "", limit: int = 50) -> List[ModelRequest]:
        requests = list(self._requests.values())
        if status:
            requests = [r for r in requests if r.status == status]
        requests.sort(key=lambda r: r.created_at, reverse=True)
        return requests[:limit]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "queue_id": self.queue_id,
            "max_size": self.max_size,
            "num_workers": self.num_workers,
            "running": self._running,
            "queue_size": self._queue.qsize(),
            "total_requests": len(self._requests),
            "total_processed": self.total_processed,
            "total_failed": self.total_failed,
            "total_cancelled": self.total_cancelled,
            "success_rate": round(self.total_processed / max(self.total_processed + self.total_failed, 1), 4),
        }
