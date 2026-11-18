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

from .constants import _FORBIDDEN_MODULES, _FORBIDDEN_CALLS, _SHELL_WHITELIST, _NETWORK_COMMANDS
from .models import SandboxConfig


def _check_python_ast(code: str) -> Optional[str]:
    """用 AST 解析 Python 代码，返回违规描述，None 表示安全"""
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return f"语法错误: {e}"

    for node in ast.walk(tree):
        # 禁止 import 危险模块
        if isinstance(node, ast.Import):
            for alias in node.names:
                top = alias.name.split('.')[0]
                if top in _FORBIDDEN_MODULES:
                    return f"禁止导入模块: {alias.name}"
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                top = node.module.split('.')[0]
                if top in _FORBIDDEN_MODULES:
                    return f"禁止导入模块: {node.module}"
        # 禁止调用危险函数
        elif isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id in _FORBIDDEN_CALLS:
                return f"禁止调用: {func.id}"
            if isinstance(func, ast.Attribute):
                # 禁止 dunder 方法调用（如 __class__.__subclasses__）
                if func.attr.startswith('__') and func.attr.endswith('__'):
                    return f"禁止访问特殊属性: {func.attr}"
                # 禁止 os.system / os.popen 等
                if isinstance(func.value, ast.Name):
                    if func.value.id in _FORBIDDEN_MODULES:
                        return f"禁止访问 {func.value.id}.{func.attr}"
        # 禁止访问 dunder 属性（如 __globals__、__builtins__）
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith('__') and node.attr.endswith('__'):
                if node.attr not in ('__name__', '__doc__', '__file__'):
                    return f"禁止访问特殊属性: {node.attr}"
        # 禁止 with open(...) 等
        elif isinstance(node, ast.With):
            for item in node.items:
                if isinstance(item.context_expr, ast.Call):
                    f = item.context_expr.func
                    if isinstance(f, ast.Name) and f.id == 'open':
                        return "禁止文件操作: open"
    return None


def _check_shell_command(command: str) -> Optional[str]:
    """用 shlex 解析 shell 命令，检查每个命令词是否在白名单"""
    import shlex
    try:
        tokens = shlex.split(command)
    except ValueError as e:
        return f"命令解析失败: {e}"

    # 命令分隔符：管道、逻辑、分号、重定向
    separators = {'|', '||', '&&', ';', '&', '>', '>>', '<', '<<', '|&'}
    # 预处理：把附着在 token 末尾的分隔符拆到后面（如 "ls;" → "ls", ";"）
    cleaned = []
    for t in tokens:
        stripped = []
        while t and t[-1] in (';', '&', '|') and t not in separators:
            stripped.insert(0, t[-1])
            t = t[:-1]
        if t:
            cleaned.append(t)
        cleaned.extend(stripped)
    tokens = cleaned
    # 第一个 token 是命令；每个分隔符后的第一个非参数 token 也是命令
    command_positions = [0]
    for i, t in enumerate(tokens):
        if t in separators:
            for j in range(i + 1, len(tokens)):
                if not tokens[j].startswith('-') and tokens[j] not in separators:
                    command_positions.append(j)
                    break

    for pos in command_positions:
        if pos >= len(tokens):
            continue
        word = tokens[pos]
        if word in separators:
            continue
        if word.startswith('$') or word.startswith('`') or word.startswith('('):
            return f"禁止变量替换/命令替换: {word}"
        base = os.path.basename(word)
        if base not in _SHELL_WHITELIST and word not in _SHELL_WHITELIST:
            return f"命令 '{base}' 不在白名单中"
    return None


def _make_sandbox_profile(work_dir: str, network: str = "none") -> str:
    """生成 macOS sandbox-exec profile"""
    net_deny = "(deny network*)" if network == "none" else ""
    return f"""(version 1)
(allow default)
(deny process-exec*)
(allow process-exec (literal "{sys.executable}"))
(allow process-exec (literal "/bin/bash"))
(allow process-exec (literal "/bin/sh"))
(allow process-exec (literal "/bin/ls"))
(allow process-exec (literal "/bin/cat"))
(allow process-exec (literal "/usr/bin/grep"))
(allow process-exec (literal "/usr/bin/find"))
(allow process-exec (literal "/usr/bin/head"))
(allow process-exec (literal "/usr/bin/tail"))
(allow process-exec (literal "/usr/bin/wc"))
(allow process-exec (literal "/bin/pwd"))
(allow process-exec (literal "/bin/echo"))
(allow process-exec (literal "/usr/bin/env"))
(allow process-exec (literal "/usr/bin/whoami"))
(allow process-exec (literal "/usr/bin/uname"))
(allow process-exec (literal "/usr/bin/which"))
(allow process-exec (literal "/usr/bin/file"))
(allow process-exec (literal "/usr/bin/stat"))
(allow process-exec (literal "/bin/date"))
(allow process-exec (literal "/usr/bin/dig"))
(allow process-exec (literal "/usr/bin/host"))
(allow process-exec (literal "/usr/bin/nslookup"))
(allow process-exec (literal "/sbin/ping"))
(allow process-exec (literal "/usr/bin/curl"))
(deny file-write* (subpath "/") )
(allow file-write* (subpath "{work_dir}"))
(allow file-write* (subpath "/tmp"))
(allow file-write* (subpath "/private/tmp"))
(allow file-write* (subpath "/var/folders"))
{net_deny}
"""
