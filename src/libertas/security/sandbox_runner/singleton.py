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

from .models import SandboxConfig, SandboxResult
from .runner import SandboxRunner

_sandbox_runner = None
_sandbox_runner_lock = threading.Lock()


def get_sandbox_runner() -> SandboxRunner:
    """获取全局沙箱执行器（线程安全单例）"""
    global _sandbox_runner
    if _sandbox_runner is None:
        with _sandbox_runner_lock:
            if _sandbox_runner is None:
                _sandbox_runner = SandboxRunner()
    return _sandbox_runner


def execute_in_sandbox(code: str, **kwargs) -> SandboxResult:
    """便捷函数：在沙箱中执行Python代码"""
    return get_sandbox_runner().execute_python(code, **kwargs)


def execute_command_in_sandbox(command: str, **kwargs) -> SandboxResult:
    """便捷函数：在沙箱中执行系统命令"""
    return get_sandbox_runner().execute_command(command, **kwargs)
