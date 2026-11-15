"""异常定义。"""

from .base import LibertasError

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
