"""职责模块：wsl。"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess

from .constants import GO_TOOL_PATHS
from .constants import PIP_TOOL_PATHS
from .constants import WSL_CACHE
from .constants import WSL_DISTRO
from .constants import WSL_ENABLED

def add_tool_paths_to_env():
    """将pip和go的常见安装目录临时添加到os.environ['PATH']
    让shutil.which()能找到这些目录中的工具
    """
    extra_paths = []
    for p in PIP_TOOL_PATHS + GO_TOOL_PATHS:
        if os.path.isdir(p) and p not in os.environ.get("PATH", "").split(os.pathsep):
            extra_paths.append(p)
    if extra_paths:
        os.environ["PATH"] = os.pathsep.join(extra_paths) + os.pathsep + os.environ.get("PATH", "")
    return extra_paths

def is_wsl_available() -> bool:
    """检查WSL是否可用"""
    if platform.system().lower() != "windows":
        return False
    if not WSL_ENABLED:
        return False
    try:
        # 方法1：检查wsl命令是否存在
        if not shutil.which("wsl"):
            return False
        # 方法2：尝试执行一个简单命令测试WSL
        result = subprocess.run(
            ["wsl", "-d", WSL_DISTRO, "echo", "wsl_ok"],
            capture_output=True, timeout=10
        )
        if result.returncode == 0 and b"wsl_ok" in result.stdout:
            return True
        # 方法3：尝试列出WSL发行版（处理编码问题）
        result = subprocess.run(
            ["wsl", "-l", "-q"],
            capture_output=True, timeout=10
        )
        # 尝试多种编码解码
        for enc in ["utf-8", "gbk", "gb2312", "utf-16", "utf-16-le"]:
            try:
                output = result.stdout.decode(enc, errors="replace")
                if WSL_DISTRO.lower() in output.lower():
                    return True
            except Exception:
                continue
        return False
    except Exception:
        return False

def windows_path_to_wsl(windows_path: str) -> str:
    """将Windows路径转换为WSL路径
    C:\\data -> /mnt/c/data
    """
    if not windows_path:
        return windows_path
    # 已经是WSL路径
    if windows_path.startswith("/mnt/"):
        return windows_path
    # 转换盘符
    if len(windows_path) >= 2 and windows_path[1] == ":":
        drive = windows_path[0].lower()
        rest = windows_path[2:].replace("\\", "/")
        return f"/mnt/{drive}{rest}"
    return windows_path.replace("\\", "/")

def check_wsl_tool(tool_name: str) -> bool:
    """检查工具在WSL中是否可用"""
    if tool_name in WSL_CACHE:
        return WSL_CACHE[tool_name]
    try:
        result = subprocess.run(
            ["wsl", "-d", WSL_DISTRO, "which", tool_name],
            capture_output=True, text=True, timeout=10,
            encoding="utf-8", errors="replace"
        )
        available = result.returncode == 0 and bool(result.stdout.strip())
        WSL_CACHE[tool_name] = available
        return available
    except Exception:
        WSL_CACHE[tool_name] = False
        return False
