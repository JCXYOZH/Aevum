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


_FORBIDDEN_MODULES = {
    'os', 'subprocess', 'shutil', 'socket', 'ctypes', 'multiprocessing',
    'threading', 'signal', 'pty', 'commands', 'popen2', 'pathlib',
    'importlib', 'pkgutil', 'pip', 'setuptools', 'distutils',
}

_FORBIDDEN_CALLS = {
    'eval', 'exec', 'compile', '__import__', 'globals', 'locals',
    'vars', 'getattr', 'setattr', 'delattr', 'open', 'input',
    'breakpoint', 'exit', 'quit',
}

_SHELL_WHITELIST = {
    'ls', 'pwd', 'echo', 'cat', 'head', 'tail', 'wc', 'grep',
    'find', 'date', 'whoami', 'uname', 'python3', 'python',
    'curl', 'ping', 'nslookup', 'dig', 'host', 'sort', 'uniq',
    'awk', 'sed', 'cut', 'tr', 'tee', 'diff', 'cmp', 'file',
    'stat', 'du', 'df', 'ps', 'top', 'uptime', 'id', 'env',
    'which', 'whereis', 'type',
}

_NETWORK_COMMANDS = {'curl', 'ping', 'nslookup', 'dig', 'host'}
