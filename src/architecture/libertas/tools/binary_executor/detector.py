"""职责模块：detector。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple, Union
from collections import defaultdict
import os
import platform
import shutil

from .constants import GO_TOOL_PATHS
from .constants import PIP_TOOL_PATHS
from .constants import UNIX_TOOL_PATHS
from .constants import WINDOWS_TOOL_PATHS
from .constants import WSL_DISTRO
from .wsl import check_wsl_tool
from .wsl import is_wsl_available

class BinaryPathDetector:
    """
    二进制路径检测器
    自动查找系统中可用的工具
    """

    def __init__(self):
        self._cache: Dict[str, str] = {}
        self._custom_paths: Dict[str, List[str]] = defaultdict(list)
        self._platform = platform.system().lower()

    def register_path(self, tool_name: str, path: str):
        """注册自定义工具路径"""
        self._custom_paths[tool_name].append(path)
        self._cache.pop(tool_name, None)

    def find(self, tool_name: str) -> Optional[str]:
        """
        查找二进制工具路径

        查找顺序：
        1. 缓存
        2. 自定义路径
        3. PATH环境变量
        4. 平台常见路径
        5. WSL（Windows平台下，如果本地找不到）
        """
        if tool_name in self._cache:
            return self._cache[tool_name]

        # 1. 自定义路径
        for path in self._custom_paths.get(tool_name, []):
            if os.path.isfile(path) and os.access(path, os.X_OK):
                self._cache[tool_name] = path
                return path

        # 2. PATH环境变量
        path_in_path = shutil.which(tool_name)
        if path_in_path:
            self._cache[tool_name] = path_in_path
            return path_in_path

        # 带.exe后缀（Windows）
        if self._platform == "windows":
            path_exe = shutil.which(tool_name + ".exe")
            if path_exe:
                self._cache[tool_name] = path_exe
                return path_exe

        # 3. 平台常见路径
        tool_paths = WINDOWS_TOOL_PATHS if self._platform == "windows" else UNIX_TOOL_PATHS
        for path in tool_paths.get(tool_name, []):
            if os.path.isfile(path) and os.access(path, os.X_OK):
                self._cache[tool_name] = path
                return path

        # 4. pip和go工具目录检查
        for base_dir in PIP_TOOL_PATHS + GO_TOOL_PATHS:
            for ext in ["", ".exe", ".bat", ".cmd"]:
                candidate = os.path.join(base_dir, tool_name + ext)
                if os.path.isfile(candidate):
                    if self._platform == "windows" or os.access(candidate, os.X_OK):
                        self._cache[tool_name] = candidate
                        return candidate

        # 5. WSL（Windows平台下，如果本地找不到，尝试WSL）
        if self._platform == "windows" and is_wsl_available():
            if check_wsl_tool(tool_name):
                # 返回特殊标记，表示通过WSL执行
                wsl_path = f"wsl://{WSL_DISTRO}/{tool_name}"
                self._cache[tool_name] = wsl_path
                return wsl_path

        return None

    def is_wsl_tool(self, tool_name: str) -> bool:
        """检查工具是否通过WSL执行"""
        path = self.find(tool_name)
        return path is not None and path.startswith("wsl://")

    def find_all(self, tool_names: List[str]) -> Dict[str, str]:
        """批量查找工具"""
        results = {}
        for name in tool_names:
            path = self.find(name)
            if path:
                results[name] = path
        return results

    def is_available(self, tool_name: str) -> bool:
        """检查工具是否可用"""
        return self.find(tool_name) is not None

    def get_available_tools(self, tool_names: List[str]) -> List[str]:
        """获取可用的工具列表"""
        return [name for name in tool_names if self.is_available(name)]

    def clear_cache(self):
        self._cache.clear()
