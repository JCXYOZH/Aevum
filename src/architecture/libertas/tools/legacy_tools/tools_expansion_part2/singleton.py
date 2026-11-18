"""
tools/tools_expansion2.py - 综合工具集扩展（第二部分）

高级工具：系统信息收集器、进程管理器、网络连接监控器、
日志分析器、配置审计器、备份管理器、压缩工具集、
编码转换工具集、时间日期工具集、数学计算工具集。
"""
from .system_info_collector import SystemInfoCollector
from .process_manager import ProcessManager
from .log_analyzer import LogAnalyzer
from .backup_manager import BackupManager
from .compression_toolkit import CompressionToolkit
import os
from libertas.foundation.config import get_data_dir

import sys
import json
import time
import uuid
import math
import hashlib
import threading
import subprocess
import platform
import shutil
import zipfile
import tarfile
import gzip
import bz2
import lzma
import base64
import struct
import socket
import datetime
import calendar
from libertas.foundation.byte_stream import safe_decode
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter, defaultdict
from enum import Enum
from libertas.foundation.terminal import terminal


# ================================================================
# 系统信息收集器
# ================================================================


_system_info_collector = SystemInfoCollector()

_process_manager = ProcessManager()

_log_analyzer = LogAnalyzer()

_backup_manager = BackupManager()

_compression_toolkit = CompressionToolkit()

def get_system_info_collector() -> SystemInfoCollector:
    return _system_info_collector

def get_process_manager() -> ProcessManager:
    return _process_manager

def get_log_analyzer() -> LogAnalyzer:
    return _log_analyzer

def get_backup_manager() -> BackupManager:
    return _backup_manager

def get_compression_toolkit() -> CompressionToolkit:
    return _compression_toolkit
