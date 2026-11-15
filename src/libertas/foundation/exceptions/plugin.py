"""异常定义。"""

from .base import LibertasError

class PluginError(LibertasError):
    ERROR_CODE = "EA001"
    ERROR_NAME = "PluginError"
    DEFAULT_MESSAGE = "插件错误"

class PluginNotFoundError(PluginError):
    ERROR_CODE = "EA002"
    ERROR_NAME = "PluginNotFoundError"
    DEFAULT_MESSAGE = "插件不存在"

class PluginLoadError(PluginError):
    ERROR_CODE = "EA003"
    ERROR_NAME = "PluginLoadError"
    DEFAULT_MESSAGE = "插件加载失败"

class PluginDependencyError(PluginError):
    ERROR_CODE = "EA004"
    ERROR_NAME = "PluginDependencyError"
    DEFAULT_MESSAGE = "插件依赖错误"

class PluginSecurityError(PluginError):
    ERROR_CODE = "EA005"
    ERROR_NAME = "PluginSecurityError"
    DEFAULT_MESSAGE = "插件安全错误"
    recoverable = False
