"""异常定义。"""

from .base import LibertasError

class ModelError(LibertasError):
    ERROR_CODE = "E7001"
    ERROR_NAME = "ModelError"
    DEFAULT_MESSAGE = "模型错误"

class ModelUnavailableError(ModelError):
    ERROR_CODE = "E7002"
    ERROR_NAME = "ModelUnavailableError"
    DEFAULT_MESSAGE = "模型不可用"
    recoverable = True

class ModelTimeoutError(ModelError):
    ERROR_CODE = "E7003"
    ERROR_NAME = "ModelTimeoutError"
    DEFAULT_MESSAGE = "模型请求超时"
    recoverable = True

class ModelOutputError(ModelError):
    ERROR_CODE = "E7004"
    ERROR_NAME = "ModelOutputError"
    DEFAULT_MESSAGE = "模型输出格式错误"

class ModelRateLimitError(ModelError):
    ERROR_CODE = "E7005"
    ERROR_NAME = "ModelRateLimitError"
    DEFAULT_MESSAGE = "模型请求频率超限"
    recoverable = True

class PromptError(LibertasError):
    ERROR_CODE = "E7006"
    ERROR_NAME = "PromptError"
    DEFAULT_MESSAGE = "提示词错误"
