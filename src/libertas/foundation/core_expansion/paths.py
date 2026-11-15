"""职责模块：paths。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, TypeVar, Generic, Union
import fnmatch
import os
import re

class PathUtils:
    """文件路径工具"""

    @staticmethod
    def normalize(path: str) -> str:
        return os.path.normpath(path)

    @staticmethod
    def join(*paths: str) -> str:
        return os.path.join(*paths)

    @staticmethod
    def exists(path: str) -> bool:
        return os.path.exists(path)

    @staticmethod
    def is_file(path: str) -> bool:
        return os.path.isfile(path)

    @staticmethod
    def is_dir(path: str) -> bool:
        return os.path.isdir(path)

    @staticmethod
    def basename(path: str) -> str:
        return os.path.basename(path)

    @staticmethod
    def dirname(path: str) -> str:
        return os.path.dirname(path)

    @staticmethod
    def extension(path: str) -> str:
        return os.path.splitext(path)[1].lower()

    @staticmethod
    def filename_without_ext(path: str) -> str:
        return os.path.splitext(os.path.basename(path))[0]

    @staticmethod
    def get_size(path: str) -> int:
        try:
            return os.path.getsize(path)
        except OSError:
            return 0

    @staticmethod
    def format_size(size_bytes: int) -> str:
        if size_bytes < 0:
            return "0 B"
        units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
        size = float(size_bytes)
        for unit in units:
            if size < 1024 or unit == units[-1]:
                return f"{size:.2f} {unit}"
            size /= 1024
        return f"{size:.2f} PB"

    @staticmethod
    def get_mtime(path: str) -> float:
        try:
            return os.path.getmtime(path)
        except OSError:
            return 0.0

    @staticmethod
    def get_ctime(path: str) -> float:
        try:
            return os.path.getctime(path)
        except OSError:
            return 0.0

    @staticmethod
    def ensure_dir(path: str):
        os.makedirs(path, exist_ok=True)

    @staticmethod
    def ensure_parent_dir(path: str):
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)

    @staticmethod
    def list_files(directory: str, pattern: str = "*",
                   recursive: bool = False) -> List[str]:
        results = []
        if recursive:
            for root, dirs, files in os.walk(directory):
                for f in files:
                    if fnmatch.fnmatch(f, pattern):
                        results.append(os.path.join(root, f))
        else:
            for f in os.listdir(directory):
                full_path = os.path.join(directory, f)
                if os.path.isfile(full_path) and fnmatch.fnmatch(f, pattern):
                    results.append(full_path)
        return sorted(results)

    @staticmethod
    def list_dirs(directory: str) -> List[str]:
        return sorted([
            os.path.join(directory, d) for d in os.listdir(directory)
            if os.path.isdir(os.path.join(directory, d))
        ])

    @staticmethod
    def safe_filename(filename: str) -> str:
        """生成安全的文件名"""
        filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
        filename = filename.strip('. ')
        return filename or "unnamed"

    @staticmethod
    def is_hidden(path: str) -> bool:
        return os.path.basename(path).startswith('.')

    @staticmethod
    def relative_path(path: str, start: str) -> str:
        return os.path.relpath(path, start)

    @staticmethod
    def absolute_path(path: str) -> str:
        return os.path.abspath(path)

    @staticmethod
    def common_prefix(paths: List[str]) -> str:
        return os.path.commonprefix(paths)
