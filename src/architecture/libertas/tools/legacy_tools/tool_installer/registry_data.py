"""
网络安全工具安装管理器
- 检测工具是否已安装
- 提供各平台安装命令
- 执行安装（需用户授权）
- 安装验证
"""
import os
import shutil
import platform
import subprocess
import urllib.request
import urllib.error
import ssl
import time
from typing import Dict, List, Optional
from libertas.foundation.config import get_data_dir

from .registry_part_1 import REGISTRY_PART as _p1
from .registry_part_2 import REGISTRY_PART as _p2
from .registry_part_3 import REGISTRY_PART as _p3
from .registry_part_4 import REGISTRY_PART as _p4

TOOL_REGISTRY = {}
TOOL_REGISTRY.update(_p1)
TOOL_REGISTRY.update(_p2)
TOOL_REGISTRY.update(_p3)
TOOL_REGISTRY.update(_p4)

