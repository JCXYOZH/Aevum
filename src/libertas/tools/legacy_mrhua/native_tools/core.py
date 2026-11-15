# tools/native_tools.py
"""
原生网络安全工具 - 纯Python标准库实现，不依赖外部工具安装
支持跨平台（Windows/macOS/Linux）

每个工具返回统一格式：
{
    "success": bool,
    "tool": str,
    "target": str,
    "data": Any,
    "raw_output": str,
    "scan_time": str,
    "error": str (可选)
}
"""
import os
import re
import ssl
import sys
import json
import time
import socket
import struct
import shutil
import platform
import inspect
import subprocess
import threading
import urllib.request
import urllib.error
from typing import Dict, List, Any, Optional, Callable
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeout
from datetime import datetime
from libertas.utils.text_decode import decode_output

from .constants import *


def cancel_all():
    cancel_event.set()

def reset_cancel():
    cancel_event.clear()

def is_cancelled() -> bool:
    return cancel_event.is_set()

def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def _result(tool: str, target: str, success: bool, data: Any = None,
            raw: str = "", error: str = "") -> Dict[str, Any]:
    r = {
        "success": success,
        "tool": tool,
        "target": target,
        "data": data or {},
        "raw_output": raw,
        "scan_time": _now(),
    }
    if error:
        r["error"] = error
    return r
