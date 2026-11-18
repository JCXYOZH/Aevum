"""
审计日志中心

集中记录所有用户操作，支持筛选、搜索、导出、完整性校验。
使用 SQLite + FTS5 全文索引，支持百万级日志。
"""
import os
import json
import time
import sqlite3
import hashlib
import threading
import queue
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

from .logger import AuditLogger

_audit_logger = None


def get_audit_logger() -> AuditLogger:
    global _audit_logger
    if _audit_logger is None:
        _audit_logger = AuditLogger()
    return _audit_logger


def audit_log(action: str, **kwargs) -> str:
    return get_audit_logger().log(action, **kwargs)
