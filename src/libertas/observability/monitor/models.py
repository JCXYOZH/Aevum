"""监控职责：models。"""

from __future__ import annotations

import json
import os
import shutil
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple


class HealthStatus(Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    CRITICAL = "critical"
    UNKNOWN = "unknown"

class ServiceStatus:
    """服务状态"""

    def __init__(self, name: str = "", service_type: str = ""):
        self.name = name
        self.service_type = service_type
        self.status = HealthStatus.UNKNOWN
        self.uptime = 0.0
        self.last_check = 0.0
        self.response_time_ms = 0.0
        self.error_count = 0
        self.success_count = 0
        self.consecutive_failures = 0
        self.circuit_open = False
        self.circuit_open_since = 0.0
        self.failure_threshold = 5
        self.recovery_timeout = 60.0
        self.metadata: Dict[str, Any] = {}
        self.history: List[Dict[str, Any]] = []

    def record_success(self, response_time: float = 0.0):
        self.success_count += 1
        self.consecutive_failures = 0
        self.response_time_ms = response_time
        self.last_check = time.time()
        if self.circuit_open and time.time() - self.circuit_open_since > self.recovery_timeout:
            self.circuit_open = False
            self.status = HealthStatus.HEALTHY
        elif not self.circuit_open:
            self.status = HealthStatus.HEALTHY
        self._add_history("success")

    def record_failure(self, error: str = ""):
        self.error_count += 1
        self.consecutive_failures += 1
        self.last_check = time.time()
        self.metadata["last_error"] = error
        if self.consecutive_failures >= self.failure_threshold:
            self.circuit_open = True
            self.circuit_open_since = time.time()
            self.status = HealthStatus.CRITICAL
        elif self.consecutive_failures >= self.failure_threshold // 2:
            self.status = HealthStatus.DEGRADED
        self._add_history("failure", error)

    def can_call(self) -> bool:
        if self.circuit_open:
            if time.time() - self.circuit_open_since > self.recovery_timeout:
                return True  # 半开状态，允许探测
            return False
        return True

    def _add_history(self, event: str, detail: str = ""):
        self.history.append({
            "event": event,
            "detail": detail,
            "timestamp": time.time(),
        })
        if len(self.history) > 100:
            self.history = self.history[-100:]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "service_type": self.service_type,
            "status": self.status.value,
            "uptime": self.uptime,
            "last_check": self.last_check,
            "response_time_ms": round(self.response_time_ms, 1),
            "error_count": self.error_count,
            "success_count": self.success_count,
            "consecutive_failures": self.consecutive_failures,
            "circuit_open": self.circuit_open,
            "failure_threshold": self.failure_threshold,
        }

class SystemMetrics:
    """系统指标快照"""

    def __init__(self):
        self.timestamp = time.time()
        self.cpu_percent = 0.0
        self.memory_percent = 0.0
        self.memory_used_mb = 0.0
        self.memory_total_mb = 0.0
        self.disk_percent = 0.0
        self.disk_used_gb = 0.0
        self.disk_total_gb = 0.0
        self.network_in_kbps = 0.0
        self.network_out_kbps = 0.0
        self.active_connections = 0
        self.thread_count = 0
        self.process_count = 0
        self.uptime_seconds = 0.0
        self.load_avg_1m = 0.0
        self.load_avg_5m = 0.0
        self.load_avg_15m = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "time": datetime.fromtimestamp(self.timestamp).strftime("%Y-%m-%d %H:%M:%S"),
            "cpu_percent": self.cpu_percent,
            "memory_percent": self.memory_percent,
            "memory_used_mb": round(self.memory_used_mb, 1),
            "memory_total_mb": round(self.memory_total_mb, 1),
            "disk_percent": self.disk_percent,
            "disk_used_gb": round(self.disk_used_gb, 2),
            "disk_total_gb": round(self.disk_total_gb, 2),
            "network_in_kbps": round(self.network_in_kbps, 1),
            "network_out_kbps": round(self.network_out_kbps, 1),
            "active_connections": self.active_connections,
            "thread_count": self.thread_count,
            "uptime_seconds": self.uptime_seconds,
            "load_avg": [self.load_avg_1m, self.load_avg_5m, self.load_avg_15m],
        }
