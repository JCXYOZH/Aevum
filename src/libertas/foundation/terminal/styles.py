"""终端颜色、输出级别与终端能力检测。"""

import os
import sys
import shutil
from typing import Tuple


class Color:
    """ANSI 转义码颜色常量"""
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    ITALIC = "\033[3m"
    UNDERLINE = "\033[4m"
    BLINK = "\033[5m"
    REVERSE = "\033[7m"
    STRIKETHROUGH = "\033[9m"

    # 前景色
    BLACK = "\033[30m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"
    WHITE = "\033[37m"
    GRAY = "\033[90m"
    BRIGHT_RED = "\033[91m"
    BRIGHT_GREEN = "\033[92m"
    BRIGHT_YELLOW = "\033[93m"
    BRIGHT_BLUE = "\033[94m"
    BRIGHT_MAGENTA = "\033[95m"
    BRIGHT_CYAN = "\033[96m"
    BRIGHT_WHITE = "\033[97m"

    # 背景色
    BG_BLACK = "\033[40m"
    BG_RED = "\033[41m"
    BG_GREEN = "\033[42m"
    BG_YELLOW = "\033[43m"
    BG_BLUE = "\033[44m"
    BG_MAGENTA = "\033[45m"
    BG_CYAN = "\033[46m"
    BG_WHITE = "\033[47m"

    @classmethod
    def wrap(cls, text: str, *styles: str) -> str:
        """用指定样式包裹文本"""
        if not styles:
            return text
        return "".join(styles) + text + cls.RESET

    @classmethod
    def strip(cls, text: str) -> str:
        """移除文本中的 ANSI 转义码"""
        import re
        return re.sub(r'\033\[[0-9;]*m', '', text)

class LogLevel:
    QUIET = 0      # 只显示横幅和关键错误
    NORMAL = 1     # 正常输出（默认）
    VERBOSE = 2    # 详细输出
    DEBUG = 3      # 调试输出

    _names = {0: "QUIET", 1: "NORMAL", 2: "VERBOSE", 3: "DEBUG"}

    @classmethod
    def name(cls, level: int) -> str:
        return cls._names.get(level, f"LEVEL_{level}")

def get_terminal_size(default: Tuple[int, int] = (120, 40)) -> Tuple[int, int]:
    """获取终端尺寸 (列, 行)"""
    try:
        size = shutil.get_terminal_size(fallback=default)
        return size.columns, size.lines
    except Exception:
        return default

def supports_color() -> bool:
    """检测终端是否支持颜色"""
    if os.environ.get("NO_COLOR"):
        return False
    if os.environ.get("FORCE_COLOR"):
        return True
    if not hasattr(sys.stdout, "isatty"):
        return False
    try:
        return sys.stdout.isatty()
    except Exception:
        return False