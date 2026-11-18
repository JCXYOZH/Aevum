"""终端统一输出接口与模块级日志函数。"""

import os
import sys
import time
import threading
from datetime import datetime
from typing import Any, Dict, List, Optional, TextIO

from .styles import Color, LogLevel, get_terminal_size
from .writer import _OutputWriter
from .table import Table
from .progress import ProgressBar, Spinner
from .banner import print_banner


class Terminal:
    """统一终端输出接口，所有模块通过此实例输出"""

    def __init__(self, level: int = LogLevel.NORMAL, stream: Optional[TextIO] = None):
        self._level = level
        self._writer = _OutputWriter(stream)
        self._lock = threading.Lock()
        self._start_time = time.time()
        self._module_states: Dict[str, str] = {}

    @property
    def level(self) -> int:
        return self._level

    @level.setter
    def level(self, value: int):
        self._level = max(0, min(3, value))

    def _should_log(self, msg_level: int) -> bool:
        return msg_level <= self._level

    def _timestamp(self) -> str:
        return datetime.now().strftime("%H:%M:%S")

    # ----------------------------------------------------------
    # 基础输出原语
    # ----------------------------------------------------------
    def raw(self, text: str = "", level: int = LogLevel.NORMAL):
        """原始文本输出"""
        if self._should_log(level):
            self._writer.submit(text)

    def info(self, message: str, module: str = "", level: int = LogLevel.NORMAL):
        """信息输出 [INFO]"""
        if not self._should_log(level):
            return
        ts = f"{Color.GRAY}[{self._timestamp()}]{Color.RESET}"
        tag = f"{Color.BLUE}[INFO]{Color.RESET}"
        mod = f"{Color.CYAN}[{module}]{Color.RESET}" if module else ""
        self._writer.submit(f"{ts} {tag} {mod} {message}")

    def success(self, message: str, module: str = "", level: int = LogLevel.NORMAL):
        """成功输出 [OK]"""
        if not self._should_log(level):
            return
        ts = f"{Color.GRAY}[{self._timestamp()}]{Color.RESET}"
        tag = f"{Color.GREEN}[ OK ]{Color.RESET}"
        mod = f"{Color.CYAN}[{module}]{Color.RESET}" if module else ""
        self._writer.submit(f"{ts} {tag} {mod} {message}")

    def warn(self, message: str, module: str = "", level: int = LogLevel.NORMAL):
        """警告输出 [WARN]"""
        if not self._should_log(level):
            return
        ts = f"{Color.GRAY}[{self._timestamp()}]{Color.RESET}"
        tag = f"{Color.YELLOW}[WARN]{Color.RESET}"
        mod = f"{Color.CYAN}[{module}]{Color.RESET}" if module else ""
        self._writer.submit(f"{ts} {tag} {mod} {message}")

    def error(self, message: str, module: str = "", level: int = LogLevel.NORMAL):
        """错误输出 [FAIL]"""
        if not self._should_log(level):
            return
        ts = f"{Color.GRAY}[{self._timestamp()}]{Color.RESET}"
        tag = f"{Color.RED}[FAIL]{Color.RESET}"
        mod = f"{Color.CYAN}[{module}]{Color.RESET}" if module else ""
        self._writer.submit(f"{ts} {tag} {mod} {message}")

    def debug(self, message: str, module: str = "", level: int = LogLevel.DEBUG):
        """调试输出 [DBG]"""
        if not self._should_log(level):
            return
        ts = f"{Color.GRAY}[{self._timestamp()}]{Color.RESET}"
        tag = f"{Color.MAGENTA}[DBG ]{Color.RESET}"
        mod = f"{Color.CYAN}[{module}]{Color.RESET}" if module else ""
        self._writer.submit(f"{ts} {tag} {mod} {message}")

    # ----------------------------------------------------------
    # 结构化输出
    # ----------------------------------------------------------
    def section(self, title: str, level: int = LogLevel.NORMAL):
        """输出一个分区标题"""
        if not self._should_log(level):
            return
        cols, _ = get_terminal_size()
        line_len = min(cols - 4, 66)
        title_len = len(Color.strip(title))
        if title_len > line_len - 4:
            title = title[:line_len - 7] + "..."
            title_len = len(Color.strip(title))
        dashes = line_len - title_len - 2
        left = dashes // 2
        right = dashes - left
        self._writer.submit("")
        self._writer.submit(f"{Color.BRIGHT_BLUE}{Color.BOLD}{'─' * left} {title} {'─' * right}{Color.RESET}")

    def step(self, number: int, title: str, level: int = LogLevel.NORMAL):
        """输出一个步骤"""
        if not self._should_log(level):
            return
        self._writer.submit(f"{Color.BRIGHT_YELLOW}  [{number}]{Color.RESET} {title}")

    def banner(self, version: str = "", build_time: str = "", mode: str = "",
               extra_info: Optional[Dict[str, str]] = None):
        """输出大字横幅"""
        print_banner(version, build_time, mode, extra_info)

    def table(self, headers: List[str], rows: Optional[List[List[Any]]] = None,
              align: Optional[List[str]] = None, level: int = LogLevel.NORMAL):
        """输出表格"""
        if not self._should_log(level):
            return
        t = Table(headers, rows, align=align)
        t.print()

    def progress(self, total: int, prefix: str = "", **kwargs) -> ProgressBar:
        """创建进度条"""
        return ProgressBar(total, prefix, **kwargs)

    def spinner(self, text: str = "", **kwargs) -> Spinner:
        """创建旋转指示器"""
        return Spinner(text, **kwargs)

    def key_value(self, key: str, value: str, level: int = LogLevel.NORMAL):
        """键值对输出"""
        if not self._should_log(level):
            return
        self._writer.submit(f"  {Color.WHITE}{key}{Color.RESET}: {value}")

    def divider(self, char: str = "─", level: int = LogLevel.NORMAL):
        """输出分隔线"""
        if not self._should_log(level):
            return
        cols, _ = get_terminal_size()
        self._writer.submit(f"{Color.GRAY}{char * min(cols, 70)}{Color.RESET}")

    def blank(self, count: int = 1, level: int = LogLevel.NORMAL):
        """输出空行"""
        if not self._should_log(level):
            return
        for _ in range(count):
            self._writer.submit("")

    # ----------------------------------------------------------
    # 模块状态管理
    # ----------------------------------------------------------
    def set_module_state(self, module: str, state: str):
        """设置模块状态（用于启动时的状态表）"""
        with self._lock:
            self._module_states[module] = state

    def print_module_status(self, level: int = LogLevel.NORMAL):
        """打印所有模块状态表"""
        if not self._should_log(level) or not self._module_states:
            return
        self.section("模块加载状态")
        rows = []
        for module, state in sorted(self._module_states.items()):
            if state in ("成功", "loaded", "ok", "OK"):
                display = f"{Color.GREEN}● {state}{Color.RESET}"
            elif state in ("失败", "error", "failed"):
                display = f"{Color.RED}● {state}{Color.RESET}"
            elif state in ("跳过", "skipped", "disabled"):
                display = f"{Color.GRAY}● {state}{Color.RESET}"
            else:
                display = f"{Color.YELLOW}● {state}{Color.RESET}"
            rows.append([module, display])
        self.table(["模块", "状态"], rows)

    # ----------------------------------------------------------
    # 系统信息
    # ----------------------------------------------------------
    def uptime(self) -> str:
        """返回系统运行时间"""
        elapsed = time.time() - self._start_time
        if elapsed < 60:
            return f"{elapsed:.1f}秒"
        elif elapsed < 3600:
            return f"{elapsed/60:.1f}分钟"
        else:
            return f"{elapsed/3600:.1f}小时"

    def flush(self):
        """等待所有输出写入完成"""
        self._writer.flush()

    def shutdown(self):
        """关闭输出系统"""
        self._writer.stop()

def log_info(message: str, module: str = ""):
    terminal.info(message, module)

def log_success(message: str, module: str = ""):
    terminal.success(message, module)

def log_warn(message: str, module: str = ""):
    terminal.warn(message, module)

def log_error(message: str, module: str = ""):
    terminal.error(message, module)

def log_debug(message: str, module: str = ""):
    terminal.debug(message, module)

def log_section(title: str):
    terminal.section(title)

def log_banner(version: str = "", build_time: str = "", mode: str = "", **kwargs):
    terminal.banner(version, build_time, mode, kwargs)

def log_table(headers: List[str], rows: Optional[List[List[Any]]] = None, **kwargs):
    terminal.table(headers, rows, **kwargs)

def log_progress(total: int, prefix: str = "", **kwargs) -> ProgressBar:
    return terminal.progress(total, prefix, **kwargs)

def log_spinner(text: str = "", **kwargs) -> Spinner:
    return terminal.spinner(text, **kwargs)

def log_divider(char: str = "─"):
    terminal.divider(char)

def log_key_value(key: str, value: str):
    terminal.key_value(key, value)

def log_blank(count: int = 1):
    terminal.blank(count)

def set_log_level(level: int):
    """设置全局日志级别"""
    terminal.level = level

def get_terminal() -> Terminal:
    """获取全局终端实例"""
    return terminal

terminal = Terminal()
