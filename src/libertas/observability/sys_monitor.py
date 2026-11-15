"""
core/sys_monitor.py - 系统监控模块

实时监控系统资源、进程、服务、网络、磁盘、日志，支持告警和历史趋势。
"""
import os
import json
import time
import uuid
import threading
import platform
from typing import Any, Callable, Dict, List, Optional, Tuple
from datetime import datetime
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


# ================================================================
# 监控指标类型
# ================================================================
class MetricType(Enum):
    CPU = "cpu"
    MEMORY = "memory"
    DISK = "disk"
    NETWORK = "network"
    PROCESS = "process"
    SERVICE = "service"
    LOAD = "load"
    TEMPERATURE = "temperature"
    GPU = "gpu"


# ================================================================
# 告警级别
# ================================================================
class AlertLevel(Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"
    FATAL = "fatal"


# ================================================================
# 监控数据点
# ================================================================
class MetricPoint:
    """监控数据点"""

    def __init__(self, metric_type: str = "", value: float = 0.0,
                 unit: str = "", tags: Optional[Dict[str, str]] = None):
        self.point_id = f"mp_{uuid.uuid4().hex[:6]}"
        self.metric_type = metric_type
        self.value = value
        self.unit = unit
        self.tags = tags or {}
        self.timestamp = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "point_id": self.point_id,
            "metric_type": self.metric_type,
            "value": self.value,
            "unit": self.unit,
            "tags": self.tags,
            "timestamp": self.timestamp,
            "time": datetime.fromtimestamp(self.timestamp).strftime("%Y-%m-%d %H:%M:%S"),
        }


# ================================================================
# 进程信息
# ================================================================
class ProcessInfo:
    """进程信息"""

    def __init__(self, pid: int = 0, name: str = "", cpu_percent: float = 0.0,
                 memory_mb: float = 0.0, status: str = "",
                 num_threads: int = 0, create_time: float = 0.0):
        self.pid = pid
        self.name = name
        self.cpu_percent = cpu_percent
        self.memory_mb = memory_mb
        self.status = status
        self.num_threads = num_threads
        self.create_time = create_time

    def to_dict(self) -> Dict[str, Any]:
        return {
            "pid": self.pid,
            "name": self.name,
            "cpu_percent": self.cpu_percent,
            "memory_mb": round(self.memory_mb, 1),
            "status": self.status,
            "num_threads": self.num_threads,
            "create_time": self.create_time,
        }


# ================================================================
# 系统监控器
# ================================================================
class SystemMonitor:
    """系统监控模块"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "sys_monitor")
        os.makedirs(self.data_dir, exist_ok=True)
        self._metrics_history: Dict[str, List[MetricPoint]] = {}
        self._alerts: List[Dict[str, Any]] = []
        self._processes: Dict[int, ProcessInfo] = {}
        self._services: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()
        self._monitoring = False
        self._monitor_thread: Optional[threading.Thread] = None
        self._check_interval = 5.0
        self._history_retention = 10000
        self._alert_thresholds: Dict[str, Dict[str, float]] = {
            "cpu_percent": {"warning": 75, "critical": 90},
            "memory_percent": {"warning": 80, "critical": 95},
            "disk_percent": {"warning": 85, "critical": 95},
        }
        self._alert_callbacks: List[Callable] = []
        self._start_time = time.time()
        self._load()

    def _load(self):
        pass  # 监控数据不持久化

    def collect_metrics(self) -> Dict[str, Any]:
        """收集系统指标"""
        metrics = {
            "timestamp": time.time(),
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "platform": platform.platform(),
            "python_version": platform.python_version(),
            "hostname": platform.node(),
        }

        try:
            import psutil
            # CPU
            metrics["cpu_percent"] = psutil.cpu_percent(interval=0.1)
            metrics["cpu_count"] = psutil.cpu_count()
            metrics["cpu_freq"] = psutil.cpu_freq().current if psutil.cpu_freq() else 0
            # 内存
            mem = psutil.virtual_memory()
            metrics["memory_total_mb"] = mem.total / (1024 * 1024)
            metrics["memory_used_mb"] = mem.used / (1024 * 1024)
            metrics["memory_available_mb"] = mem.available / (1024 * 1024)
            metrics["memory_percent"] = mem.percent
            # 交换空间
            swap = psutil.swap_memory()
            metrics["swap_total_mb"] = swap.total / (1024 * 1024)
            metrics["swap_used_mb"] = swap.used / (1024 * 1024)
            metrics["swap_percent"] = swap.percent
            # 磁盘
            disk = psutil.disk_usage("/")
            metrics["disk_total_gb"] = disk.total / (1024 ** 3)
            metrics["disk_used_gb"] = disk.used / (1024 ** 3)
            metrics["disk_free_gb"] = disk.free / (1024 ** 3)
            metrics["disk_percent"] = disk.percent
            # 网络
            net = psutil.net_io_counters()
            metrics["net_bytes_sent"] = net.bytes_sent
            metrics["net_bytes_recv"] = net.bytes_recv
            metrics["net_packets_sent"] = net.packets_sent
            metrics["net_packets_recv"] = net.packets_recv
            metrics["net_connections"] = len(psutil.net_connections())
            # 负载
            if hasattr(psutil, "getloadavg"):
                load = psutil.getloadavg()
                metrics["load_1m"] = load[0]
                metrics["load_5m"] = load[1]
                metrics["load_15m"] = load[2]
            # 进程
            metrics["process_count"] = len(psutil.pids())
            metrics["thread_count"] = threading.active_count()
            # 启动时间
            metrics["boot_time"] = psutil.boot_time()
            metrics["uptime_seconds"] = time.time() - psutil.boot_time()

            # 记录历史
            self._record_metric("cpu_percent", metrics["cpu_percent"], "%")
            self._record_metric("memory_percent", metrics["memory_percent"], "%")
            self._record_metric("disk_percent", metrics["disk_percent"], "%")

            # 检查告警
            self._check_alerts(metrics)

            # 收集进程信息
            self._collect_processes()

        except ImportError:
            metrics["cpu_percent"] = 0.0
            metrics["memory_percent"] = 0.0
            metrics["disk_percent"] = 0.0
            metrics["process_count"] = 0
            metrics["thread_count"] = threading.active_count()
            metrics["note"] = "psutil not installed, limited metrics"

        return metrics

    def _record_metric(self, metric_type: str, value: float, unit: str = ""):
        point = MetricPoint(metric_type, value, unit)
        with self._lock:
            if metric_type not in self._metrics_history:
                self._metrics_history[metric_type] = []
            self._metrics_history[metric_type].append(point)
            if len(self._metrics_history[metric_type]) > self._history_retention:
                self._metrics_history[metric_type] = self._metrics_history[metric_type][-self._history_retention:]

    def _check_alerts(self, metrics: Dict[str, Any]):
        """检查告警阈值"""
        for metric, thresholds in self._alert_thresholds.items():
            value = metrics.get(metric)
            if value is None:
                continue
            if value >= thresholds.get("critical", 100):
                self._trigger_alert(metric, value, "critical",
                                   f"{metric} = {value:.1f}% 超过严重阈值")
            elif value >= thresholds.get("warning", 80):
                self._trigger_alert(metric, value, "warning",
                                   f"{metric} = {value:.1f}% 超过警告阈值")

    def _trigger_alert(self, metric: str, value: float, level: str, message: str):
        alert = {
            "alert_id": f"alert_{uuid.uuid4().hex[:6]}",
            "metric": metric,
            "value": value,
            "level": level,
            "message": message,
            "timestamp": time.time(),
            "acknowledged": False,
        }
        with self._lock:
            # 避免重复告警（5分钟内相同指标相同级别）
            recent = [a for a in self._alerts
                     if a["metric"] == metric and a["level"] == level
                     and time.time() - a["timestamp"] < 300]
            if not recent:
                self._alerts.append(alert)
                if len(self._alerts) > 500:
                    self._alerts = self._alerts[-200:]
                for callback in self._alert_callbacks:
                    try:
                        callback(alert)
                    except Exception:
                        pass
                if level == "critical":
                    terminal.error(f"[系统告警] {message}", "sys_monitor")
                else:
                    terminal.warn(f"[系统告警] {message}", "sys_monitor")

    def _collect_processes(self):
        """收集进程信息"""
        try:
            import psutil
            with self._lock:
                self._processes.clear()
                for proc in psutil.process_iter(['pid', 'name', 'cpu_percent',
                                                  'memory_info', 'status',
                                                  'num_threads', 'create_time']):
                    try:
                        info = proc.info
                        pinfo = ProcessInfo(
                            pid=info['pid'],
                            name=info['name'] or "",
                            cpu_percent=info['cpu_percent'] or 0,
                            memory_mb=(info['memory_info'].rss / (1024 * 1024)) if info['memory_info'] else 0,
                            status=info['status'] or "",
                            num_threads=info['num_threads'] or 0,
                            create_time=info['create_time'] or 0,
                        )
                        self._processes[pinfo.pid] = pinfo
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
        except ImportError:
            pass

    def get_metric_history(self, metric_type: str, limit: int = 100) -> List[MetricPoint]:
        with self._lock:
            history = self._metrics_history.get(metric_type, [])
            return list(reversed(history[-limit:]))

    def get_metric_stats(self, metric_type: str) -> Dict[str, Any]:
        """获取指标统计"""
        history = self._metrics_history.get(metric_type, [])
        if not history:
            return {"count": 0}
        values = [p.value for p in history]
        return {
            "count": len(values),
            "min": min(values),
            "max": max(values),
            "avg": sum(values) / len(values),
            "latest": values[-1],
            "first_timestamp": history[0].timestamp,
            "last_timestamp": history[-1].timestamp,
        }

    def get_top_processes(self, by: str = "cpu", limit: int = 10) -> List[ProcessInfo]:
        """获取资源占用最高的进程"""
        with self._lock:
            processes = list(self._processes.values())
        if by == "cpu":
            processes.sort(key=lambda p: p.cpu_percent, reverse=True)
        elif by == "memory":
            processes.sort(key=lambda p: p.memory_mb, reverse=True)
        return processes[:limit]

    def get_process(self, pid: int) -> Optional[ProcessInfo]:
        return self._processes.get(pid)

    def list_alerts(self, level: str = "", acknowledged: Optional[bool] = None,
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
                alert["acknowledged_at"] = time.time()
                return True
        return False

    def set_alert_threshold(self, metric: str, warning: float, critical: float):
        self._alert_thresholds[metric] = {"warning": warning, "critical": critical}

    def on_alert(self, callback: Callable):
        self._alert_callbacks.append(callback)

    def start_monitoring(self, interval: float = 5.0):
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
                    terminal.warn(f"监控采集失败: {e}", "sys_monitor")
                time.sleep(self._check_interval)

        self._monitor_thread = threading.Thread(target=_monitor_loop, daemon=True)
        self._monitor_thread.start()
        terminal.info(f"系统监控已启动 (间隔{interval}s)", "sys_monitor")

    def stop_monitoring(self):
        self._monitoring = False
        if self._monitor_thread:
            self._monitor_thread.join(timeout=5)

    def get_current_metrics(self) -> Dict[str, Any]:
        return self.collect_metrics()

    def get_system_summary(self) -> Dict[str, Any]:
        """获取系统摘要"""
        metrics = self.collect_metrics()
        return {
            "hostname": metrics.get("hostname", ""),
            "platform": metrics.get("platform", ""),
            "cpu_percent": metrics.get("cpu_percent", 0),
            "memory_percent": metrics.get("memory_percent", 0),
            "disk_percent": metrics.get("disk_percent", 0),
            "process_count": metrics.get("process_count", 0),
            "thread_count": metrics.get("thread_count", 0),
            "uptime_seconds": metrics.get("uptime_seconds", 0),
            "active_alerts": sum(1 for a in self._alerts if not a["acknowledged"]),
            "monitoring": self._monitoring,
        }

    def get_stats(self) -> Dict[str, Any]:
        return {
            "monitoring": self._monitoring,
            "check_interval": self._check_interval,
            "metrics_tracked": len(self._metrics_history),
            "total_data_points": sum(len(h) for h in self._metrics_history.values()),
            "total_alerts": len(self._alerts),
            "unacknowledged_alerts": sum(1 for a in self._alerts if not a["acknowledged"]),
            "processes_tracked": len(self._processes),
            "uptime_seconds": time.time() - self._start_time,
            "alert_thresholds": self._alert_thresholds,
        }


# 全局系统监控器
_system_monitor = SystemMonitor()


def get_system_monitor() -> SystemMonitor:
    return _system_monitor


def collect_system_metrics() -> Dict[str, Any]:
    return _system_monitor.collect_metrics()
