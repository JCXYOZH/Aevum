"""
core/terminal.py - 结构化终端输出系统

提供统一的、线程安全的终端输出原语，替代散落各处的原始 print()。
所有输出通过内部队列串行写入，彻底解决并发交错问题。

输出分级：QUIET / NORMAL / VERBOSE / DEBUG
输出原语：banner / section / step / success / warn / error / info / table / progress / spinner
"""
import os
import sys
import time
import threading
import queue
import shutil
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple, TextIO

# ================================================================
# ANSI 颜色与样式
# ================================================================
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


# ================================================================
# 输出级别
# ================================================================
class LogLevel:
    QUIET = 0      # 只显示横幅和关键错误
    NORMAL = 1     # 正常输出（默认）
    VERBOSE = 2    # 详细输出
    DEBUG = 3      # 调试输出

    _names = {0: "QUIET", 1: "NORMAL", 2: "VERBOSE", 3: "DEBUG"}

    @classmethod
    def name(cls, level: int) -> str:
        return cls._names.get(level, f"LEVEL_{level}")


# ================================================================
# 终端尺寸检测
# ================================================================
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


# ================================================================
# 输出队列与串行写入器
# ================================================================
class _OutputWriter:
    """单消费者线程，串行写入所有输出，解决并发交错"""

    def __init__(self, stream: Optional[TextIO] = None):
        self._stream = stream or sys.stdout
        self._queue: "queue.Queue[Optional[str]]" = queue.Queue()
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._color_enabled = supports_color()
        self._start()

    def _start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._consume, daemon=True, name="TerminalWriter")
        self._thread.start()

    def _consume(self):
        while self._running:
            try:
                item = self._queue.get(timeout=0.5)
                if item is None:
                    break
                self._write(item)
                self._queue.task_done()
            except queue.Empty:
                continue
            except Exception:
                pass

    def _write(self, text: str):
        try:
            with self._lock:
                self._stream.write(text)
                self._stream.flush()
        except Exception:
            pass

    def submit(self, text: str):
        """提交一行输出到队列"""
        if not text.endswith("\n"):
            text += "\n"
        self._queue.put(text)

    def submit_raw(self, text: str):
        """提交原始文本（不自动加换行）"""
        self._queue.put(text)

    def stop(self, wait: bool = True):
        self._running = False
        self._queue.put(None)
        if wait and self._thread:
            self._thread.join(timeout=2)

    def flush(self):
        """等待队列清空"""
        self._queue.join()

    @property
    def color_enabled(self) -> bool:
        return self._color_enabled

    @color_enabled.setter
    def color_enabled(self, value: bool):
        self._color_enabled = value


# ================================================================
# 进度条
# ================================================================
class ProgressBar:
    """终端进度条"""

    def __init__(self, total: int, prefix: str = "", width: int = 40,
                 color: str = Color.GREEN, show_percent: bool = True,
                 show_count: bool = True, show_eta: bool = True):
        self.total = max(1, total)
        self.prefix = prefix
        self.width = width
        self.color = color
        self.show_percent = show_percent
        self.show_count = show_count
        self.show_eta = show_eta
        self.current = 0
        self._start_time = time.time()
        self._last_update = 0.0
        self._finished = False
        self._lock = threading.Lock()

    def update(self, n: int = 1, suffix: str = ""):
        with self._lock:
            self.current = min(self.total, self.current + n)
            self._render(suffix)

    def set_value(self, value: int, suffix: str = ""):
        with self._lock:
            self.current = min(self.total, max(0, value))
            self._render(suffix)

    def _render(self, suffix: str = ""):
        if self._finished:
            return
        now = time.time()
        if now - self._last_update < 0.05 and self.current < self.total:
            return
        self._last_update = now

        percent = self.current / self.total
        filled = int(self.width * percent)
        bar = "█" * filled + "░" * (self.width - filled)

        parts = []
        if self.prefix:
            parts.append(self.prefix)
        parts.append(f"{self.color}{bar}{Color.RESET}")
        if self.show_percent:
            parts.append(f"{percent*100:5.1f}%")
        if self.show_count:
            parts.append(f"[{self.current}/{self.total}]")
        if self.show_eta and self.current > 0:
            elapsed = now - self._start_time
            eta = elapsed / self.current * (self.total - self.current)
            if eta < 60:
                parts.append(f"ETA: {eta:.0f}s")
            else:
                parts.append(f"ETA: {eta/60:.1f}m")
        if suffix:
            parts.append(suffix)

        line = " ".join(parts)
        cols, _ = get_terminal_size()
        visible_len = len(Color.strip(line))
        if visible_len > cols:
            line = line[:cols - 3] + "..."
        _writer.submit_raw(f"\r{line}")

    def finish(self, message: str = ""):
        with self._lock:
            if self._finished:
                return
            self._finished = True
            self.current = self.total
            self._render("")
            _writer.submit_raw("\n")
            if message:
                _writer.submit(message)


# ================================================================
# 旋转指示器（Spinner）
# ================================================================
class Spinner:
    """终端旋转指示器，用于不确定时长的操作"""

    _FRAMES = ["|", "/", "-", "\\"]

    def __init__(self, text: str = "", color: str = Color.CYAN, interval: float = 0.1):
        self.text = text
        self.color = color
        self.interval = interval
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._frame_idx = 0
        self._start_time = 0.0

    def start(self):
        if self._running:
            return
        self._running = True
        self._start_time = time.time()
        self._thread = threading.Thread(target=self._animate, daemon=True, name="Spinner")
        self._thread.start()

    def _animate(self):
        while self._running:
            frame = self._FRAMES[self._frame_idx % len(self._FRAMES)]
            elapsed = time.time() - self._start_time
            line = f"{self.color}{frame}{Color.RESET} {self.text} {Color.GRAY}({elapsed:.1f}s){Color.RESET}"
            _writer.submit_raw(f"\r{line}")
            self._frame_idx += 1
            time.sleep(self.interval)

    def stop(self, success: bool = True, message: str = ""):
        if not self._running:
            return
        self._running = False
        if self._thread:
            self._thread.join(timeout=1)
        elapsed = time.time() - self._start_time
        if success:
            icon = f"{Color.GREEN}[OK]{Color.RESET}"
        else:
            icon = f"{Color.RED}[FAIL]{Color.RESET}"
        msg = message or self.text
        _writer.submit_raw(f"\r{icon} {msg} {Color.GRAY}({elapsed:.1f}s){Color.RESET}\n")

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.stop(success=exc_type is None)
        return False


# ================================================================
# 表格渲染
# ================================================================
class Table:
    """终端表格渲染器"""

    def __init__(self, headers: List[str], rows: Optional[List[List[Any]]] = None,
                 header_color: str = Color.CYAN + Color.BOLD,
                 border_color: str = Color.GRAY,
                 align: Optional[List[str]] = None,
                 max_col_width: int = 40):
        self.headers = headers
        self.rows = rows or []
        self.header_color = header_color
        self.border_color = border_color
        self.align = align or ["left"] * len(headers)
        self.max_col_width = max_col_width

    def add_row(self, row: List[Any]):
        self.rows.append([str(c) for c in row])

    def _col_widths(self) -> List[int]:
        widths = [len(h) for h in self.headers]
        for row in self.rows:
            for i, cell in enumerate(row):
                if i < len(widths):
                    widths[i] = max(widths[i], min(len(str(cell)), self.max_col_width))
        return [w + 2 for w in widths]

    def _format_cell(self, value: str, width: int, align: str, color: str = "") -> str:
        value = str(value)
        if len(value) > width - 2:
            value = value[:width - 5] + "..."
        padding = width - 2 - len(value)
        if align == "right":
            return f" {color}{value}{Color.RESET}{' ' * padding} "
        elif align == "center":
            left = padding // 2
            right = padding - left
            return f"{' ' * left}{color}{value}{Color.RESET}{' ' * right} "
        else:
            return f" {color}{value}{Color.RESET}{' ' * padding} "

    def render(self) -> str:
        if not self.headers:
            return ""
        widths = self._col_widths()
        bc = self.border_color

        # 顶边框
        top = bc + "┌" + "┬".join("─" * w for w in widths) + "┐" + Color.RESET
        # 表头
        header_cells = []
        for i, h in enumerate(self.headers):
            header_cells.append(self._format_cell(h, widths[i], self.align[i], self.header_color))
        header_line = bc + "│" + bc.join(header_cells) + bc + "│" + Color.RESET
        # 分隔线
        sep = bc + "├" + "┼".join("─" * w for w in widths) + "┤" + Color.RESET
        # 数据行
        data_lines = []
        for row in self.rows:
            cells = []
            for i, cell in enumerate(row):
                if i < len(widths):
                    cells.append(self._format_cell(cell, widths[i], self.align[i]))
            data_lines.append(bc + "│" + bc.join(cells) + bc + "│" + Color.RESET)
        # 底边框
        bottom = bc + "└" + "┴".join("─" * w for w in widths) + "┘" + Color.RESET

        lines = [top, header_line, sep] + data_lines + [bottom]
        return "\n".join(lines)

    def print(self):
        _writer.submit(self.render())


# ================================================================
# 大字横幅
# ================================================================
BANNER_LIBERTAS = r"""
+------------------------------------------+
|   L   I   B   E   R   T   A   S          |
+------------------------------------------+
"""


def print_banner(version: str = "", build_time: str = "", mode: str = "",
                 extra_info: Optional[Dict[str, str]] = None):
    """打印 LIBERTAS 大字横幅 + 版本信息块"""
    cols, _ = get_terminal_size()
    banner_color = Color.BRIGHT_CYAN + Color.BOLD

    # 横幅
    for line in BANNER_LIBERTAS.split("\n"):
        if line.strip():
            _writer.submit(f"{banner_color}{line}{Color.RESET}")

    # 分隔线
    _writer.submit(f"{Color.GRAY}{'─' * min(cols, 70)}{Color.RESET}")

    # 信息块
    info_parts = []
    if version:
        info_parts.append(f"{Color.WHITE}版本{Color.RESET}: {Color.GREEN}{version}{Color.RESET}")
    if build_time:
        info_parts.append(f"{Color.WHITE}构建{Color.RESET}: {Color.YELLOW}{build_time}{Color.RESET}")
    if mode:
        info_parts.append(f"{Color.WHITE}模式{Color.RESET}: {Color.CYAN}{mode}{Color.RESET}")

    if info_parts:
        _writer.submit("  " + " | ".join(info_parts))

    if extra_info:
        for key, value in extra_info.items():
            _writer.submit(f"  {Color.WHITE}{key}{Color.RESET}: {value}")

    _writer.submit(f"{Color.GRAY}{'─' * min(cols, 70)}{Color.RESET}")
    _writer.submit("")


# ================================================================
# 主 Terminal 类 - 统一输出接口
# ================================================================
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


# ================================================================
# 全局单例
# ================================================================
_writer = _OutputWriter()
terminal = Terminal()


# ================================================================
# 便捷函数（兼容旧代码的 print 替换）
# ================================================================
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
