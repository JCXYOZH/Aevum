"""配置职责：paths。"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

def get_data_dir() -> str:
    """获取数据目录

    Windows: 优先使用非系统盘（D/E/F...）的 LibertasData，避免安全工具占满C盘；
             无可用非系统盘时回退到用户目录 ~/LibertasData
    macOS/Linux: ~/LibertasData
    环境变量 LIBERTAS_DATA_DIR 优先
    """
    env_dir = os.environ.get("LIBERTAS_DATA_DIR")
    if env_dir:
        base = os.path.abspath(os.path.expanduser(env_dir))
    elif os.name == "nt":  # Windows
        system_drive = os.environ.get("SystemDrive", "C:").rstrip("\\")
        base = None
        for drive_letter in "DEFGHIJKLMNOPQRSTUVWXYZ":
            drive_path = f"{drive_letter}:\\"
            if os.path.exists(drive_path) and f"{drive_letter}:" != system_drive:
                base = f"{drive_letter}:\\LibertasData"
                break
        if base is None:
            base = os.path.join(os.path.expanduser("~"), "LibertasData")
    else:  # macOS / Linux
        base = os.path.join(os.path.expanduser("~"), "LibertasData")
    os.makedirs(base, exist_ok=True)
    return base

def get_config_dir() -> str:
    """获取配置目录"""
    config_dir = os.path.join(get_data_dir(), "config")
    os.makedirs(config_dir, exist_ok=True)
    return config_dir

def data_path(name: str = "", *subpaths: str) -> str:
    """获取数据目录下的路径

    Args:
        name: 子目录名或文件名
        *subpaths: 后续子路径

    Returns:
        完整路径，目录会自动创建（文件不会被当作目录创建）
    """
    base = get_data_dir()
    if name:
        base = os.path.join(base, name)
    if subpaths:
        base = os.path.join(base, *subpaths)
    # 只有当路径看起来像目录（没有扩展名或已存在为目录）时才创建目录
    # 避免把文件名（如 ExperimentConfig.json）当作目录创建
    _, ext = os.path.splitext(base)
    if not ext or os.path.isdir(base):
        os.makedirs(base, exist_ok=True)
    else:
        # 文件路径：确保父目录存在
        parent = os.path.dirname(base)
        if parent:
            os.makedirs(parent, exist_ok=True)
    return base

def resolve_path(path: str) -> str:
    """解析路径（委托给 Config 单例）"""
    from .api import _get_config
    return _get_config().resolve_path(path)
