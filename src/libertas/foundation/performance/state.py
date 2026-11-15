"""职责模块：state。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple, TypeVar
import threading

_initialized = False

_init_lock = threading.Lock()

_timers: Dict[str, float] = {}

_counters: Dict[str, int] = {}

_stats_lock = threading.Lock()

_http_session = None

_http_session_lock = threading.Lock()

_thread_pool = None

_thread_pool_lock = threading.Lock()

_sqlite_patched = False
