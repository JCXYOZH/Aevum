"""监控职责：performance。"""

from __future__ import annotations

import json
import os
import shutil
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from .singleton import get_monitor_manager

class PerformanceMonitor:
    """旧版性能监控器兼容层，包装 MonitorManager"""

    def __init__(self, max_records: int = 1000):
        self.max_records = max_records
        self._dialogue_records = []
        self._error_records = []
        self._benchmark_score = 0.0
        self._mgr = get_monitor_manager()

    def record_dialogue_performance(self, processing_time: float,
                                     input_length: int, output_length: int,
                                     model_name: str = "", tokens_used: int = 0,
                                     **kwargs):
        record = {
            "timestamp": time.time(),
            "processing_time": processing_time,
            "input_length": input_length,
            "output_length": output_length,
            "model_name": model_name,
            "tokens_used": tokens_used,
        }
        record.update(kwargs)
        self._dialogue_records.append(record)
        if len(self._dialogue_records) > self.max_records:
            self._dialogue_records = self._dialogue_records[-self.max_records:]

    def record_error(self, error_type: str, error_message: str, module: str = ""):
        record = {
            "timestamp": time.time(),
            "error_type": error_type,
            "error_message": error_message,
            "module": module,
        }
        self._error_records.append(record)
        if len(self._error_records) > self.max_records:
            self._error_records = self._error_records[-self.max_records:]

    def get_system_metrics(self) -> Dict[str, Any]:
        metrics = self._mgr.get_latest_metrics()
        if metrics:
            return metrics.to_dict() if hasattr(metrics, 'to_dict') else dict(metrics)
        return {
            "cpu_percent": 0.0,
            "memory_percent": 0.0,
            "disk_percent": 0.0,
            "active_connections": 0,
            "dialogue_count": len(self._dialogue_records),
            "error_count": len(self._error_records),
        }

    def run_full_benchmark(self, system_components: Dict) -> Dict:
        results = {}
        for name, component in system_components.items():
            start = time.time()
            try:
                if hasattr(component, 'benchmark'):
                    component.benchmark()
                elif callable(component):
                    component()
                results[name] = {"status": "ok", "duration_ms": (time.time() - start) * 1000}
            except Exception as e:
                results[name] = {"status": "error", "error": str(e)}
        self._benchmark_score = sum(1 for r in results.values() if r.get("status") == "ok") / max(len(results), 1) * 100
        return {"score": self._benchmark_score, "components": results}

    def check_system_health(self) -> float:
        health = self._mgr.get_overall_health()
        if isinstance(health, dict):
            return health.get("health_score", 80.0)
        return 80.0

    def get_benchmark_score(self) -> float:
        return self._benchmark_score

    def get_dialogue_stats(self) -> Dict[str, Any]:
        if not self._dialogue_records:
            return {"count": 0}
        times = [r["processing_time"] for r in self._dialogue_records]
        return {
            "count": len(times),
            "avg_time": sum(times) / len(times),
            "min_time": min(times),
            "max_time": max(times),
        }

    def get_error_stats(self) -> Dict[str, Any]:
        if not self._error_records:
            return {"count": 0}
        by_type = {}
        for r in self._error_records:
            by_type[r["error_type"]] = by_type.get(r["error_type"], 0) + 1
        return {"count": len(self._error_records), "by_type": by_type}
