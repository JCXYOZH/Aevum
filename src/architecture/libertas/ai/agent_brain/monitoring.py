"""
core/agent_brain.py - Agent自主循环大脑

核心能力：七阶段自主循环（感知→思考→规划→决策→执行→观察→反思→学习）、
状态机驱动、任务动态规划、多策略决策、上下文智能裁剪、反思学习闭环、
目标层级管理、注意力聚焦、自我监控、可中断可恢复。
整合记忆库、工具库、代码库三大本地化能力。
"""
import os
import sys
import json
import time
import uuid
import math
import hashlib
import threading
import re
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter, defaultdict
from enum import Enum
from libertas.foundation.terminal import terminal


from .enums import AgentPhase, DecisionStrategy, GoalType, TaskPriority, TaskStatus
from .models import AgentState, CycleRecord, Goal, Task



class SelfMonitor:
    """自我监控 - 状态/进度/资源/异常监控"""

    def __init__(self):
        self.monitor_id = f"mon_{uuid.uuid4().hex[:8]}"
        self.metrics: Dict[str, Any] = defaultdict(float)
        self.alerts: deque = deque(maxlen=100)
        self.anomalies: deque = deque(maxlen=50)
        self._lock = threading.RLock()
        self._start_time = time.time()

    def record_metric(self, name: str, value: float):
        with self._lock:
            self.metrics[name] = value
            # 异常检测
            self._check_anomaly(name, value)

    def increment_metric(self, name: str, amount: float = 1.0):
        with self._lock:
            self.metrics[name] += amount

    def get_metric(self, name: str) -> float:
        return self.metrics.get(name, 0.0)

    def _check_anomaly(self, name: str, value: float):
        """简单异常检测"""
        # 连续错误过多
        if name == "consecutive_errors" and value >= 3:
            self._add_alert("warning", f"连续错误 {value} 次，可能需要人工干预")
        # token使用过高
        if name == "token_usage" and value > 80000:
            self._add_alert("warning", f"Token使用量过高 ({value})，接近预算上限")
        # 循环次数过多
        if name == "cycle_count" and value > 50:
            self._add_alert("info", f"循环次数较多 ({value})，任务可能较复杂")
        # 单步耗时过长
        if name == "step_duration_ms" and value > 30000:
            self._add_alert("warning", f"单步执行耗时过长 ({value}ms)")

    def _add_alert(self, level: str, message: str):
        alert = {
            "alert_id": f"alert_{uuid.uuid4().hex[:6]}",
            "level": level,
            "message": message,
            "timestamp": time.time(),
            "acknowledged": False,
        }
        with self._lock:
            self.alerts.append(alert)
            if level in ("warning", "critical"):
                self.anomalies.append(alert)
        terminal.warn(f"[{level.upper()}] {message}", "self_monitor")

    def get_alerts(self, level: str = "", unacknowledged_only: bool = False) -> List[Dict]:
        alerts = list(self.alerts)
        if level:
            alerts = [a for a in alerts if a["level"] == level]
        if unacknowledged_only:
            alerts = [a for a in alerts if not a["acknowledged"]]
        return alerts

    def acknowledge_alert(self, alert_id: str) -> bool:
        for alert in self.alerts:
            if alert["alert_id"] == alert_id:
                alert["acknowledged"] = True
                return True
        return False

    def get_health_status(self) -> Dict[str, Any]:
        """获取健康状态"""
        uptime = time.time() - self._start_time
        return {
            "monitor_id": self.monitor_id,
            "uptime_seconds": round(uptime, 1),
            "uptime_formatted": f"{int(uptime//3600)}h {int((uptime%3600)//60)}m {int(uptime%60)}s",
            "cycle_count": self.get_metric("cycle_count"),
            "total_actions": self.get_metric("total_actions"),
            "success_count": self.get_metric("success_count"),
            "error_count": self.get_metric("error_count"),
            "success_rate": round(self.get_metric("success_count") /
                                  max(self.get_metric("total_actions"), 1), 4),
            "token_used": self.get_metric("token_usage"),
            "active_alerts": len([a for a in self.alerts if not a["acknowledged"]]),
            "anomalies": len(self.anomalies),
            "status": "healthy" if self.get_metric("consecutive_errors") < 3 else "degraded",
        }

    def get_stats(self) -> Dict[str, Any]:
        return {
            "monitor_id": self.monitor_id,
            "metrics_count": len(self.metrics),
            "alerts_count": len(self.alerts),
            "anomalies_count": len(self.anomalies),
            "health": self.get_health_status(),
        }
