"""监控职责：manager。"""

from __future__ import annotations

import json
import os
import shutil
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from .models import HealthStatus
from .models import ServiceStatus
from .models import SystemMetrics
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

class MonitorManager:
    """系统监控与容错管理"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "monitor")
        os.makedirs(self.data_dir, exist_ok=True)
        self._services: Dict[str, ServiceStatus] = {}
        self._metrics_history: List[SystemMetrics] = []
        self._alerts: List[Dict[str, Any]] = []
        self._lock = threading.RLock()
        self._monitoring = False
        self._monitor_thread: Optional[threading.Thread] = None
        self._check_interval = 30.0
        self._metrics_retention = 1000
        self._alert_callbacks: List[Callable] = []
        self._degradation_handlers: Dict[str, Callable] = {}
        self._start_time = time.time()
        self._init_services()

    def _init_services(self):
        """初始化默认服务监控"""
        services = [
            ("main", "core"),
            ("database", "data"),
            ("cache", "data"),
            ("api", "network"),
            ("model", "ai"),
            ("search", "search"),
            ("storage", "storage"),
            ("auth", "security"),
        ]
        for name, stype in services:
            self._services[name] = ServiceStatus(name, stype)

    def register_service(self, name: str, service_type: str = "",
                         failure_threshold: int = 5) -> str:
        service = ServiceStatus(name, service_type)
        service.failure_threshold = failure_threshold
        with self._lock:
            self._services[name] = service
        return name

    def unregister_service(self, name: str) -> bool:
        with self._lock:
            if name in self._services:
                del self._services[name]
                return True
        return False

    def get_service(self, name: str) -> Optional[ServiceStatus]:
        return self._services.get(name)

    def record_service_success(self, name: str, response_time: float = 0.0):
        service = self._services.get(name)
        if service:
            service.record_success(response_time)

    def record_service_failure(self, name: str, error: str = ""):
        service = self._services.get(name)
        if service:
            service.record_failure(error)
            if service.circuit_open:
                self._trigger_alert("circuit_open", f"服务 {name} 熔断器打开", "critical")
                handler = self._degradation_handlers.get(name)
                if handler:
                    try:
                        handler(service)
                    except Exception:
                        pass

    def can_call_service(self, name: str) -> bool:
        service = self._services.get(name)
        return service.can_call() if service else True

    def list_services(self) -> List[ServiceStatus]:
        return list(self._services.values())

    def register_degradation_handler(self, service_name: str, handler: Callable):
        self._degradation_handlers[service_name] = handler

    def register_alert_callback(self, callback: Callable):
        self._alert_callbacks.append(callback)

    def _trigger_alert(self, alert_type: str, message: str, level: str = "warning"):
        alert = {
            "alert_id": f"alert_{uuid.uuid4().hex[:6]}",
            "type": alert_type,
            "message": message,
            "level": level,
            "timestamp": time.time(),
            "acknowledged": False,
        }
        with self._lock:
            self._alerts.append(alert)
            if len(self._alerts) > 500:
                self._alerts = self._alerts[-200:]
        for callback in self._alert_callbacks:
            try:
                callback(alert)
            except Exception:
                pass
        if level == "critical":
            terminal.error(f"[监控告警] {message}", "monitor")
        else:
            terminal.warn(f"[监控告警] {message}", "monitor")

    def collect_metrics(self) -> SystemMetrics:
        """收集系统指标"""
        metrics = SystemMetrics()
        try:
            import psutil
            metrics.cpu_percent = psutil.cpu_percent(interval=0.1)
            mem = psutil.virtual_memory()
            metrics.memory_percent = mem.percent
            metrics.memory_used_mb = mem.used / (1024 * 1024)
            metrics.memory_total_mb = mem.total / (1024 * 1024)
            disk = psutil.disk_usage("/")
            metrics.disk_percent = disk.percent
            metrics.disk_used_gb = disk.used / (1024 ** 3)
            metrics.disk_total_gb = disk.total / (1024 ** 3)
            metrics.thread_count = threading.active_count()
            metrics.uptime_seconds = time.time() - self._start_time
            if hasattr(psutil, "getloadavg"):
                load = psutil.getloadavg()
                metrics.load_avg_1m, metrics.load_avg_5m, metrics.load_avg_15m = load
        except ImportError:
            # psutil 不可用时的简化指标
            metrics.cpu_percent = 0.0
            metrics.memory_percent = 0.0
            metrics.thread_count = threading.active_count()
            metrics.uptime_seconds = time.time() - self._start_time

        # 阈值检查
        if metrics.cpu_percent > 90:
            self._trigger_alert("high_cpu", f"CPU使用率过高: {metrics.cpu_percent}%", "critical")
        elif metrics.cpu_percent > 75:
            self._trigger_alert("high_cpu", f"CPU使用率偏高: {metrics.cpu_percent}%", "warning")
        if metrics.memory_percent > 90:
            self._trigger_alert("high_memory", f"内存使用率过高: {metrics.memory_percent}%", "critical")
        elif metrics.memory_percent > 80:
            self._trigger_alert("high_memory", f"内存使用率偏高: {metrics.memory_percent}%", "warning")
        if metrics.disk_percent > 90:
            self._trigger_alert("low_disk", f"磁盘空间不足: {metrics.disk_percent}%", "critical")

        with self._lock:
            self._metrics_history.append(metrics)
            if len(self._metrics_history) > self._metrics_retention:
                self._metrics_history = self._metrics_history[-self._metrics_retention:]

        return metrics

    def get_latest_metrics(self) -> Optional[SystemMetrics]:
        return self._metrics_history[-1] if self._metrics_history else None

    def get_metrics_history(self, limit: int = 100) -> List[SystemMetrics]:
        return list(reversed(self._metrics_history[-limit:]))

    def start_monitoring(self, interval: float = 30.0):
        """启动后台监控"""
        if self._monitoring:
            return
        self._monitoring = True
        self._check_interval = interval

        def _monitor_loop():
            while self._monitoring:
                try:
                    self.collect_metrics()
                except Exception as e:
                    terminal.warn(f"监控采集失败: {e}", "monitor")
                time.sleep(self._check_interval)

        self._monitor_thread = threading.Thread(target=_monitor_loop, daemon=True)
        self._monitor_thread.start()
        terminal.info(f"系统监控已启动 (间隔{interval}s)", "monitor")

    def stop_monitoring(self):
        self._monitoring = False
        if self._monitor_thread:
            self._monitor_thread.join(timeout=5)
        terminal.info("系统监控已停止", "monitor")

    def get_alerts(self, level: str = "", acknowledged: Optional[bool] = None,
                   limit: int = 50) -> List[Dict[str, Any]]:
        alerts = list(reversed(self._alerts))
        if level:
            alerts = [a for a in alerts if a["level"] == level]
        if acknowledged is not None:
            alerts = [a for a in alerts if a["acknowledged"] == acknowledged]
        return alerts[:limit]

    def acknowledge_alert(self, alert_id: str) -> bool:
        for alert in self._alerts:
            if alert["alert_id"] == alert_id:
                alert["acknowledged"] = True
                return True
        return False

    def get_overall_health(self) -> Dict[str, Any]:
        """获取整体健康状态"""
        services = list(self._services.values())
        healthy = sum(1 for s in services if s.status == HealthStatus.HEALTHY)
        degraded = sum(1 for s in services if s.status == HealthStatus.DEGRADED)
        critical = sum(1 for s in services if s.status == HealthStatus.CRITICAL)
        offline = sum(1 for s in services if s.circuit_open)

        if critical > 0 or offline > 0:
            overall = HealthStatus.CRITICAL
        elif degraded > 0:
            overall = HealthStatus.DEGRADED
        elif healthy > 0:
            overall = HealthStatus.HEALTHY
        else:
            overall = HealthStatus.UNKNOWN

        latest = self.get_latest_metrics()
        return {
            "overall_status": overall.value,
            "total_services": len(services),
            "healthy": healthy,
            "degraded": degraded,
            "critical": critical,
            "circuit_open": offline,
            "uptime_seconds": time.time() - self._start_time,
            "monitoring": self._monitoring,
            "latest_metrics": latest.to_dict() if latest else None,
            "unacknowledged_alerts": sum(1 for a in self._alerts if not a["acknowledged"]),
        }

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_services": len(self._services),
            "metrics_collected": len(self._metrics_history),
            "total_alerts": len(self._alerts),
            "unacknowledged_alerts": sum(1 for a in self._alerts if not a["acknowledged"]),
            "monitoring": self._monitoring,
            "check_interval": self._check_interval,
            "uptime_seconds": time.time() - self._start_time,
        }
