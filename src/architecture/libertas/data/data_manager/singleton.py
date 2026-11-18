"""
统一数据目录管理器

融合两个版本的优点：
- 保留当前版本的丰富功能（配额、临时文件、缓存清理、健康检查）
- 吸收0.1.5版本的简洁接口（dir/db/file/workspace）和业务命名
- 修复 DirectoryQuota 重复定义问题
- 标准目录结构、路径解析、磁盘空间、文件生命周期、数据迁移
"""
import os
import sys
import time
import shutil
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from libertas.foundation.config import get_data_dir, config

from typing import Optional

from .manager import DataDirectoryManager

_data_manager: Optional[DataDirectoryManager] = None


def get_data_manager(base_dir: str = "") -> DataDirectoryManager:
    """获取数据目录管理器单例"""
    global _data_manager
    if _data_manager is None:
        _data_manager = DataDirectoryManager(base_dir)
    return _data_manager


def data_path(name: str = "", *subpaths: str) -> str:
    """获取数据目录下的路径（模块级函数，兼容当前版本接口）"""
    return get_data_manager().get_path(name, *subpaths)


def resolve_data_path(path: str) -> str:
    """解析数据路径（模块级函数，兼容当前版本接口）"""
    return get_data_manager().resolve_path(path)
