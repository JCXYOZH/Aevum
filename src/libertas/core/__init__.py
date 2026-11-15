"""Libertas 核心基础设施。

当前只迁入异常、终端输出、事件总线、缓存、限流、重试、指标、健康检查和计时。
"""

from .cache import CacheManager, LRUCache, TTLCache, cache_get, cache_set, cached, get_cache_manager
from .event_bus import Event, EventBus, EventTypes, get_event_bus, publish, subscribe
from .exceptions import (
    AuthError,
    ConfigError,
    DataError,
    LibertasError,
    LicenseError,
    NetworkError,
    RateLimitExceededError,
    SecurityError,
    ToolError,
)
from .health import (
    HealthCheckResult,
    HealthChecker,
    HealthStatus,
    check_health,
    get_health_checker,
    healthy_result,
    unhealthy_result,
)
from .metrics import (
    Counter,
    Gauge,
    Histogram,
    MetricsRegistry,
    get_registry,
    metrics_snapshot,
)
from .ratelimit import RateLimiter, TokenBucket, get_rate_limiter, rate_limit
from .retry import CircuitBreaker, RetryExecutor, RetryPolicy, retry, with_timeout
from .terminal import Color, LogLevel, Terminal, print_banner, terminal
from .timing import (
    PipelineTimer,
    TimingManager,
    TimingRecord,
    get_timing_manager,
    measure,
    timeit,
    timing_stats,
)

__all__ = [
    "LibertasError",
    "ConfigError",
    "AuthError",
    "LicenseError",
    "NetworkError",
    "DataError",
    "ToolError",
    "SecurityError",
    "RateLimitExceededError",
    "Color",
    "LogLevel",
    "Terminal",
    "terminal",
    "print_banner",
    "Event",
    "EventBus",
    "EventTypes",
    "get_event_bus",
    "publish",
    "subscribe",
    "LRUCache",
    "TTLCache",
    "CacheManager",
    "get_cache_manager",
    "cached",
    "cache_get",
    "cache_set",
    "RateLimiter",
    "TokenBucket",
    "get_rate_limiter",
    "rate_limit",
    "RetryPolicy",
    "RetryExecutor",
    "CircuitBreaker",
    "retry",
    "with_timeout",
    "Counter",
    "Gauge",
    "Histogram",
    "MetricsRegistry",
    "get_registry",
    "metrics_snapshot",
    "HealthStatus",
    "HealthCheckResult",
    "HealthChecker",
    "get_health_checker",
    "check_health",
    "healthy_result",
    "unhealthy_result",
    "TimingRecord",
    "TimingManager",
    "get_timing_manager",
    "timeit",
    "measure",
    "timing_stats",
    "PipelineTimer",
]
