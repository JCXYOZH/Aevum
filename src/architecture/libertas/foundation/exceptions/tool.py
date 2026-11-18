"""异常定义。"""

from .base import LibertasError

class ToolError(LibertasError):
    ERROR_CODE = "E6001"
    ERROR_NAME = "ToolError"
    DEFAULT_MESSAGE = "工具错误"

class ToolNotFoundError(ToolError):
    ERROR_CODE = "E6002"
    ERROR_NAME = "ToolNotFoundError"
    DEFAULT_MESSAGE = "工具不存在"

class ToolExecutionError(ToolError):
    ERROR_CODE = "E6003"
    ERROR_NAME = "ToolExecutionError"
    DEFAULT_MESSAGE = "工具执行失败"

    def __init__(self, tool: str = "", exit_code: int = -1, stderr: str = "", **kwargs):
        msg = f"工具执行失败: {tool} (exit={exit_code})" if tool else self.DEFAULT_MESSAGE
        super().__init__(message=msg, context={"tool": tool, "exit_code": exit_code, "stderr": stderr}, **kwargs)

class ToolTimeoutError(ToolError):
    ERROR_CODE = "E6004"
    ERROR_NAME = "ToolTimeoutError"
    DEFAULT_MESSAGE = "工具执行超时"

class ToolPermissionError(ToolError):
    ERROR_CODE = "E6005"
    ERROR_NAME = "ToolPermissionError"
    DEFAULT_MESSAGE = "工具权限不足"
    recoverable = False

class SandboxError(LibertasError):
    ERROR_CODE = "E6006"
    ERROR_NAME = "SandboxError"
    DEFAULT_MESSAGE = "沙箱错误"

class SandboxViolationError(SandboxError):
    ERROR_CODE = "E6007"
    ERROR_NAME = "SandboxViolationError"
    DEFAULT_MESSAGE = "沙箱违规"
    recoverable = False
