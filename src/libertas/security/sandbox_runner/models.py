"""
沙箱执行环境

结合两个版本的优点：
- 现在版本的功能丰富性：SandboxConfig、SandboxResult、结果管理、执行终止、统计、输入注入
- 0.1.5版本的安全机制：AST解析、Shell白名单、系统级隔离（macOS sandbox-exec）
- 用子进程执行代替线程内exec，真正的隔离，可以被杀死
"""
import os
import sys
import ast
import json
import time
import uuid
import shutil
import platform
import signal
import threading
import subprocess
import tempfile
import traceback
from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


class SandboxStatus(Enum):
    IDLE = "idle"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"
    KILLED = "killed"
    BLOCKED = "blocked"

class SandboxViolation(Exception):
    """沙箱违规异常"""
    pass

class SandboxConfig:
    """沙箱配置"""

    def __init__(self):
        self.timeout_seconds = 30.0
        self.max_memory_mb = 512
        self.max_cpu_percent = 50
        self.max_output_chars = 10000
        self.max_file_size_mb = 10
        self.allowed_modules: List[str] = ["math", "json", "re", "datetime", "time",
                                            "collections", "itertools", "functools",
                                            "string", "random", "statistics", "hashlib",
                                            "base64", "uuid", "enum", "typing", "copy"]
        self.blocked_builtins: List[str] = ["eval", "exec", "compile", "open",
                                             "import", "input", "breakpoint", "exit",
                                             "quit", "globals", "locals", "vars",
                                             "dir", "delattr", "setattr", "getattr"]
        self.allow_network = False
        self.allow_file_write = False
        self.allow_file_read = True
        self.allow_subprocess = False
        self.allow_env_access = False
        self.work_dir = ""
        self.env_vars: Dict[str, str] = {}
        self.seccomp_profile = ""
        self.user_id = 0
        self.group_id = 0
        # 新增：网络控制模式（none / local / full）
        self.network_mode = "none"
        # 新增：是否启用 AST 静态检查
        self.enable_ast_check = True
        # 新增：是否启用 Shell 白名单
        self.enable_shell_whitelist = True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timeout_seconds": self.timeout_seconds,
            "max_memory_mb": self.max_memory_mb,
            "max_cpu_percent": self.max_cpu_percent,
            "max_output_chars": self.max_output_chars,
            "allowed_modules": self.allowed_modules,
            "blocked_builtins": self.blocked_builtins,
            "allow_network": self.allow_network,
            "allow_file_write": self.allow_file_write,
            "allow_file_read": self.allow_file_read,
            "allow_subprocess": self.allow_subprocess,
            "network_mode": self.network_mode,
            "enable_ast_check": self.enable_ast_check,
            "enable_shell_whitelist": self.enable_shell_whitelist,
        }

class SandboxResult:
    """沙箱执行结果"""

    def __init__(self):
        self.execution_id = f"sandbox_{uuid.uuid4().hex[:8]}"
        self.status = SandboxStatus.IDLE
        self.stdout = ""
        self.stderr = ""
        self.output = ""
        self.error = ""
        self.traceback = ""
        self.return_code = 0
        self.start_time = 0.0
        self.end_time = 0.0
        self.duration_ms = 0.0
        self.memory_used_mb = 0.0
        self.cpu_used_percent = 0.0
        self.warnings: List[str] = []
        self.blocked_operations: List[str] = []
        self.result_value: Any = None
        self.risk_score: float = 0.0
        self.risks: List[str] = []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "execution_id": self.execution_id,
            "status": self.status.value,
            "stdout": self.stdout[:1000],
            "stderr": self.stderr[:1000],
            "output": self.output[:1000],
            "error": self.error[:500],
            "traceback": self.traceback[:1000],
            "return_code": self.return_code,
            "duration_ms": round(self.duration_ms, 1),
            "memory_used_mb": round(self.memory_used_mb, 2),
            "warnings": self.warnings,
            "blocked_operations": self.blocked_operations,
            "risk_score": self.risk_score,
            "risks": self.risks,
        }
