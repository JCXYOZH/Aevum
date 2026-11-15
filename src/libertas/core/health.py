"""
core/health.py - 统一健康检查框架

每个模块注册 health_check()，汇总为系统健康报告。
"""
import time
import threading
from typing import Any, Callable, Dict, List, Optional
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class HealthStatus(Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


@dataclass
class HealthCheckResult:
    """健康检查结果"""
    name: str
    status: HealthStatus
    message: str = ""
    details: Dict[str, Any] = field(default_factory=dict)
    duration_ms: float = 0.0
    checked_at: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "status": self.status.value,
            "message": self.message,
            "details": self.details,
            "duration_ms": round(self.duration_ms, 2),
            "checked_at": datetime.fromtimestamp(self.checked_at).strftime("%Y-%m-%d %H:%M:%S"),
        }


@dataclass
class HealthCheckRegistration:
    """健康检查注册信息"""
    name: str
    check_func: Callable[[], HealthCheckResult]
    enabled: bool = True
    timeout: float = 10.0
    last_result: Optional[HealthCheckResult] = None
    last_checked: float = 0.0
    failure_count: int = 0
    success_count: int = 0


class HealthChecker:
    """统一健康检查器"""

    def __init__(self):
        self._checks: Dict[str, HealthCheckRegistration] = {}
        self._lock = threading.RLock()
        self._auto_check_interval = 60.0
        self._last_auto_check = 0.0
        self._system_start_time = time.time()

    def register(self, name: str, check_func: Callable[[], HealthCheckResult],
                 timeout: float = 10.0) -> str:
        """注册健康检查"""
        reg = HealthCheckRegistration(name=name, check_func=check_func, timeout=timeout)
        with self._lock:
            self._checks[name] = reg
        return name

    def unregister(self, name: str):
        with self._lock:
            self._checks.pop(name, None)

    def check_one(self, name: str) -> Optional[HealthCheckResult]:
        """执行单个健康检查"""
        with self._lock:
            reg = self._checks.get(name)
        if not reg or not reg.enabled:
            return None

        start = time.time()
        try:
            result = reg.check_func()
            result.duration_ms = (time.time() - start) * 1000
            reg.success_count += 1
            reg.failure_count = 0
        except Exception as e:
            result = HealthCheckResult(
                name=name, status=HealthStatus.UNHEALTHY,
                message=f"检查异常: {e}", duration_ms=(time.time() - start) * 1000,
            )
            reg.failure_count += 1

        reg.last_result = result
        reg.last_checked = time.time()
        return result

    def check_all(self) -> List[HealthCheckResult]:
        """执行所有健康检查"""
        results = []
        with self._lock:
            names = list(self._checks.keys())
        for name in names:
            result = self.check_one(name)
            if result:
                results.append(result)
        return results

    def get_system_health(self) -> Dict[str, Any]:
        """获取系统整体健康状态"""
        results = self.check_all()
        statuses = [r.status for r in results]

        if HealthStatus.UNHEALTHY in statuses:
            overall = HealthStatus.UNHEALTHY
        elif HealthStatus.DEGRADED in statuses:
            overall = HealthStatus.DEGRADED
        elif all(s == HealthStatus.HEALTHY for s in statuses):
            overall = HealthStatus.HEALTHY
        else:
            overall = HealthStatus.UNKNOWN

        return {
            "overall_status": overall.value,
            "total_checks": len(results),
            "healthy": sum(1 for r in results if r.status == HealthStatus.HEALTHY),
            "degraded": sum(1 for r in results if r.status == HealthStatus.DEGRADED),
            "unhealthy": sum(1 for r in results if r.status == HealthStatus.UNHEALTHY),
            "unknown": sum(1 for r in results if r.status == HealthStatus.UNKNOWN),
            "uptime_seconds": time.time() - self._system_start_time,
            "checked_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "checks": [r.to_dict() for r in results],
        }

    def get_check_stats(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [{
                "name": reg.name,
                "enabled": reg.enabled,
                "timeout": reg.timeout,
                "last_status": reg.last_result.status.value if reg.last_result else "unknown",
                "last_checked": reg.last_checked,
                "success_count": reg.success_count,
                "failure_count": reg.failure_count,
            } for reg in self._checks.values()]

    def enable(self, name: str):
        with self._lock:
            if name in self._checks:
                self._checks[name].enabled = True

    def disable(self, name: str):
        with self._lock:
            if name in self._checks:
                self._checks[name].enabled = False

    def list_checks(self) -> List[str]:
        with self._lock:
            return list(self._checks.keys())


# 全局健康检查器
_health_checker = HealthChecker()


def get_health_checker() -> HealthChecker:
    return _health_checker


def register_health_check(name: str, check_func: Callable[[], HealthCheckResult], **kwargs):
    return _health_checker.register(name, check_func, **kwargs)


def check_health() -> Dict[str, Any]:
    return _health_checker.get_system_health()


def healthy_result(name: str, message: str = "正常", details: Optional[Dict[str, Any]] = None) -> HealthCheckResult:
    return HealthCheckResult(name=name, status=HealthStatus.HEALTHY, message=message, details=details or {})


def degraded_result(name: str, message: str = "", details: Optional[Dict[str, Any]] = None) -> HealthCheckResult:
    return HealthCheckResult(name=name, status=HealthStatus.DEGRADED, message=message, details=details or {})


def unhealthy_result(name: str, message: str = "", details: Optional[Dict[str, Any]] = None) -> HealthCheckResult:
    return HealthCheckResult(name=name, status=HealthStatus.UNHEALTHY, message=message, details=details or {})
