"""
core/metrics.py - 轻量指标系统

提供 Counter / Gauge / Histogram / Timer 四种指标类型，
内存聚合 + 定期落盘 + 查询 API，不依赖第三方库。
"""
import time
import json
import threading
import math
from typing import Any, Dict, List, Optional, Tuple
from collections import defaultdict, deque
from datetime import datetime
from .terminal import terminal


# ================================================================
# 指标基类
# ================================================================
class Metric:
    """指标基类"""

    def __init__(self, name: str, description: str = "", labels: Optional[Dict[str, str]] = None):
        self.name = name
        self.description = description
        self.labels = labels or {}
        self._lock = threading.Lock()
        self._created_at = time.time()

    def get_value(self) -> Any:
        raise NotImplementedError

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "labels": self.labels,
            "type": type(self).__name__,
            "value": self.get_value(),
            "created_at": self._created_at,
        }


# ================================================================
# Counter（计数器）
# ================================================================
class Counter(Metric):
    """单调递增计数器"""

    def __init__(self, name: str, description: str = "", labels: Optional[Dict[str, str]] = None):
        super().__init__(name, description, labels)
        self._value = 0

    def inc(self, amount: float = 1):
        with self._lock:
            self._value += max(0, amount)

    def get_value(self) -> float:
        with self._lock:
            return self._value

    def reset(self):
        with self._lock:
            self._value = 0


# ================================================================
# Gauge（仪表盘）
# ================================================================
class Gauge(Metric):
    """可增可减的瞬时值"""

    def __init__(self, name: str, description: str = "", labels: Optional[Dict[str, str]] = None):
        super().__init__(name, description, labels)
        self._value = 0.0

    def set(self, value: float):
        with self._lock:
            self._value = value

    def inc(self, amount: float = 1):
        with self._lock:
            self._value += amount

    def dec(self, amount: float = 1):
        with self._lock:
            self._value -= amount

    def get_value(self) -> float:
        with self._lock:
            return self._value


# ================================================================
# Histogram（直方图）
# ================================================================
class Histogram(Metric):
    """直方图，统计值分布"""

    DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]

    def __init__(self, name: str, description: str = "",
                 buckets: Optional[List[float]] = None,
                 labels: Optional[Dict[str, str]] = None):
        super().__init__(name, description, labels)
        self.buckets = sorted(buckets or self.DEFAULT_BUCKETS)
        self._count = 0
        self._sum = 0.0
        self._bucket_counts = [0] * (len(self.buckets) + 1)
        self._min = float("inf")
        self._max = float("-inf")

    def observe(self, value: float):
        with self._lock:
            self._count += 1
            self._sum += value
            self._min = min(self._min, value)
            self._max = max(self._max, value)
            for i, bound in enumerate(self.buckets):
                if value <= bound:
                    self._bucket_counts[i] += 1
                    break
            else:
                self._bucket_counts[-1] += 1

    def get_value(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "count": self._count,
                "sum": self._sum,
                "avg": self._sum / self._count if self._count > 0 else 0,
                "min": self._min if self._count > 0 else 0,
                "max": self._max if self._count > 0 else 0,
                "buckets": {str(b): c for b, c in zip(self.buckets + ["+Inf"], self._bucket_counts)},
            }

    def percentile(self, p: float) -> float:
        """计算百分位数（线性插值近似）"""
        with self._lock:
            if self._count == 0:
                return 0.0
            target = self._count * p
            cumulative = 0
            for i, bound in enumerate(self.buckets):
                cumulative += self._bucket_counts[i]
                if cumulative >= target:
                    prev_bound = self.buckets[i - 1] if i > 0 else 0
                    prev_cumulative = cumulative - self._bucket_counts[i]
                    if self._bucket_counts[i] > 0:
                        fraction = (target - prev_cumulative) / self._bucket_counts[i]
                        return prev_bound + fraction * (bound - prev_bound)
                    return bound
            return self._max


# ================================================================
# Timer（计时器）
# ================================================================
class Timer:
    """计时器，配合 Histogram 使用"""

    def __init__(self, histogram: Histogram):
        self.histogram = histogram
        self._start_time: Optional[float] = None
        self._elapsed = 0.0

    def start(self):
        self._start_time = time.time()
        return self

    def stop(self) -> float:
        if self._start_time is not None:
            self._elapsed = time.time() - self._start_time
            self.histogram.observe(self._elapsed)
            self._start_time = None
        return self._elapsed

    def __enter__(self):
        return self.start()

    def __exit__(self, *args):
        self.stop()

    @property
    def elapsed(self) -> float:
        if self._start_time is not None:
            return time.time() - self._start_time
        return self._elapsed


# ================================================================
# 指标注册表
# ================================================================
class MetricsRegistry:
    """指标注册表，管理所有指标实例"""

    def __init__(self):
        self._metrics: Dict[str, Metric] = {}
        self._lock = threading.Lock()
        self._persist_path: Optional[str] = None
        self._persist_interval = 300.0
        self._last_persist = 0.0

    def register(self, metric: Metric) -> Metric:
        with self._lock:
            key = self._make_key(metric.name, metric.labels)
            if key in self._metrics:
                return self._metrics[key]
            self._metrics[key] = metric
            return metric

    def _make_key(self, name: str, labels: Dict[str, str]) -> str:
        label_str = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
        return f"{name}[{label_str}]" if label_str else name

    def counter(self, name: str, description: str = "", labels: Optional[Dict[str, str]] = None) -> Counter:
        m = Counter(name, description, labels)
        return self.register(m)  # type: ignore

    def gauge(self, name: str, description: str = "", labels: Optional[Dict[str, str]] = None) -> Gauge:
        m = Gauge(name, description, labels)
        return self.register(m)  # type: ignore

    def histogram(self, name: str, description: str = "",
                  buckets: Optional[List[float]] = None,
                  labels: Optional[Dict[str, str]] = None) -> Histogram:
        m = Histogram(name, description, buckets, labels)
        return self.register(m)  # type: ignore

    def timer(self, name: str, description: str = "",
              buckets: Optional[List[float]] = None,
              labels: Optional[Dict[str, str]] = None) -> Timer:
        h = self.histogram(name, description, buckets, labels)
        return Timer(h)

    def get(self, name: str, labels: Optional[Dict[str, str]] = None) -> Optional[Metric]:
        with self._lock:
            key = self._make_key(name, labels or {})
            return self._metrics.get(key)

    def get_all(self) -> Dict[str, Metric]:
        with self._lock:
            return dict(self._metrics)

    def remove(self, name: str, labels: Optional[Dict[str, str]] = None):
        with self._lock:
            key = self._make_key(name, labels or {})
            self._metrics.pop(key, None)

    def clear(self):
        with self._lock:
            self._metrics.clear()

    def snapshot(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [m.to_dict() for m in self._metrics.values()]

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.snapshot(), ensure_ascii=False, indent=indent, default=str)

    def set_persist_path(self, path: str, interval: float = 300.0):
        self._persist_path = path
        self._persist_interval = interval

    def maybe_persist(self):
        now = time.time()
        if not self._persist_path:
            return
        if now - self._last_persist < self._persist_interval:
            return
        self._last_persist = now
        try:
            import os
            os.makedirs(os.path.dirname(self._persist_path), exist_ok=True)
            with open(self._persist_path, "w", encoding="utf-8") as f:
                f.write(self.to_json())
        except Exception as e:
            terminal.warn(f"指标持久化失败: {e}", "metrics")

    def load(self, path: str):
        """从文件加载指标（仅恢复 Counter 和 Gauge 的值）"""
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for item in data:
                name = item.get("name", "")
                mtype = item.get("type", "")
                labels = item.get("labels", {})
                value = item.get("value")
                if mtype == "Counter":
                    c = self.counter(name, labels=labels)
                    c._value = value  # type: ignore
                elif mtype == "Gauge":
                    g = self.gauge(name, labels=labels)
                    g._value = value  # type: ignore
        except Exception as e:
            terminal.warn(f"指标加载失败: {e}", "metrics")


# ================================================================
# 全局注册表与便捷函数
# ================================================================
_registry = MetricsRegistry()


def get_registry() -> MetricsRegistry:
    return _registry


def counter(name: str, description: str = "", labels: Optional[Dict[str, str]] = None) -> Counter:
    return _registry.counter(name, description, labels)


def gauge(name: str, description: str = "", labels: Optional[Dict[str, str]] = None) -> Gauge:
    return _registry.gauge(name, description, labels)


def histogram(name: str, description: str = "", buckets: Optional[List[float]] = None,
              labels: Optional[Dict[str, str]] = None) -> Histogram:
    return _registry.histogram(name, description, buckets, labels)


def timer(name: str, description: str = "", buckets: Optional[List[float]] = None,
          labels: Optional[Dict[str, str]] = None) -> Timer:
    return _registry.timer(name, description, buckets, labels)


def metrics_snapshot() -> List[Dict[str, Any]]:
    return _registry.snapshot()


def metrics_to_json() -> str:
    return _registry.to_json()


# ================================================================
# 系统指标采集器
# ================================================================
class SystemMetricsCollector:
    """系统资源指标采集器"""

    def __init__(self, registry: Optional[MetricsRegistry] = None):
        self.registry = registry or _registry
        self._cpu_counter = self.registry.gauge("system_cpu_percent", "CPU 使用率")
        self._mem_counter = self.registry.gauge("system_memory_percent", "内存使用率")
        self._mem_bytes = self.registry.gauge("system_memory_bytes", "内存使用字节数")
        self._disk_counter = self.registry.gauge("system_disk_percent", "磁盘使用率")
        self._thread_counter = self.registry.gauge("system_thread_count", "线程数")
        self._uptime = self.registry.gauge("system_uptime_seconds", "运行时间（秒）")
        self._start_time = time.time()
        self._last_cpu_times = None

    def collect(self):
        """采集一次系统指标"""
        try:
            import psutil
            self._cpu_counter.set(psutil.cpu_percent(interval=0.1))
            mem = psutil.virtual_memory()
            self._mem_counter.set(mem.percent)
            self._mem_bytes.set(mem.used)
            disk = psutil.disk_usage("/")
            self._disk_counter.set(disk.percent)
            self._thread_counter.set(threading.active_count())
        except ImportError:
            self._collect_fallback()
        except Exception:
            self._collect_fallback()

        self._uptime.set(time.time() - self._start_time)

    def _collect_fallback(self):
        """无 psutil 时的降级采集"""
        try:
            import os
            self._thread_counter.set(threading.active_count())
            if hasattr(os, "getloadavg"):
                load = os.getloadavg()
                self._cpu_counter.set(load[0] * 100 / max(1, os.cpu_count() or 1))
        except Exception:
            pass

    def get_summary(self) -> Dict[str, Any]:
        return {
            "cpu_percent": self._cpu_counter.get_value(),
            "memory_percent": self._mem_counter.get_value(),
            "memory_bytes": self._mem_bytes.get_value(),
            "disk_percent": self._disk_counter.get_value(),
            "thread_count": self._thread_counter.get_value(),
            "uptime_seconds": self._uptime.get_value(),
        }


# 全局系统采集器
_system_collector = SystemMetricsCollector()


def collect_system_metrics() -> Dict[str, Any]:
    _system_collector.collect()
    return _system_collector.get_summary()


def get_system_metrics() -> Dict[str, Any]:
    return _system_collector.get_summary()
