"""职责模块：security。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple, Union
import platform
import re
import shlex

from .constants import BLACKLIST_COMMANDS
from .constants import DANGEROUS_PATTERNS

class SecurityChecker:
    """命令安全检查器"""

    @staticmethod
    def check_command(command: str, args: List[str]) -> Tuple[bool, str]:
        """
        检查命令是否安全

        Returns:
            (是否安全, 原因)
        """
        full_command = command + " " + " ".join(args)

        # 检查黑名单
        for blocked in BLACKLIST_COMMANDS:
            if blocked in full_command.lower():
                return False, f"命令在黑名单中: {blocked}"

        # 检查危险模式
        for pattern in DANGEROUS_PATTERNS:
            if re.search(pattern, full_command, re.IGNORECASE):
                return False, f"命令包含危险模式: {pattern}"

        # 检查Shell注入字符（当不使用shell=True时）
        injection_chars = [";", "&&", "||", "|", ">", "<", "`", "$(", "${"]
        for char in injection_chars:
            if char in full_command and not _is_safe_usage(full_command, char):
                return False, f"命令包含潜在注入字符: {char}"

        return True, "ok"

    @staticmethod
    def escape_arg(arg: str) -> str:
        """安全转义参数"""
        if platform.system().lower() == "windows":
            # Windows: 用双引号包裹，转义内部双引号
            if any(c in arg for c in [' ', '"', '&', '|', '>', '<']):
                return '"' + arg.replace('"', '\\"') + '"'
            return arg
        else:
            # Unix: 使用shlex.quote
            return shlex.quote(arg)

def _is_safe_usage(command: str, char: str) -> bool:
    """检查特殊字符是否是安全用法"""
    # 允许在引号内的特殊字符
    in_single_quote = False
    in_double_quote = False
    for i, c in enumerate(command):
        if c == "'" and not in_double_quote:
            in_single_quote = not in_single_quote
        elif c == '"' and not in_single_quote:
            in_double_quote = not in_double_quote
        elif command[i:i+len(char)] == char:
            if in_single_quote or in_double_quote:
                return True
    return False
