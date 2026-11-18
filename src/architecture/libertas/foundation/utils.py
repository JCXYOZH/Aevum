# core/utils.py - 工具函数与日志系统
import os
import sys
import json
import time
import uuid
import logging
import re
import threading
from logging.handlers import RotatingFileHandler, TimedRotatingFileHandler
from datetime import datetime
from typing import Any, Dict, Optional
from libertas.foundation.config import get_data_dir

_logging_configured = False
_correlation_id_var = threading.local()

# ================================================================
# 敏感信息脱敏模式
# ================================================================
_SENSITIVE_PATTERNS = [
    (re.compile(r'(api[_-]?key|apikey|secret[_-]?key|access[_-]?token)\s*[=:]\s*["\']?([A-Za-z0-9_\-]{8,})["\']?', re.IGNORECASE), r'\1=***'),
    (re.compile(r'(password|passwd|pwd)\s*[=:]\s*["\']?([^"\'\s,}]+)["\']?', re.IGNORECASE), r'\1=***'),
    (re.compile(r'(token|jwt|bearer)\s+([A-Za-z0-9_\-\.]{16,})', re.IGNORECASE), r'\1 ***'),
    (re.compile(r'1[3-9]\d{9}'), '***手机号***'),
    (re.compile(r'\d{17}[\dXx]'), '***身份证***'),
    (re.compile(r'([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})'), r'***@\2'),
]


def sanitize_message(message: str) -> str:
    """脱敏日志消息中的敏感信息"""
    if not message:
        return message
    result = message
    for pattern, replacement in _SENSITIVE_PATTERNS:
        result = pattern.sub(replacement, result)
    return result


# ================================================================
# 关联 ID
# ================================================================
def set_correlation_id(cid: str = "") -> str:
    """设置当前线程的关联 ID"""
    if not cid:
        cid = str(uuid.uuid4())[:8]
    _correlation_id_var.value = cid
    return cid


def get_correlation_id() -> str:
    """获取当前线程的关联 ID"""
    return getattr(_correlation_id_var, "value", "")


def clear_correlation_id():
    """清除关联 ID"""
    if hasattr(_correlation_id_var, "value"):
        delattr(_correlation_id_var, "value")


# ================================================================
# JSON 日志格式化器
# ================================================================
class JsonFormatter(logging.Formatter):
    """JSON 格式日志格式化器（文件端）"""

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": datetime.fromtimestamp(record.created).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3],
            "level": record.levelname,
            "logger": record.name,
            "message": sanitize_message(record.getMessage()),
            "correlation_id": get_correlation_id(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
            "thread": record.threadName,
        }
        if record.exc_info and record.exc_info[0]:
            log_entry["exception"] = self.formatException(record.exc_info)
        if hasattr(record, "extra_data"):
            log_entry["extra"] = record.extra_data
        return json.dumps(log_entry, ensure_ascii=False)


class ConsoleFormatter(logging.Formatter):
    """人类可读格式日志格式化器（终端端）"""

    COLORS = {
        "DEBUG": "\033[90m",
        "INFO": "\033[36m",
        "WARNING": "\033[33m",
        "ERROR": "\033[31m",
        "CRITICAL": "\033[91m",
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, "")
        cid = get_correlation_id()
        cid_str = f" [{cid}]" if cid else ""
        timestamp = datetime.fromtimestamp(record.created).strftime("%H:%M:%S")
        msg = sanitize_message(record.getMessage())
        line = f"{color}[{timestamp}]{cid_str} [{record.levelname}] [{record.name}] {msg}{self.RESET}"
        if record.exc_info and record.exc_info[0]:
            line += "\n" + self.formatException(record.exc_info)
        return line


# ================================================================
# 模块级 Logger 工厂
# ================================================================
def get_module_logger(module_name: str) -> logging.Logger:
    """获取模块级 logger"""
    return logging.getLogger(f"libertas.{module_name}")


def log_with_extra(logger: logging.Logger, level: int, message: str, extra: Optional[Dict[str, Any]] = None):
    """带额外数据的日志"""
    record_extra = {"extra_data": extra} if extra else {}
    logger.log(level, message, extra=record_extra)


# ================================================================
# 主日志配置
# ================================================================
def setup_logging(log_dir=None, log_file="libertas.log", level=logging.INFO,
                  json_format=True, console_level=logging.ERROR):
    """
    配置日志系统

    Args:
        log_dir: 日志目录
        log_file: 日志文件名
        level: 文件日志级别
        json_format: 是否使用 JSON 格式
        console_level: 控制台日志级别
    """
    global _logging_configured
    if _logging_configured:
        return logging.getLogger(__name__)

    # 从全局配置读取日志目录
    if log_dir is None:
        try:
            from libertas.foundation.config import config
            log_dir = config.resolve_path(config.get('log_dir', '')) or os.path.join(get_data_dir(), "logs")
        except ImportError:
            log_dir = os.path.join(get_data_dir(), "logs")

    os.makedirs(log_dir, exist_ok=True)

    # 文件处理器：按大小轮转 + JSON 格式
    file_handler = RotatingFileHandler(
        os.path.join(log_dir, log_file),
        maxBytes=10 * 1024 * 1024,
        backupCount=10,
        encoding='utf-8'
    )
    file_handler.setLevel(level)
    if json_format:
        file_handler.setFormatter(JsonFormatter())
    else:
        file_handler.setFormatter(logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        ))

    # 审计日志：按天轮转
    audit_handler = TimedRotatingFileHandler(
        os.path.join(log_dir, "audit.log"),
        when='midnight',
        interval=1,
        backupCount=30,
        encoding='utf-8'
    )
    audit_handler.setLevel(logging.INFO)
    audit_handler.setFormatter(JsonFormatter())
    audit_logger = logging.getLogger("libertas.audit")
    audit_logger.addHandler(audit_handler)
    audit_logger.setLevel(logging.INFO)
    audit_logger.propagate = False

    # 错误日志：单独文件
    error_handler = RotatingFileHandler(
        os.path.join(log_dir, "error.log"),
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding='utf-8'
    )
    error_handler.setLevel(logging.ERROR)
    error_handler.setFormatter(JsonFormatter())

    # 控制台处理器
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(console_level)
    console_handler.setFormatter(ConsoleFormatter())

    # 根 logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG)
    for h in root_logger.handlers[:]:
        root_logger.removeHandler(h)
    root_logger.addHandler(file_handler)
    root_logger.addHandler(error_handler)
    root_logger.addHandler(console_handler)

    _logging_configured = True
    return logging.getLogger(__name__)


def get_logging_status() -> Dict[str, Any]:
    """获取日志系统状态"""
    return {
        "configured": _logging_configured,
        "correlation_id": get_correlation_id(),
        "root_level": logging.getLogger().level,
        "handlers": len(logging.getLogger().handlers),
    }


# ================================================================
# 资源路径
# ================================================================
def get_resource_path(relative_path):
    """兼容开发环境与打包后的资源路径"""
    if getattr(sys, 'frozen', False):
        base_path = sys._MEIPASS
    else:
        base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_path, relative_path)


# ================================================================
# 通用工具函数
# ================================================================
def safe_get(data: Dict, key: str, default: Any = None) -> Any:
    """安全获取字典值"""
    try:
        return data.get(key, default)
    except Exception:
        return default


def truncate_string(s: str, max_len: int = 200, suffix: str = "...") -> str:
    """截断字符串"""
    if not s or len(s) <= max_len:
        return s or ""
    return s[:max_len - len(suffix)] + suffix


def format_bytes(size: int) -> str:
    """格式化字节数"""
    if size < 1024:
        return f"{size} B"
    elif size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    elif size < 1024 * 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MB"
    else:
        return f"{size / (1024 * 1024 * 1024):.1f} GB"


def format_duration(seconds: float) -> str:
    """格式化时长"""
    if seconds < 1:
        return f"{seconds * 1000:.0f}ms"
    elif seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        return f"{seconds / 60:.1f}m"
    else:
        return f"{seconds / 3600:.1f}h"


def generate_id(prefix: str = "id") -> str:
    """生成唯一 ID"""
    return f"{prefix}_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}"


def json_dumps_safe(obj: Any, indent: int = 2) -> str:
    """安全 JSON 序列化"""
    try:
        return json.dumps(obj, ensure_ascii=False, indent=indent, default=str)
    except Exception:
        return str(obj)


def retry_operation(func, max_retries: int = 3, delay: float = 1.0,
                    backoff: float = 2.0, exceptions: tuple = (Exception,)):
    """简单重试操作"""
    last_exception = None
    for attempt in range(max_retries):
        try:
            return func()
        except exceptions as e:
            last_exception = e
            if attempt < max_retries - 1:
                time.sleep(delay * (backoff ** attempt))
    raise last_exception
