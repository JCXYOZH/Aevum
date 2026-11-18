"""进度条与旋转指示器。"""

import time
import threading
from typing import Optional, Tuple

from .styles import Color, get_terminal_size
from .writer import _writer


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
            icon = f"{Color.GREEN}[ OK ]{Color.RESET}"
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