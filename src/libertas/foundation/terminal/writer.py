"""终端串行写入队列。"""

import sys
import time
import queue
import threading
from typing import Optional, TextIO

from .styles import Color, supports_color


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

_writer = _OutputWriter()
