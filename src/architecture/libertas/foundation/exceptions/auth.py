"""异常定义。"""

from .base import LibertasError

class AuthError(LibertasError):
    ERROR_CODE = "E2001"
    ERROR_NAME = "AuthError"
    DEFAULT_MESSAGE = "认证错误"
    recoverable = False

class AuthenticationError(AuthError):
    ERROR_CODE = "E2002"
    ERROR_NAME = "AuthenticationError"
    DEFAULT_MESSAGE = "认证失败"

class PermissionDeniedError(AuthError):
    ERROR_CODE = "E2003"
    ERROR_NAME = "PermissionDeniedError"
    DEFAULT_MESSAGE = "权限不足"

    def __init__(self, resource: str = "", action: str = "", **kwargs):
        msg = f"权限不足: 无法对 {resource} 执行 {action}" if resource and action else self.DEFAULT_MESSAGE
        super().__init__(message=msg, context={"resource": resource, "action": action}, **kwargs)

class TokenExpiredError(AuthError):
    ERROR_CODE = "E2004"
    ERROR_NAME = "TokenExpiredError"
    DEFAULT_MESSAGE = "令牌已过期"
    recoverable = True

class AccountLockedError(AuthError):
    ERROR_CODE = "E2005"
    ERROR_NAME = "AccountLockedError"
    DEFAULT_MESSAGE = "账户已锁定"
    recoverable = False

class LicenseError(LibertasError):
    ERROR_CODE = "E2006"
    ERROR_NAME = "LicenseError"
    DEFAULT_MESSAGE = "许可证错误"
    recoverable = False

class LicenseExpiredError(LicenseError):
    ERROR_CODE = "E2007"
    ERROR_NAME = "LicenseExpiredError"
    DEFAULT_MESSAGE = "许可证已过期"

class LicenseInvalidError(LicenseError):
    ERROR_CODE = "E2008"
    ERROR_NAME = "LicenseInvalidError"
    DEFAULT_MESSAGE = "许可证无效"
