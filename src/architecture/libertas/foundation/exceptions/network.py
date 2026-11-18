"""异常定义。"""

from .base import LibertasError

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
