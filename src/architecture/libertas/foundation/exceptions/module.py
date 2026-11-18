"""异常定义。"""

from .base import LibertasError

class ModuleError(LibertasError):
    ERROR_CODE = "E3001"
    ERROR_NAME = "ModuleError"
    DEFAULT_MESSAGE = "模块错误"

class ModuleNotFoundError(ModuleError):
    ERROR_CODE = "E3002"
    ERROR_NAME = "ModuleNotFoundError"
    DEFAULT_MESSAGE = "模块不存在"

class ModuleInitError(ModuleError):
    ERROR_CODE = "E3003"
    ERROR_NAME = "ModuleInitError"
    DEFAULT_MESSAGE = "模块初始化失败"

class ModuleUnavailableError(ModuleError):
    ERROR_CODE = "E3004"
    ERROR_NAME = "ModuleUnavailableError"
    DEFAULT_MESSAGE = "模块不可用"

class DependencyError(LibertasError):
    ERROR_CODE = "E3005"
    ERROR_NAME = "DependencyError"
    DEFAULT_MESSAGE = "依赖错误"

class DependencyNotFoundError(DependencyError):
    ERROR_CODE = "E3006"
    ERROR_NAME = "DependencyNotFoundError"
    DEFAULT_MESSAGE = "依赖未找到"

    def __init__(self, dependency: str = "", **kwargs):
        super().__init__(message=f"依赖未找到: {dependency}", context={"dependency": dependency}, **kwargs)

class DependencyVersionError(DependencyError):
    ERROR_CODE = "E3007"
    ERROR_NAME = "DependencyVersionError"
    DEFAULT_MESSAGE = "依赖版本不兼容"
