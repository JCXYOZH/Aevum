"""职责模块：database。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple, TypeVar
import functools

from .state import _sqlite_patched

def optimize_sqlite(conn) -> Any:
    """对 SQLite 连接应用性能优化。"""
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA cache_size=-64000")   # 64MB 缓存
        conn.execute("PRAGMA temp_store=MEMORY")
        conn.execute("PRAGMA mmap_size=268435456")  # 256MB mmap
        conn.execute("PRAGMA foreign_keys=ON")
    except Exception:
        pass
    return conn

def patch_sqlite() -> None:
    """全局优化所有 SQLite 连接：WAL + 缓存 + mmap。"""
    global _sqlite_patched
    if _sqlite_patched:
        return
    try:
        import sqlite3
        _original_connect = sqlite3.connect

        @functools.wraps(_original_connect)
        def _optimized_connect(*args, **kwargs):
            conn = _original_connect(*args, **kwargs)
            try:
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=NORMAL")
                conn.execute("PRAGMA cache_size=-64000")
                conn.execute("PRAGMA temp_store=MEMORY")
                conn.execute("PRAGMA mmap_size=268435456")
            except Exception:
                pass
            return conn

        sqlite3.connect = _optimized_connect
        _sqlite_patched = True
    except Exception:
        pass
