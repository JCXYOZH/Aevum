"""
core/ratelimit.py - 令牌桶限流器

按模块/用户/操作维度限流，支持突发、配额、滑动窗口。
"""
import time
import threading
from typing import Any, Dict, Optional
from collections import defaultdict, deque
from libertas.foundation.exceptions import RateLimitExceededError
from libertas.foundation.terminal import terminal


# ================================================================
# 令牌桶
# ================================================================
class TokenBucket:
    """令牌桶限流器"""

    def __init__(self, rate: float, capacity: int):
        """
        rate: 每秒生成的令牌数
        capacity: 桶容量（最大突发量）
        """
        self.rate = max(0.01, rate)
        self.capacity = max(1, capacity)
        self._tokens = float(capacity)
        self._last_refill = time.time()
        self._lock = threading.Lock()

    def _refill(self):
        now = time.time()
        elapsed = now - self._last_refill
        if elapsed > 0:
            self._tokens = min(self.capacity, self._tokens + elapsed * self.rate)
            self._last_refill = now

    def acquire(self, tokens: int = 1, block: bool = False, timeout: float = 0.0) -> bool:
        """获取令牌"""
        with self._lock:
            self._refill()
            if self._tokens >= tokens:
                self._tokens -= tokens
                return True
            if not block:
                return False
            # 阻塞等待
            needed = tokens - self._tokens
            wait_time = needed / self.rate
            if timeout > 0 and wait_time > timeout:
                return False
        time.sleep(min(wait_time, timeout if timeout > 0 else wait_time))
        with self._lock:
            self._refill()
            if self._tokens >= tokens:
                self._tokens -= tokens
                return True
            return False

    def try_acquire(self, tokens: int = 1) -> bool:
        return self.acquire(tokens, block=False)

    @property
    def available_tokens(self) -> float:
        with self._lock:
            self._refill()
            return self._tokens

    def reset(self):
        with self._lock:
            self._tokens = float(self.capacity)
            self._last_refill = time.time()


# ================================================================
# 滑动窗口计数器
# ================================================================
class SlidingWindowCounter:
    """滑动窗口计数器"""

    def __init__(self, window_seconds: float, max_requests: int):
        self.window_seconds = window_seconds
        self.max_requests = max_requests
        self._requests: deque = deque()
        self._lock = threading.Lock()

    def _prune(self):
        cutoff = time.time() - self.window_seconds
        while self._requests and self._requests[0] < cutoff:
            self._requests.popleft()

    def acquire(self) -> bool:
        with self._lock:
            self._prune()
            if len(self._requests) < self.max_requests:
                self._requests.append(time.time())
                return True
            return False

    @property
    def count(self) -> int:
        with self._lock:
            self._prune()
            return len(self._requests)

    def reset(self):
        with self._lock:
            self._requests.clear()


# ================================================================
# 固定窗口计数器
# ================================================================
class FixedWindowCounter:
    """固定窗口计数器"""

    def __init__(self, window_seconds: float, max_requests: int):
        self.window_seconds = window_seconds
        self.max_requests = max_requests
        self._window_start = time.time()
        self._count = 0
        self._lock = threading.Lock()

    def _check_window(self):
        now = time.time()
        if now - self._window_start >= self.window_seconds:
            self._window_start = now
            self._count = 0

    def acquire(self) -> bool:
        with self._lock:
            self._check_window()
            if self._count < self.max_requests:
                self._count += 1
                return True
            return False

    @property
    def count(self) -> int:
        with self._lock:
            self._check_window()
            return self._count

    def reset(self):
        with self._lock:
            self._window_start = time.time()
            self._count = 0


# ================================================================
# 限流管理器
# ================================================================
class RateLimiter:
    """多维度限流管理器"""

    def __init__(self):
        self._buckets: Dict[str, TokenBucket] = {}
        self._sliding_windows: Dict[str, SlidingWindowCounter] = {}
        self._fixed_windows: Dict[str, FixedWindowCounter] = {}
        self._quotas: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()
        self._enabled = True

    def configure_bucket(self, key: str, rate: float, capacity: int):
        """配置令牌桶"""
        with self._lock:
            self._buckets[key] = TokenBucket(rate, capacity)

    def configure_sliding_window(self, key: str, window_seconds: float, max_requests: int):
        """配置滑动窗口"""
        with self._lock:
            self._sliding_windows[key] = SlidingWindowCounter(window_seconds, max_requests)

    def configure_fixed_window(self, key: str, window_seconds: float, max_requests: int):
        """配置固定窗口"""
        with self._lock:
            self._fixed_windows[key] = FixedWindowCounter(window_seconds, max_requests)

    def configure_quota(self, key: str, daily_limit: int, hourly_limit: int = 0,
                        minute_limit: int = 0):
        """配置配额"""
        with self._lock:
            self._quotas[key] = {
                "daily_limit": daily_limit,
                "hourly_limit": hourly_limit,
                "minute_limit": minute_limit,
                "daily_count": 0,
                "hourly_count": 0,
                "minute_count": 0,
                "day_start": time.time(),
                "hour_start": time.time(),
                "minute_start": time.time(),
            }

    def check(self, key: str, tokens: int = 1, raise_on_limit: bool = False) -> bool:
        """检查是否允许请求"""
        if not self._enabled:
            return True

        allowed = True

        # 令牌桶检查
        with self._lock:
            bucket = self._buckets.get(key)
        if bucket and not bucket.try_acquire(tokens):
            allowed = False

        # 滑动窗口检查
        with self._lock:
            sw = self._sliding_windows.get(key)
        if sw and not sw.acquire():
            allowed = False

        # 固定窗口检查
        with self._lock:
            fw = self._fixed_windows.get(key)
        if fw and not fw.acquire():
            allowed = False

        # 配额检查
        with self._lock:
            quota = self._quotas.get(key)
        if quota and not self._check_quota(quota):
            allowed = False

        if not allowed and raise_on_limit:
            raise RateLimitExceededError(
                message=f"请求频率超限: {key}",
                context={"key": key},
            )

        return allowed

    def _check_quota(self, quota: Dict[str, Any]) -> bool:
        now = time.time()
        # 重置过期窗口
        if now - quota["day_start"] >= 86400:
            quota["day_start"] = now
            quota["daily_count"] = 0
        if now - quota["hour_start"] >= 3600:
            quota["hour_start"] = now
            quota["hourly_count"] = 0
        if now - quota["minute_start"] >= 60:
            quota["minute_start"] = now
            quota["minute_count"] = 0

        # 检查限制
        if quota["daily_limit"] > 0 and quota["daily_count"] >= quota["daily_limit"]:
            return False
        if quota["hourly_limit"] > 0 and quota["hourly_count"] >= quota["hourly_limit"]:
            return False
        if quota["minute_limit"] > 0 and quota["minute_count"] >= quota["minute_limit"]:
            return False

        # 计数
        quota["daily_count"] += 1
        quota["hourly_count"] += 1
        quota["minute_count"] += 1
        return True

    def get_status(self, key: str) -> Dict[str, Any]:
        """获取限流状态"""
        with self._lock:
            status: Dict[str, Any] = {"key": key}
            bucket = self._buckets.get(key)
            if bucket:
                status["token_bucket"] = {
                    "rate": bucket.rate,
                    "capacity": bucket.capacity,
                    "available": bucket.available_tokens,
                }
            sw = self._sliding_windows.get(key)
            if sw:
                status["sliding_window"] = {
                    "window": sw.window_seconds,
                    "max": sw.max_requests,
                    "current": sw.count,
                }
            fw = self._fixed_windows.get(key)
            if fw:
                status["fixed_window"] = {
                    "window": fw.window_seconds,
                    "max": fw.max_requests,
                    "current": fw.count,
                }
            quota = self._quotas.get(key)
            if quota:
                status["quota"] = {
                    "daily_limit": quota["daily_limit"],
                    "daily_used": quota["daily_count"],
                    "hourly_limit": quota["hourly_limit"],
                    "hourly_used": quota["hourly_count"],
                }
            return status

    def reset(self, key: str = ""):
        with self._lock:
            if key:
                self._buckets.pop(key, None)
                self._sliding_windows.pop(key, None)
                self._fixed_windows.pop(key, None)
                self._quotas.pop(key, None)
            else:
                self._buckets.clear()
                self._sliding_windows.clear()
                self._fixed_windows.clear()
                self._quotas.clear()

    def enable(self):
        self._enabled = True

    def disable(self):
        self._enabled = False

    @property
    def is_enabled(self) -> bool:
        return self._enabled


# 全局限流器
_rate_limiter = RateLimiter()


def get_rate_limiter() -> RateLimiter:
    return _rate_limiter


def rate_limit(key: str, tokens: int = 1, raise_on_limit: bool = False) -> bool:
    return _rate_limiter.check(key, tokens, raise_on_limit)


def configure_rate_limit(key: str, rate: float = 10.0, capacity: int = 20):
    _rate_limiter.configure_bucket(key, rate, capacity)
