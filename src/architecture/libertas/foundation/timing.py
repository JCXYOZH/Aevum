"""
core/timing.py - 管线耗时追踪器

提供上下文管理器、装饰器、手动 start/stop 三种计时方式，
支持层级计时、统计聚合、实时监控、性能回归检测。
"""
import time
import json
import threading
import functools
from typing import Any, Callable, Dict, List, Optional, Tuple, Dict, List, Optional
from collections import defaultdict, deque
from datetime import datetime
from libertas.foundation.terminal import terminal


# ================================================================
# 计时记录
# ================================================================
class TimingRecord:
    """单次计时记录"""

    __slots__ = ("name", "start_time", "end_time", "duration", "tags", "metadata", "success")

    def __init__(self, name: str, tags: Optional[Dict[str, str]] = None,
                 metadata: Optional[Dict[str, Any]] = None):
        self.name = name
        self.start_time = 0.0
        self.end_time = 0.0
        self.duration = 0.0
        self.tags = tags or {}
        self.metadata = metadata or {}
        self.success = True

    def start(self):
        self.start_time = time.perf_counter()

    def stop(self, success: bool = True):
        self.end_time = time.perf_counter()
        self.duration = (self.end_time - self.start_time) * 1000  # 毫秒
        self.success = success

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "duration_ms": round(self.duration, 3),
            "success": self.success,
            "tags": self.tags,
            "timestamp": datetime.fromtimestamp(time.time()).strftime("%Y-%m-%d %H:%M:%S"),
        }


# ================================================================
# 计时统计
# ================================================================
class TimingStats:
    """计时统计聚合"""

    def __init__(self, name: str):
        self.name = name
        self.count = 0
        self.total_ms = 0.0
        self.min_ms = float("inf")
        self.max_ms = 0.0
        self.success_count = 0
        self.failure_count = 0
        self._recent: deque = deque(maxlen=1000)
        self._lock = threading.Lock()

    def record(self, duration_ms: float, success: bool = True):
        with self._lock:
            self.count += 1
            self.total_ms += duration_ms
            self.min_ms = min(self.min_ms, duration_ms)
            self.max_ms = max(self.max_ms, duration_ms)
            if success:
                self.success_count += 1
            else:
                self.failure_count += 1
            self._recent.append(duration_ms)

    @property
    def avg_ms(self) -> float:
        return self.total_ms / self.count if self.count > 0 else 0.0

    @property
    def median_ms(self) -> float:
        with self._lock:
            if not self._recent:
                return 0.0
            sorted_vals = sorted(self._recent)
            n = len(sorted_vals)
            return sorted_vals[n // 2] if n % 2 == 1 else (sorted_vals[n//2-1] + sorted_vals[n//2]) / 2

    def percentile(self, p: float) -> float:
        with self._lock:
            if not self._recent:
                return 0.0
            sorted_vals = sorted(self._recent)
            idx = int(len(sorted_vals) * p)
            return sorted_vals[min(idx, len(sorted_vals) - 1)]

    @property
    def p95_ms(self) -> float:
        return self.percentile(0.95)

    @property
    def p99_ms(self) -> float:
        return self.percentile(0.99)

    @property
    def success_rate(self) -> float:
        return self.success_count / self.count if self.count > 0 else 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "count": self.count,
            "total_ms": round(self.total_ms, 3),
            "avg_ms": round(self.avg_ms, 3),
            "min_ms": round(self.min_ms, 3) if self.min_ms != float("inf") else 0,
            "max_ms": round(self.max_ms, 3),
            "median_ms": round(self.median_ms, 3),
            "p95_ms": round(self.p95_ms, 3),
            "p99_ms": round(self.p99_ms, 3),
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "success_rate": round(self.success_rate, 4),
        }

    def reset(self):
        with self._lock:
            self.count = 0
            self.total_ms = 0.0
            self.min_ms = float("inf")
            self.max_ms = 0.0
            self.success_count = 0
            self.failure_count = 0
            self._recent.clear()


# ================================================================
# 层级计时（调用树）
# ================================================================
class NestedTimer:
    """层级计时器，构建调用树"""

    def __init__(self, name: str, parent: Optional["NestedTimer"] = None):
        self.name = name
        self.parent = parent
        self.children: List[NestedTimer] = []
        self.start_time = 0.0
        self.duration_ms = 0.0
        self._lock = threading.Lock()

    def __enter__(self):
        self.start_time = time.perf_counter()
        return self

    def __exit__(self, *args):
        self.duration_ms = (time.perf_counter() - self.start_time) * 1000
        return False

    def child(self, name: str) -> "NestedTimer":
        child = NestedTimer(name, parent=self)
        with self._lock:
            self.children.append(child)
        return child

    def to_dict(self, depth: int = 0) -> Dict[str, Any]:
        return {
            "name": self.name,
            "duration_ms": round(self.duration_ms, 3),
            "depth": depth,
            "children": [c.to_dict(depth + 1) for c in self.children],
            "self_time_ms": round(self.duration_ms - sum(c.duration_ms for c in self.children), 3),
        }

    def print_tree(self, indent: int = 0):
        prefix = "  " * indent
        self_time = self.duration_ms - sum(c.duration_ms for c in self.children)
        print(f"{prefix}{self.name}: {self.duration_ms:.2f}ms (self: {self_time:.2f}ms)")
        for child in self.children:
            child.print_tree(indent + 1)


# ================================================================
# 计时器（上下文管理器 + 装饰器）
# ================================================================
class Timer:
    """通用计时器"""

    def __init__(self, name: str = "", tags: Optional[Dict[str, str]] = None,
                 threshold_ms: float = 0.0, auto_record: bool = True):
        self.name = name or "unnamed"
        self.tags = tags or {}
        self.threshold_ms = threshold_ms
        self.auto_record = auto_record
        self._record: Optional[TimingRecord] = None
        self._start_time = 0.0
        self._running = False

    def start(self):
        self._record = TimingRecord(self.name, self.tags)
        self._record.start()
        self._start_time = time.perf_counter()
        self._running = True

    def stop(self, success: bool = True) -> float:
        if not self._running or not self._record:
            return 0.0
        self._record.stop(success)
        self._running = False
        if self.auto_record:
            _timing_manager.record(self._record)
        if self.threshold_ms > 0 and self._record.duration > self.threshold_ms:
            terminal.warn(
                f"耗时超限 [{self.name}]: {self._record.duration:.2f}ms (阈值: {self.threshold_ms}ms)",
                "timing"
            )
        return self._record.duration

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.stop(success=exc_type is None)
        return False

    @property
    def elapsed_ms(self) -> float:
        if self._running:
            return (time.perf_counter() - self._start_time) * 1000
        return self._record.duration if self._record else 0.0


# ================================================================
# 计时管理器
# ================================================================
class TimingManager:
    """全局计时管理器"""

    def __init__(self):
        self._stats: Dict[str, TimingStats] = {}
        self._records: deque = deque(maxlen=5000)
        self._thresholds: Dict[str, float] = {}
        self._lock = threading.RLock()
        self._enabled = True
        self._persist_path = ""

    def enable(self):
        self._enabled = True

    def disable(self):
        self._enabled = False

    @property
    def is_enabled(self) -> bool:
        return self._enabled

    def record(self, record: TimingRecord):
        if not self._enabled:
            return
        with self._lock:
            if record.name not in self._stats:
                self._stats[record.name] = TimingStats(record.name)
            self._stats[record.name].record(record.duration, record.success)
            self._records.append(record)

    def timer(self, name: str = "", **kwargs) -> Timer:
        return Timer(name=name, **kwargs)

    def set_threshold(self, name: str, threshold_ms: float):
        with self._lock:
            self._thresholds[name] = threshold_ms

    def get_stats(self, name: str = "") -> Dict[str, Any]:
        with self._lock:
            if name:
                stat = self._stats.get(name)
                return stat.to_dict() if stat else {}
            return {name: stat.to_dict() for name, stat in self._stats.items()}

    def get_slow_operations(self, limit: int = 10) -> List[Dict[str, Any]]:
        with self._lock:
            sorted_stats = sorted(
                self._stats.values(),
                key=lambda s: s.avg_ms,
                reverse=True
            )
            return [s.to_dict() for s in sorted_stats[:limit]]

    def get_recent_records(self, name: str = "", limit: int = 50) -> List[Dict[str, Any]]:
        with self._lock:
            records = list(reversed(self._records))
        if name:
            records = [r for r in records if r.name == name]
        return [r.to_dict() for r in records[:limit]]

    def detect_regression(self, name: str, baseline_avg_ms: float,
                           threshold_percent: float = 20.0) -> Dict[str, Any]:
        """检测性能回归"""
        stat = self._stats.get(name)
        if not stat or stat.count < 10:
            return {"regression": False, "reason": "样本不足"}

        current_avg = stat.avg_ms
        if baseline_avg_ms <= 0:
            return {"regression": False, "reason": "基线无效"}

        increase_percent = ((current_avg - baseline_avg_ms) / baseline_avg_ms) * 100
        is_regression = increase_percent > threshold_percent

        return {
            "name": name,
            "regression": is_regression,
            "baseline_avg_ms": round(baseline_avg_ms, 3),
            "current_avg_ms": round(current_avg, 3),
            "increase_percent": round(increase_percent, 2),
            "threshold_percent": threshold_percent,
            "sample_count": stat.count,
        }

    def export_report(self, fmt: str = "json") -> str:
        """导出计时报告"""
        stats = self.get_stats()
        if fmt == "json":
            return json.dumps(stats, ensure_ascii=False, indent=2)
        if fmt == "csv":
            lines = ["name,count,avg_ms,min_ms,max_ms,p95_ms,p99_ms,success_rate"]
            for name, stat in stats.items():
                lines.append(
                    f"{name},{stat['count']},{stat['avg_ms']},{stat['min_ms']},"
                    f"{stat['max_ms']},{stat['p95_ms']},{stat['p99_ms']},{stat['success_rate']}"
                )
            return "\n".join(lines)
        return str(stats)

    def reset(self, name: str = ""):
        with self._lock:
            if name:
                if name in self._stats:
                    self._stats[name].reset()
            else:
                for stat in self._stats.values():
                    stat.reset()
                self._records.clear()

    def print_summary(self):
        """打印计时摘要到终端"""
        stats = self.get_slow_operations(limit=20)
        if not stats:
            terminal.info("暂无计时数据", "timing")
            return
        terminal.section("性能计时摘要（按平均耗时排序）")
        rows = []
        for s in stats:
            rows.append([
                s["name"][:40],
                f"{s['count']}",
                f"{s['avg_ms']:.2f}ms",
                f"{s['p95_ms']:.2f}ms",
                f"{s['p99_ms']:.2f}ms",
                f"{s['success_rate']*100:.1f}%",
            ])
        terminal.table(
            ["操作", "次数", "平均", "P95", "P99", "成功率"],
            rows,
        )


# ================================================================
# 全局实例与便捷函数
# ================================================================
_timing_manager = TimingManager()


def get_timing_manager() -> TimingManager:
    return _timing_manager


def timeit(name: str = "", tags: Optional[Dict[str, str]] = None, **kwargs):
    """计时装饰器"""
    def decorator(func: Callable) -> Callable:
        timer_name = name or func.__name__
        @functools.wraps(func)
        def wrapper(*args, **kw):
            with Timer(name=timer_name, tags=tags):
                return func(*args, **kw)
        return wrapper
    return decorator


def measure(name: str = "", **kwargs) -> Timer:
    """创建计时器（上下文管理器）"""
    return Timer(name=name, **kwargs)


def timing_stats(name: str = "") -> Dict[str, Any]:
    return _timing_manager.get_stats(name)


def print_timing_summary():
    _timing_manager.print_summary()


# ================================================================
# 管线计时器（用于模型生成流程的多阶段计时）
# ================================================================
class PipelineTimer:
    """管线计时器：支持多阶段计时，用于模型生成流程的性能追踪"""

    class Stage:
        """单个计时阶段"""
        def __init__(self, name: str, label: str = ""):
            self.name = name
            self.label = label or name
            self.start_time = time.perf_counter()
            self.end_time = 0.0
            self.elapsed_ms = 0.0
            self.status = "running"
            self.error = ""

        def end(self, status: str = "ok"):
            self.end_time = time.perf_counter()
            self.elapsed_ms = (self.end_time - self.start_time) * 1000
            self.status = status

        def to_dict(self) -> dict:
            return {
                "name": self.name,
                "label": self.label,
                "elapsed_ms": round(self.elapsed_ms, 2),
                "status": self.status,
                "error": self.error,
            }

    def __init__(self, name: str = "pipeline"):
        self.name = name
        self._stages: Dict[str, PipelineTimer.Stage] = {}
        self._stage_order: List[str] = []
        self._start_time = 0.0
        self._end_time = 0.0
        self._total_ms = 0.0
        self._running = False

    def start(self):
        """启动管线计时"""
        self._start_time = time.perf_counter()
        self._running = True
        self._stages.clear()
        self._stage_order.clear()

    def stage(self, name: str, label: str = ""):
        """开始一个新阶段"""
        if name in self._stages:
            self._stages[name].start_time = time.perf_counter()
            self._stages[name].status = "running"
        else:
            self._stages[name] = PipelineTimer.Stage(name, label)
            self._stage_order.append(name)

    def end_stage(self, name: str, status: str = "ok"):
        """结束一个阶段"""
        if name in self._stages:
            self._stages[name].end(status)

    def stop(self):
        """停止管线计时"""
        self._end_time = time.perf_counter()
        self._total_ms = (self._end_time - self._start_time) * 1000
        self._running = False
        # 结束所有未结束的阶段
        for name in self._stage_order:
            if self._stages[name].status == "running":
                self._stages[name].end("timeout")

    @property
    def total_ms(self) -> float:
        if self._running:
            return (time.perf_counter() - self._start_time) * 1000
        return self._total_ms

    def get_stage(self, name: str) -> Optional[Stage]:
        return self._stages.get(name)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "total_ms": round(self.total_ms, 2),
            "stages": [self._stages[n].to_dict() for n in self._stage_order],
            "stage_count": len(self._stage_order),
        }


