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

from dataclasses import dataclass

@dataclass
class DirectoryQuota:
    """目录配额"""
    name: str
    max_size_mb: int = 0  # 0 表示无限制
    max_files: int = 0  # 0 表示无限制
    auto_clean: bool = True
