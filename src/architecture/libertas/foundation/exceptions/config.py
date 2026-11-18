"""异常定义。"""

from .base import LibertasError

class ConfigError(LibertasError):
    ERROR_CODE = "E1001"
    ERROR_NAME = "ConfigError"
    DEFAULT_MESSAGE = "配置错误"

class ConfigNotFoundError(ConfigError):
    ERROR_CODE = "E1002"
    ERROR_NAME = "ConfigNotFoundError"
    DEFAULT_MESSAGE = "配置项不存在"

    def __init__(self, key: str = "", **kwargs):
        super().__init__(message=f"配置项不存在: {key}", context={"key": key}, **kwargs)

class ConfigValidationError(ConfigError):
    ERROR_CODE = "E1003"
    ERROR_NAME = "ConfigValidationError"
    DEFAULT_MESSAGE = "配置校验失败"

class ConfigTypeError(ConfigValidationError):
    ERROR_CODE = "E1004"
    ERROR_NAME = "ConfigTypeError"
    DEFAULT_MESSAGE = "配置类型错误"
