"""
core/retry.py - 重试与熔断器

提供指数退避重试装饰器、熔断器（CircuitBreaker）、超时控制。
所有外部调用（网络、模型、工具）都应经过此模块。
"""
import time
import random
import threading
import functools
from typing import Any, Callable, Dict, List, Optional, Tuple, Type
from datetime import datetime, timedelta
from libertas.foundation.exceptions import LibertasError


# ================================================================
# 重试策略
# ================================================================
class RetryPolicy:
    """重试策略配置"""

    def __init__(self, max_attempts: int = 3, base_delay: float = 1.0,
                 max_delay: float = 60.0, backoff_factor: float = 2.0,
                 jitter: bool = True, retry_on: Optional[Tuple[Type[Exception], ...]] = None,
                 stop_on: Optional[Tuple[Type[Exception], ...]] = None):
        self.max_attempts = max(1, max_attempts)
        self.base_delay = max(0.01, base_delay)
        self.max_delay = max(base_delay, max_delay)
        self.backoff_factor = max(1.0, backoff_factor)
        self.jitter = jitter
        self.retry_on = retry_on or (Exception,)
        self.stop_on = stop_on or ()

    def should_retry(self, attempt: int, exc: Exception) -> bool:
        """判断是否应该重试"""
        if attempt >= self.max_attempts:
            return False
        if isinstance(exc, self.stop_on):
            return False
        return isinstance(exc, self.retry_on)

    def next_delay(self, attempt: int) -> float:
        """计算下一次重试的延迟（指数退避 + 抖动）"""
        delay = min(self.base_delay * (self.backoff_factor ** attempt), self.max_delay)
        if self.jitter:
            delay = delay * (0.5 + random.random() * 0.5)
        return delay


# ================================================================
# 重试结果
# ================================================================
class RetryResult:
    """重试执行结果"""

    def __init__(self, success: bool, result: Any = None, error: Optional[Exception] = None,
                 attempts: int = 0, total_time: float = 0.0,
                 errors: Optional[List[Exception]] = None):
        self.success = success
        self.result = result
        self.error = error
        self.attempts = attempts
        self.total_time = total_time
        self.errors = errors or []

    @property
    def retried(self) -> bool:
        return self.attempts > 1

    def get_or_raise(self) -> Any:
        if self.success:
            return self.result
        raise self.error or LibertasError("重试失败")


# ================================================================
# 重试执行器
# ================================================================
class RetryExecutor:
    """重试执行器"""

    def __init__(self, policy: Optional[RetryPolicy] = None):
        self.policy = policy or RetryPolicy()
        self._stats: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def execute(self, func: Callable, *args, _name: str = "", _on_retry: Optional[Callable] = None,
                **kwargs) -> RetryResult:
        """执行函数，带重试"""
        name = _name or getattr(func, "__name__", "unknown")
        start = time.time()
        errors: List[Exception] = []

        for attempt in range(1, self.policy.max_attempts + 1):
            try:
                result = func(*args, **kwargs)
                elapsed = time.time() - start
                self._record_stats(name, success=True, attempts=attempt, time=elapsed)
                return RetryResult(
                    success=True, result=result, attempts=attempt,
                    total_time=elapsed, errors=errors,
                )
            except Exception as e:
                errors.append(e)
                elapsed = time.time() - start

                if not self.policy.should_retry(attempt, e):
                    self._record_stats(name, success=False, attempts=attempt, time=elapsed)
                    return RetryResult(
                        success=False, error=e, attempts=attempt,
                        total_time=elapsed, errors=errors,
                    )

                delay = self.policy.next_delay(attempt)
                if _on_retry:
                    try:
                        _on_retry(attempt, e, delay)
                    except Exception:
                        pass
                time.sleep(delay)

        elapsed = time.time() - start
        self._record_stats(name, success=False, attempts=self.policy.max_attempts, time=elapsed)
        return RetryResult(
            success=False, error=errors[-1] if errors else None,
            attempts=self.policy.max_attempts, total_time=elapsed, errors=errors,
        )

    def _record_stats(self, name: str, success: bool, attempts: int, time: float):
        with self._lock:
            if name not in self._stats:
                self._stats[name] = {"total": 0, "success": 0, "failed": 0,
                                      "total_attempts": 0, "total_time": 0.0}
            s = self._stats[name]
            s["total"] += 1
            s["success" if success else "failed"] += 1
            s["total_attempts"] += attempts
            s["total_time"] += time

    def get_stats(self, name: Optional[str] = None) -> Dict[str, Any]:
        with self._lock:
            if name:
                return dict(self._stats.get(name, {}))
            return {k: dict(v) for k, v in self._stats.items()}

    def reset_stats(self):
        with self._lock:
            self._stats.clear()


# ================================================================
# 重试装饰器
# ================================================================
def retry(max_attempts: int = 3, base_delay: float = 1.0, max_delay: float = 60.0,
          backoff_factor: float = 2.0, jitter: bool = True,
          retry_on: Optional[Tuple[Type[Exception], ...]] = None,
          stop_on: Optional[Tuple[Type[Exception], ...]] = None,
          on_retry: Optional[Callable] = None):
    """重试装饰器"""
    policy = RetryPolicy(
        max_attempts=max_attempts, base_delay=base_delay, max_delay=max_delay,
        backoff_factor=backoff_factor, jitter=jitter, retry_on=retry_on, stop_on=stop_on,
    )
    executor = RetryExecutor(policy)

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            result = executor.execute(func, *args, _name=func.__name__, _on_retry=on_retry, **kwargs)
            return result.get_or_raise()
        wrapper._retry_executor = executor
        return wrapper
    return decorator


# ================================================================
# 熔断器状态
# ================================================================
class CircuitState:
    CLOSED = "closed"           # 正常：请求通过，失败计数
    OPEN = "open"               # 熔断：请求直接失败
    HALF_OPEN = "half_open"     # 半开：允许少量请求探测


# ================================================================
# 熔断器
# ================================================================
class CircuitBreaker:
    """熔断器（Circuit Breaker）模式"""

    def __init__(self, name: str = "default", failure_threshold: int = 5,
                 recovery_timeout: float = 30.0, half_open_max_calls: int = 3,
                 failure_window: float = 60.0,
                 fallback: Optional[Callable] = None):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls
        self.failure_window = failure_window
        self.fallback = fallback

        self._state = CircuitState.CLOSED
        self._failures: List[float] = []
        self._last_failure_time: Optional[float] = None
        self._half_open_calls = 0
        self._half_open_successes = 0
        self._lock = threading.Lock()
        self._state_change_callbacks: List[Callable] = []

    @property
    def state(self) -> str:
        return self._state

    def on_state_change(self, callback: Callable):
        """注册状态变更回调"""
        self._state_change_callbacks.append(callback)

    def _change_state(self, new_state: str):
        old = self._state
        if old != new_state:
            self._state = new_state
            for cb in self._state_change_callbacks:
                try:
                    cb(self.name, old, new_state)
                except Exception:
                    pass

    def _prune_failures(self):
        """清理过期失败记录"""
        now = time.time()
        cutoff = now - self.failure_window
        self._failures = [t for t in self._failures if t > cutoff]

    def allow_request(self) -> bool:
        """判断是否允许请求通过"""
        with self._lock:
            now = time.time()

            if self._state == CircuitState.CLOSED:
                return True

            if self._state == CircuitState.OPEN:
                if self._last_failure_time and (now - self._last_failure_time) >= self.recovery_timeout:
                    self._change_state(CircuitState.HALF_OPEN)
                    self._half_open_calls = 0
                    self._half_open_successes = 0
                    return True
                return False

            if self._state == CircuitState.HALF_OPEN:
                return self._half_open_calls < self.half_open_max_calls

            return False

    def record_success(self):
        """记录成功"""
        with self._lock:
            if self._state == CircuitState.HALF_OPEN:
                self._half_open_successes += 1
                if self._half_open_successes >= self.half_open_max_calls:
                    self._failures.clear()
                    self._change_state(CircuitState.CLOSED)
            elif self._state == CircuitState.CLOSED:
                pass  # 正常状态，无需处理

    def record_failure(self):
        """记录失败"""
        with self._lock:
            now = time.time()
            self._last_failure_time = now
            self._failures.append(now)
            self._prune_failures()

            if self._state == CircuitState.HALF_OPEN:
                self._change_state(CircuitState.OPEN)
            elif self._state == CircuitState.CLOSED:
                if len(self._failures) >= self.failure_threshold:
                    self._change_state(CircuitState.OPEN)

    def reset(self):
        """重置熔断器"""
        with self._lock:
            self._state = CircuitState.CLOSED
            self._failures.clear()
            self._last_failure_time = None
            self._half_open_calls = 0
            self._half_open_successes = 0

    def execute(self, func: Callable, *args, **kwargs) -> Any:
        """执行函数，受熔断器保护"""
        if not self.allow_request():
            if self.fallback:
                return self.fallback(*args, **kwargs)
            raise LibertasError(
                message=f"熔断器 '{self.name}' 处于 OPEN 状态，请求被拒绝",
                code="E3004",
                recoverable=True,
                context={"breaker": self.name, "state": self._state},
            )

        try:
            if self._state == CircuitState.HALF_OPEN:
                with self._lock:
                    self._half_open_calls += 1
            result = func(*args, **kwargs)
            self.record_success()
            return result
        except Exception as e:
            self.record_failure()
            raise

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            self._prune_failures()
            return {
                "name": self.name,
                "state": self._state,
                "recent_failures": len(self._failures),
                "failure_threshold": self.failure_threshold,
                "last_failure": self._last_failure_time,
                "recovery_timeout": self.recovery_timeout,
            }


# ================================================================
# 熔断器装饰器
# ================================================================
def with_circuit_breaker(name: str = "", failure_threshold: int = 5,
                          recovery_timeout: float = 30.0,
                          fallback: Optional[Callable] = None):
    """熔断器装饰器"""
    breakers: Dict[str, CircuitBreaker] = {}

    def decorator(func: Callable) -> Callable:
        breaker_name = name or func.__name__
        if breaker_name not in breakers:
            breakers[breaker_name] = CircuitBreaker(
                name=breaker_name, failure_threshold=failure_threshold,
                recovery_timeout=recovery_timeout, fallback=fallback,
            )
        breaker = breakers[breaker_name]

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            return breaker.execute(func, *args, **kwargs)
        wrapper._circuit_breaker = breaker
        return wrapper
    return decorator


# ================================================================
# 超时控制
# ================================================================
class Timeout:
    """超时上下文管理器"""

    def __init__(self, seconds: float, callback: Optional[Callable] = None):
        self.seconds = seconds
        self.callback = callback
        self._timer: Optional[threading.Timer] = None
        self._timed_out = False

    def __enter__(self):
        self._timer = threading.Timer(self.seconds, self._on_timeout)
        self._timer.daemon = True
        self._timer.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._timer:
            self._timer.cancel()
        return False

    def _on_timeout(self):
        self._timed_out = True
        if self.callback:
            try:
                self.callback()
            except Exception:
                pass

    @property
    def timed_out(self) -> bool:
        return self._timed_out


def with_timeout(seconds: float):
    """超时装饰器（基于线程，不能强制终止线程，仅标记超时）"""
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            result_holder: Dict[str, Any] = {}
            error_holder: Dict[str, Exception] = {}

            def target():
                try:
                    result_holder["result"] = func(*args, **kwargs)
                except Exception as e:
                    error_holder["error"] = e

            thread = threading.Thread(target=target, daemon=True)
            thread.start()
            thread.join(timeout=seconds)

            if thread.is_alive():
                raise LibertasError(
                    message=f"函数 {func.__name__} 执行超时 ({seconds}s)",
                    code="E9005",
                    recoverable=True,
                )
            if "error" in error_holder:
                raise error_holder["error"]
            return result_holder.get("result")
        return wrapper
    return decorator


# ================================================================
# 全局重试器与熔断器注册表
# ================================================================
_global_executor = RetryExecutor()
_breakers: Dict[str, CircuitBreaker] = {}
_breakers_lock = threading.Lock()


def get_global_executor() -> RetryExecutor:
    return _global_executor


def get_breaker(name: str, **kwargs) -> CircuitBreaker:
    """获取或创建命名熔断器"""
    with _breakers_lock:
        if name not in _breakers:
            _breakers[name] = CircuitBreaker(name=name, **kwargs)
        return _breakers[name]


def list_breakers() -> List[Dict[str, Any]]:
    with _breakers_lock:
        return [b.get_stats() for b in _breakers.values()]


def reset_all_breakers():
    with _breakers_lock:
        for b in _breakers.values():
            b.reset()
