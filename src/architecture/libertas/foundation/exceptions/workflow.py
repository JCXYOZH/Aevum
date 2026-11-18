"""异常定义。"""

from .base import LibertasError

class WorkflowError(LibertasError):
    ERROR_CODE = "E9001"
    ERROR_NAME = "WorkflowError"
    DEFAULT_MESSAGE = "工作流错误"

class WorkflowDefinitionError(WorkflowError):
    ERROR_CODE = "E9002"
    ERROR_NAME = "WorkflowDefinitionError"
    DEFAULT_MESSAGE = "工作流定义错误"

class TaskError(LibertasError):
    ERROR_CODE = "E9003"
    ERROR_NAME = "TaskError"
    DEFAULT_MESSAGE = "任务错误"

class TaskCancelledError(TaskError):
    ERROR_CODE = "E9004"
    ERROR_NAME = "TaskCancelledError"
    DEFAULT_MESSAGE = "任务已取消"

class TaskTimeoutError(TaskError):
    ERROR_CODE = "E9005"
    ERROR_NAME = "TaskTimeoutError"
    DEFAULT_MESSAGE = "任务超时"

class OrchestrationError(LibertasError):
    ERROR_CODE = "E9006"
    ERROR_NAME = "OrchestrationError"
    DEFAULT_MESSAGE = "编排错误"
