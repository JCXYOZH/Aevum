"""版本发布与分发系统：发布多平台安装包，通过WAN广播，用户检查更新并安装。

注意：版本发布只分发编译后的安装包（.exe/.app/.bin），不分发源代码。
源代码只能通过治理分叉（Fork）流程经社区投票后获取。
"""
import os
import sys
import glob
import json
import time
import shutil
import hashlib
import zipfile
import platform
import threading
import subprocess
import logging
from typing import Dict, List, Optional, Tuple
from libertas.foundation.config import get_data_dir
from libertas.foundation.byte_stream import safe_decode

logger = logging.getLogger(__name__)


def current_platform() -> str:
    s = platform.system().lower()
    if s == "darwin":
        return "macos"
    if s == "windows":
        return "windows"
    return "linux"

logger = logging.getLogger(__name__)

PLATFORM_LABELS = {
    "windows": "Windows (Setup.exe)",
    "macos": "macOS (.pkg)",
    "linux": "Linux (AppImage/.deb)",
}

PLATFORM_EXT = {
    "windows": ".exe",
    "macos": ".pkg",
    "linux": ".AppImage",
}
