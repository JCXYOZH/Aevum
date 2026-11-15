"""职责模块：io。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple, TypeVar
import os

from .constants import _MISSING
from .cache import get_cache

def ensure_dir(path: str) -> str:
    """快速创建目录（存在则跳过）。"""
    if not os.path.isdir(path):
        os.makedirs(path, exist_ok=True)
    return path

def atomic_write(path: str, data, binary: bool = False) -> None:
    """原子写入：先写临时文件再 rename，防止写一半崩溃。"""
    ensure_dir(os.path.dirname(path) or ".")
    tmp = path + ".tmp"
    mode = "wb" if binary else "w"
    encoding = None if binary else "utf-8"
    with open(tmp, mode, encoding=encoding) as f:
        f.write(data)
        f.flush()
        try:
            os.fsync(f.fileno())
        except OSError:
            pass
    os.replace(tmp, path)

def read_file_fast(path: str, binary: bool = False) -> Any:
    """快速读取文件（带缓存）。"""
    cache = get_cache("files", maxsize=128, ttl=60.0)
    key = f"{path}:{os.path.getmtime(path) if os.path.isfile(path) else 0}"
    result = cache.get(key, _MISSING)
    if result is not _MISSING:
        return result
    mode = "rb" if binary else "r"
    encoding = None if binary else "utf-8"
    with open(path, mode, encoding=encoding) as f:
        result = f.read()
    cache.set(key, result)
    return result
