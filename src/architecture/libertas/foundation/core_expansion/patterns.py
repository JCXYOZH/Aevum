"""职责模块：patterns。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Tuple, Callable, TypeVar, Generic, Union
from enum import Enum
from collections import deque, Counter, defaultdict, OrderedDict
from libertas.foundation.terminal import terminal
import threading
import time

class SingletonMeta(type):
    """单例元类"""
    _instances: Dict[type, Any] = {}
    _lock = threading.RLock()

    def __call__(cls, *args, **kwargs):
        if cls not in cls._instances:
            with cls._lock:
                if cls not in cls._instances:
                    cls._instances[cls] = super().__call__(*args, **kwargs)
        return cls._instances[cls]

class Observer(ABC):
    """观察者基类"""

    @abstractmethod
    def update(self, event: str, data: Any):
        pass

class Observable:
    """被观察者基类"""

    def __init__(self):
        self._observers: List[Observer] = []
        self._lock = threading.RLock()

    def add_observer(self, observer: Observer):
        with self._lock:
            if observer not in self._observers:
                self._observers.append(observer)

    def remove_observer(self, observer: Observer) -> bool:
        with self._lock:
            if observer in self._observers:
                self._observers.remove(observer)
                return True
        return False

    def notify_observers(self, event: str, data: Any = None):
        with self._lock:
            observers = list(self._observers)
        for observer in observers:
            try:
                observer.update(event, data)
            except Exception as e:
                terminal.warn(f"观察者通知失败: {e}", "observable")

class EventEmitter:
    """事件发射器"""

    def __init__(self):
        self._listeners: Dict[str, List[Callable]] = defaultdict(list)
        self._once_listeners: Dict[str, List[Callable]] = defaultdict(list)
        self._lock = threading.RLock()

    def on(self, event: str, listener: Callable):
        with self._lock:
            self._listeners[event].append(listener)

    def once(self, event: str, listener: Callable):
        with self._lock:
            self._once_listeners[event].append(listener)

    def off(self, event: str, listener: Callable) -> bool:
        with self._lock:
            if listener in self._listeners[event]:
                self._listeners[event].remove(listener)
                return True
            if listener in self._once_listeners[event]:
                self._once_listeners[event].remove(listener)
                return True
        return False

    def emit(self, event: str, *args, **kwargs):
        with self._lock:
            listeners = list(self._listeners.get(event, []))
            once_listeners = list(self._once_listeners.get(event, []))
            self._once_listeners[event].clear()
        for listener in listeners + once_listeners:
            try:
                listener(*args, **kwargs)
            except Exception as e:
                terminal.warn(f"事件监听器执行失败: {e}", "event_emitter")

    def listener_count(self, event: str) -> int:
        return len(self._listeners.get(event, [])) + len(self._once_listeners.get(event, []))

    def remove_all_listeners(self, event: str = ""):
        with self._lock:
            if event:
                self._listeners.pop(event, None)
                self._once_listeners.pop(event, None)
            else:
                self._listeners.clear()
                self._once_listeners.clear()

class ObjectPool:
    """对象池"""

    def __init__(self, factory: Callable[[], Any], max_size: int = 10,
                 reset_fn: Optional[Callable[[Any], None]] = None):
        self.factory = factory
        self.max_size = max_size
        self.reset_fn = reset_fn
        self._pool: deque = deque(maxlen=max_size)
        self._created = 0
        self._lock = threading.RLock()

    def acquire(self) -> Any:
        with self._lock:
            if self._pool:
                return self._pool.popleft()
            self._created += 1
        return self.factory()

    def release(self, obj: Any):
        if self.reset_fn:
            try:
                self.reset_fn(obj)
            except Exception:
                pass
        with self._lock:
            if len(self._pool) < self.max_size:
                self._pool.append(obj)

    def size(self) -> int:
        return len(self._pool)

    def created(self) -> int:
        return self._created

    def clear(self):
        with self._lock:
            self._pool.clear()

class RetryPolicy:
    """重试策略"""

    def __init__(self, max_retries: int = 3, base_delay: float = 1.0,
                 max_delay: float = 30.0, backoff_factor: float = 2.0,
                 jitter: bool = True,
                 retry_on_exceptions: Tuple = (Exception,)):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.backoff_factor = backoff_factor
        self.jitter = jitter
        self.retry_on_exceptions = retry_on_exceptions
        self.total_retries = 0
        self.total_success = 0
        self.total_failures = 0

    def execute(self, func: Callable, *args, **kwargs) -> Any:
        last_exception = None
        for attempt in range(self.max_retries + 1):
            try:
                result = func(*args, **kwargs)
                self.total_success += 1
                return result
            except self.retry_on_exceptions as e:
                last_exception = e
                if attempt >= self.max_retries:
                    break
                delay = min(self.base_delay * (self.backoff_factor ** attempt), self.max_delay)
                if self.jitter:
                    delay *= 0.5 + 0.5 * (hash(str(time.time())) % 1000 / 1000.0)
                self.total_retries += 1
                time.sleep(delay)
        self.total_failures += 1
        raise last_exception

    def get_stats(self) -> Dict[str, Any]:
        return {
            "max_retries": self.max_retries,
            "total_retries": self.total_retries,
            "total_success": self.total_success,
            "total_failures": self.total_failures,
            "success_rate": round(
                self.total_success / max(self.total_success + self.total_failures, 1), 4
            ),
        }

class CircuitBreaker:
    """熔断器"""

    class State(Enum):
        CLOSED = "closed"
        OPEN = "open"
        HALF_OPEN = "half_open"

    def __init__(self, failure_threshold: int = 5, recovery_timeout: float = 30.0,
                 half_open_max_calls: int = 3):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls
        self.state = self.State.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_failure_time = 0.0
        self.half_open_calls = 0
        self._lock = threading.RLock()
        self.total_calls = 0
        self.total_rejected = 0

    def execute(self, func: Callable, *args, **kwargs) -> Any:
        with self._lock:
            self.total_calls += 1
            # 检查状态
            if self.state == self.State.OPEN:
                if time.time() - self.last_failure_time >= self.recovery_timeout:
                    self.state = self.State.HALF_OPEN
                    self.half_open_calls = 0
                else:
                    self.total_rejected += 1
                    raise Exception("熔断器已打开，请求被拒绝")
            if self.state == self.State.HALF_OPEN:
                if self.half_open_calls >= self.half_open_max_calls:
                    self.total_rejected += 1
                    raise Exception("半开状态下请求数已达上限")
                self.half_open_calls += 1

        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except Exception as e:
            self._on_failure()
            raise

    def _on_success(self):
        with self._lock:
            self.success_count += 1
            if self.state == self.State.HALF_OPEN:
                if self.success_count >= self.half_open_max_calls:
                    self.state = self.State.CLOSED
                    self.failure_count = 0
                    self.success_count = 0
            elif self.state == self.State.CLOSED:
                self.failure_count = max(0, self.failure_count - 1)

    def _on_failure(self):
        with self._lock:
            self.failure_count += 1
            self.last_failure_time = time.time()
            if self.state == self.State.HALF_OPEN:
                self.state = self.State.OPEN
            elif self.state == self.State.CLOSED:
                if self.failure_count >= self.failure_threshold:
                    self.state = self.State.OPEN

    def get_state(self) -> str:
        return self.state.value

    def get_stats(self) -> Dict[str, Any]:
        return {
            "state": self.state.value,
            "failure_count": self.failure_count,
            "success_count": self.success_count,
            "failure_threshold": self.failure_threshold,
            "recovery_timeout": self.recovery_timeout,
            "total_calls": self.total_calls,
            "total_rejected": self.total_rejected,
            "rejection_rate": round(
                self.total_rejected / max(self.total_calls, 1), 4
            ),
        }
