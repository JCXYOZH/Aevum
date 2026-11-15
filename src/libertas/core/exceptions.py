"""
core/exceptions.py - 自定义异常层次体系

所有模块的异常都继承自 LibertasError，带错误码、可恢复标记、上下文信息。
"""
from typing import Any, Dict, Optional


class LibertasError(Exception):
    """花先生系统基础异常"""

    ERROR_CODE = "E0000"
    ERROR_NAME = "LibertasError"
    DEFAULT_MESSAGE = "系统内部错误"

    def __init__(self, message: str = "", code: str = "", recoverable: bool = True,
                 context: Optional[Dict[str, Any]] = None, cause: Optional[Exception] = None):
        self.message = message or self.DEFAULT_MESSAGE
        self.code = code or self.ERROR_CODE
        self.recoverable = recoverable
        self.context = context or {}
        self.cause = cause
        super().__init__(self.message)

    def __str__(self) -> str:
        parts = [f"[{self.code}] {self.message}"]
        if self.context:
            ctx_str = ", ".join(f"{k}={v}" for k, v in self.context.items())
            parts.append(f"({ctx_str})")
        if self.cause:
            parts.append(f"caused by: {self.cause}")
        return " ".join(parts)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "name": self.ERROR_NAME,
            "message": self.message,
            "recoverable": self.recoverable,
            "context": self.context,
        }


# ================================================================
# 配置相关异常
# ================================================================
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


# ================================================================
# 认证与授权异常
# ================================================================
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


# ================================================================
# 模块与系统异常
# ================================================================
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


# ================================================================
# 网络与通信异常
# ================================================================
class NetworkError(LibertasError):
    ERROR_CODE = "E4001"
    ERROR_NAME = "NetworkError"
    DEFAULT_MESSAGE = "网络错误"
    recoverable = True


class NetworkConnectionError(NetworkError):
    ERROR_CODE = "E4002"
    ERROR_NAME = "NetworkConnectionError"
    DEFAULT_MESSAGE = "连接失败"


class NetworkTimeoutError(NetworkError):
    ERROR_CODE = "E4003"
    ERROR_NAME = "NetworkTimeoutError"
    DEFAULT_MESSAGE = "请求超时"


class SSLError(NetworkError):
    ERROR_CODE = "E4004"
    ERROR_NAME = "SSLError"
    DEFAULT_MESSAGE = "SSL 错误"


class NodeError(LibertasError):
    ERROR_CODE = "E4005"
    ERROR_NAME = "NodeError"
    DEFAULT_MESSAGE = "节点错误"


class NodeOfflineError(NodeError):
    ERROR_CODE = "E4006"
    ERROR_NAME = "NodeOfflineError"
    DEFAULT_MESSAGE = "节点离线"


class SyncError(LibertasError):
    ERROR_CODE = "E4007"
    ERROR_NAME = "SyncError"
    DEFAULT_MESSAGE = "同步错误"


class SyncConflictError(SyncError):
    ERROR_CODE = "E4008"
    ERROR_NAME = "SyncConflictError"
    DEFAULT_MESSAGE = "同步冲突"
    recoverable = True


# ================================================================
# 数据与存储异常
# ================================================================
class DataError(LibertasError):
    ERROR_CODE = "E5001"
    ERROR_NAME = "DataError"
    DEFAULT_MESSAGE = "数据错误"


class DataNotFoundError(DataError):
    ERROR_CODE = "E5002"
    ERROR_NAME = "DataNotFoundError"
    DEFAULT_MESSAGE = "数据不存在"


class DataCorruptionError(DataError):
    ERROR_CODE = "E5003"
    ERROR_NAME = "DataCorruptionError"
    DEFAULT_MESSAGE = "数据损坏"
    recoverable = False


class DataValidationError(DataError):
    ERROR_CODE = "E5004"
    ERROR_NAME = "DataValidationError"
    DEFAULT_MESSAGE = "数据校验失败"


class StorageError(LibertasError):
    ERROR_CODE = "E5005"
    ERROR_NAME = "StorageError"
    DEFAULT_MESSAGE = "存储错误"


class StorageFullError(StorageError):
    ERROR_CODE = "E5006"
    ERROR_NAME = "StorageFullError"
    DEFAULT_MESSAGE = "存储空间不足"


class EncryptionError(LibertasError):
    ERROR_CODE = "E5007"
    ERROR_NAME = "EncryptionError"
    DEFAULT_MESSAGE = "加密错误"


class DecryptionError(EncryptionError):
    ERROR_CODE = "E5008"
    ERROR_NAME = "DecryptionError"
    DEFAULT_MESSAGE = "解密错误"


# ================================================================
# 工具与执行异常
# ================================================================
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


# ================================================================
# 模型与AI异常
# ================================================================
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


# ================================================================
# 安全异常
# ================================================================
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


# ================================================================
# 工作流与任务异常
# ================================================================
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


# ================================================================
# 插件异常
# ================================================================
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


# ================================================================
# 异常工具函数
# ================================================================
def is_recoverable(exc: Exception) -> bool:
    """判断异常是否可恢复"""
    if isinstance(exc, LibertasError):
        return exc.recoverable
    return True


def get_error_code(exc: Exception) -> str:
    """获取异常错误码"""
    if isinstance(exc, LibertasError):
        return exc.code
    return "E9999"


def wrap_exception(exc: Exception, message: str = "", context: Optional[Dict[str, Any]] = None) -> LibertasError:
    """将普通异常包装为 LibertasError"""
    if isinstance(exc, LibertasError):
        if message:
            exc.message = message
        if context:
            exc.context.update(context)
        return exc
    return LibertasError(
        message=message or str(exc),
        code="E9999",
        recoverable=True,
        context=context or {},
        cause=exc,
    )


def exception_to_dict(exc: Exception) -> Dict[str, Any]:
    """将异常转为字典"""
    if isinstance(exc, LibertasError):
        return exc.to_dict()
    return {
        "code": "E9999",
        "name": type(exc).__name__,
        "message": str(exc),
        "recoverable": True,
        "context": {},
    }
