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


class AuditEntry:
    """审计日志条目"""

    __slots__ = ("id", "timestamp", "time", "action", "category", "user",
                 "details", "severity", "ip", "user_agent", "session_id",
                 "resource", "result", "duration_ms", "prev_hash", "hash")

    def __init__(self, action: str = "", category: str = "system",
                 user: str = "", details: str = "", severity: str = "info",
                 ip: str = "", user_agent: str = "", session_id: str = "",
                 resource: str = "", result: str = "", duration_ms: float = 0.0):
        self.id = f"log_{int(time.time() * 1000)}_{id(self) % 10000}"
        self.timestamp = time.time()
        self.time = datetime.fromtimestamp(self.timestamp).strftime("%Y-%m-%d %H:%M:%S")
        self.action = action
        self.category = category
        self.user = user
        self.details = details
        self.severity = severity
        self.ip = ip
        self.user_agent = user_agent
        self.session_id = session_id
        self.resource = resource
        self.result = result
        self.duration_ms = duration_ms
        self.prev_hash = ""
        self.hash = ""

    def compute_hash(self, prev_hash: str = "") -> str:
        """计算条目哈希（哈希链）"""
        content = f"{self.id}|{self.timestamp}|{self.action}|{self.category}|{self.user}|{self.details}|{self.severity}|{self.ip}|{prev_hash}"
        return hashlib.sha256(content.encode("utf-8")).hexdigest()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "time": self.time,
            "action": self.action,
            "category": self.category,
            "user": self.user,
            "details": self.details,
            "severity": self.severity,
            "ip": self.ip,
            "user_agent": self.user_agent,
            "session_id": self.session_id,
            "resource": self.resource,
            "result": self.result,
            "duration_ms": self.duration_ms,
            "hash": self.hash,
        }

    def to_row(self) -> Tuple:
        return (
            self.id, self.timestamp, self.time, self.action, self.category,
            self.user, self.details, self.severity, self.ip, self.user_agent,
            self.session_id, self.resource, self.result, self.duration_ms,
            self.prev_hash, self.hash,
        )
