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

from .wordlists_data_part_1 import WORDLISTS_DATA_PART as _w1

WORDLIST_REGISTRY = {}
WORDLIST_REGISTRY.update(_w1)

