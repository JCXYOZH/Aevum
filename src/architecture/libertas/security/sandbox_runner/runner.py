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

from .checks import _check_python_ast, _check_shell_command, _make_sandbox_profile
from .command_exec import SandboxCommandMixin
from .python_exec import SandboxPythonMixin
from .models import SandboxConfig, SandboxResult, SandboxStatus, SandboxViolation


class SandboxRunner(SandboxPythonMixin, SandboxCommandMixin):
    """沙箱执行环境：风险评级、结果管理与统计。"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "sandbox")
        self.work_dir = os.path.join(self.data_dir, "workspace")
        os.makedirs(self.work_dir, exist_ok=True)
        self._results: Dict[str, SandboxResult] = {}
        self._lock = threading.RLock()
        self._default_config = SandboxConfig()
        self._running_processes: Dict[str, subprocess.Popen] = {}
        self._execution_count = 0
        self._total_duration_ms = 0.0
        self._is_macos = platform.system() == "Darwin"
        self._is_windows = platform.system() == "Windows"
        # 风险模式（用于风险评估，AST 检查是主要安全机制）
        self._risk_patterns = [
            (r'os\.system', "执行系统命令"),
            (r'subprocess', "创建子进程"),
            (r'__import__', "动态导入"),
            (r'eval\s*\(', "动态求值"),
            (r'exec\s*\(', "动态执行"),
            (r'open\s*\(', "文件操作"),
            (r'socket', "网络操作"),
            (r'requests', "网络请求"),
            (r'urllib', "网络请求"),
            (r'shutil', "文件系统操作"),
            (r'rm\s+-rf', "危险删除命令"),
            (r'fork', "进程分叉"),
            (r'threading', "多线程"),
            (r'multiprocessing', "多进程"),
        ]

    def assess_risk(self, code: str) -> Tuple[float, List[str]]:
        """评估代码风险（正则模式 + AST 检查）"""
        risks = []
        risk_score = 0.0
        import re
        for pattern, description in self._risk_patterns:
            if re.search(pattern, code):
                risks.append(description)
                risk_score += 0.15
        # 检查文件写入
        if 'w' in code and 'open' in code:
            risks.append("文件写入")
            risk_score += 0.2
        # 检查网络
        if any(kw in code for kw in ['http', 'socket', 'connect']):
            risks.append("网络访问")
            risk_score += 0.3
        # AST 检查（更精确）
        ast_violation = _check_python_ast(code)
        if ast_violation:
            risks.append(f"AST违规: {ast_violation}")
            risk_score += 0.5
        return min(risk_score, 1.0), list(set(risks))

    def get_result(self, execution_id: str) -> Optional[SandboxResult]:
        return self._results.get(execution_id)

    def list_results(self, limit: int = 50) -> List[SandboxResult]:
        results = list(self._results.values())
        results.sort(key=lambda r: r.start_time, reverse=True)
        return results[:limit]

    def clear_results(self):
        with self._lock:
            self._results.clear()

    def get_default_config(self) -> SandboxConfig:
        return self._default_config

    def set_default_config(self, config: SandboxConfig):
        self._default_config = config

    def get_stats(self) -> Dict[str, Any]:
        total = len(self._results)
        completed = sum(1 for r in self._results.values() if r.status == SandboxStatus.COMPLETED)
        failed = sum(1 for r in self._results.values() if r.status == SandboxStatus.FAILED)
        timeout = sum(1 for r in self._results.values() if r.status == SandboxStatus.TIMEOUT)
        blocked = sum(1 for r in self._results.values() if r.status == SandboxStatus.BLOCKED)
        avg_duration = self._total_duration_ms / max(self._execution_count, 1)
        return {
            "total_executions": self._execution_count,
            "results_stored": total,
            "completed": completed,
            "failed": failed,
            "timeout": timeout,
            "blocked": blocked,
            "avg_duration_ms": round(avg_duration, 1),
            "running_processes": len(self._running_processes),
            "work_dir": self.work_dir,
            "default_timeout": self._default_config.timeout_seconds,
            "default_max_memory_mb": self._default_config.max_memory_mb,
            "is_macos": self._is_macos,
            "is_windows": self._is_windows,
            "sandbox_exec_available": self._is_macos and shutil.which("sandbox-exec") is not None,
        }
