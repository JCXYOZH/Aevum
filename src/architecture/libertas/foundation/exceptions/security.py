"""异常定义。"""

from .base import LibertasError

class SecurityError(LibertasError):
    ERROR_CODE = "E8001"
    ERROR_NAME = "SecurityError"
    DEFAULT_MESSAGE = "安全错误"
    recoverable = False

class SecurityScanError(SecurityError):
    ERROR_CODE = "E8002"
    ERROR_NAME = "SecurityScanError"
    DEFAULT_MESSAGE = "安全扫描错误"

class WAFError(SecurityError):
    ERROR_CODE = "E8003"
    ERROR_NAME = "WAFError"
    DEFAULT_MESSAGE = "WAF 错误"

class IntrusionDetectedError(SecurityError):
    ERROR_CODE = "E8004"
    ERROR_NAME = "IntrusionDetectedError"
    DEFAULT_MESSAGE = "检测到入侵"
    recoverable = False

class RateLimitExceededError(LibertasError):
    ERROR_CODE = "E8005"
    ERROR_NAME = "RateLimitExceededError"
    DEFAULT_MESSAGE = "频率限制超限"
    recoverable = True
