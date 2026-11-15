"""职责模块：models。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple, Union
from enum import Enum
from dataclasses import dataclass, field
import time

from .constants import CACHE_TTL

class BinaryStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"
    KILLED = "killed"
    NOT_FOUND = "not_found"
    BLOCKED = "blocked"

@dataclass
class BinaryResult:
    """二进制执行结果"""
    command: str
    binary_path: str = ""
    args: List[str] = field(default_factory=list)
    status: BinaryStatus = BinaryStatus.PENDING
    return_code: int = -1
    stdout: str = ""
    stderr: str = ""
    output: str = ""  # stdout + stderr 合并
    pid: int = 0
    started_at: float = 0.0
    completed_at: float = 0.0
    duration_ms: float = 0.0
    error: str = ""
    parsed_data: Any = None  # 解析后的结构化数据
    from_cache: bool = False
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "command": self.command,
            "binary_path": self.binary_path,
            "args": self.args,
            "status": self.status.value,
            "return_code": self.return_code,
            "stdout": self.stdout[:5000],  # 限制大小
            "stderr": self.stderr[:2000],
            "pid": self.pid,
            "duration_ms": round(self.duration_ms, 2),
            "error": self.error,
            "parsed_data": self.parsed_data,
            "from_cache": self.from_cache,
            "warnings": self.warnings,
        }

@dataclass
class CacheEntry:
    """缓存条目"""
    key: str
    result: BinaryResult
    created_at: float = field(default_factory=time.time)

    def is_expired(self) -> bool:
        return time.time() - self.created_at > CACHE_TTL
