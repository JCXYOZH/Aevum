"""
tools/tools_expansion2.py - 综合工具集扩展（第二部分）

高级工具：系统信息收集器、进程管理器、网络连接监控器、
日志分析器、配置审计器、备份管理器、压缩工具集、
编码转换工具集、时间日期工具集、数学计算工具集。
"""
import os
import re
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


class SystemInfoCollector:
    """系统信息收集器"""

    def __init__(self):
        self.collector_id = f"sysinfo_{uuid.uuid4().hex[:8]}"
        self.history: deque = deque(maxlen=100)
        self._lock = threading.RLock()

    def get_os_info(self) -> Dict[str, Any]:
        return {
            "system": platform.system(),
            "node": platform.node(),
            "release": platform.release(),
            "version": platform.version(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "platform": platform.platform(),
            "python_version": platform.python_version(),
            "python_implementation": platform.python_implementation(),
        }

    def get_cpu_info(self) -> Dict[str, Any]:
        info = {
            "cpu_count_logical": os.cpu_count() or 0,
            "cpu_count_physical": 0,
            "cpu_freq": 0.0,
            "load_avg": (0.0, 0.0, 0.0),
        }
        try:
            if hasattr(os, "getloadavg"):
                info["load_avg"] = os.getloadavg()
        except Exception:
            pass
        # 尝试读取/proc/cpuinfo
        try:
            with open("/proc/cpuinfo", "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
                physical_ids = set(re.findall(r"physical id\s*:\s*(\d+)", content))
                info["cpu_count_physical"] = len(physical_ids) or info["cpu_count_logical"]
                cpu_mhz = re.findall(r"cpu MHz\s*:\s*([\d.]+)", content)
                if cpu_mhz:
                    info["cpu_freq"] = float(cpu_mhz[0])
        except Exception:
            info["cpu_count_physical"] = info["cpu_count_logical"]
        return info

    def get_memory_info(self) -> Dict[str, Any]:
        info = {
            "total": 0,
            "available": 0,
            "used": 0,
            "free": 0,
            "percent": 0.0,
        }
        try:
            with open("/proc/meminfo", "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    parts = line.split(":")
                    if len(parts) == 2:
                        key = parts[0].strip()
                        val = int(parts[1].strip().split()[0]) * 1024
                        if key == "MemTotal":
                            info["total"] = val
                        elif key == "MemAvailable":
                            info["available"] = val
                        elif key == "MemFree":
                            info["free"] = val
            info["used"] = info["total"] - info["available"]
            info["percent"] = round(info["used"] / max(info["total"], 1) * 100, 1)
        except Exception:
            pass
        return info

    def get_disk_info(self) -> List[Dict[str, Any]]:
        disks = []
        try:
            for partition in self._get_partitions():
                try:
                    usage = shutil.disk_usage(partition["mountpoint"])
                    disks.append({
                        "device": partition["device"],
                        "mountpoint": partition["mountpoint"],
                        "fstype": partition.get("fstype", ""),
                        "total": usage.total,
                        "used": usage.used,
                        "free": usage.free,
                        "percent": round(usage.used / max(usage.total, 1) * 100, 1),
                    })
                except Exception:
                    continue
        except Exception:
            pass
        return disks

    def _get_partitions(self) -> List[Dict[str, str]]:
        partitions = []
        try:
            with open("/proc/mounts", "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    parts = line.split()
                    if len(parts) >= 3:
                        partitions.append({
                            "device": parts[0],
                            "mountpoint": parts[1],
                            "fstype": parts[2],
                        })
        except Exception:
            # Windows fallback
            for drive in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
                path = f"{drive}:\\"
                if os.path.exists(path):
                    partitions.append({"device": path, "mountpoint": path, "fstype": ""})
        return partitions

    def get_network_info(self) -> Dict[str, Any]:
        info = {
            "hostname": socket.gethostname(),
            "interfaces": [],
            "connections": [],
        }
        try:
            info["ip_address"] = socket.gethostbyname(socket.gethostname())
        except Exception:
            info["ip_address"] = "127.0.0.1"
        return info

    def get_uptime(self) -> Dict[str, Any]:
        try:
            if platform.system() == "Linux":
                with open("/proc/uptime", "r", encoding="utf-8", errors="replace") as f:
                    uptime_seconds = float(f.read().split()[0])
            else:
                # Windows
                uptime_seconds = time.time() - os.path.getctime("C:\\")
        except Exception:
            uptime_seconds = 0
        days = int(uptime_seconds // 86400)
        hours = int((uptime_seconds % 86400) // 3600)
        minutes = int((uptime_seconds % 3600) // 60)
        return {
            "uptime_seconds": round(uptime_seconds, 1),
            "uptime_formatted": f"{days}天 {hours}小时 {minutes}分钟",
            "boot_time": time.time() - uptime_seconds,
        }

    def collect_all(self) -> Dict[str, Any]:
        result = {
            "collector_id": self.collector_id,
            "timestamp": time.time(),
            "os": self.get_os_info(),
            "cpu": self.get_cpu_info(),
            "memory": self.get_memory_info(),
            "disks": self.get_disk_info(),
            "network": self.get_network_info(),
            "uptime": self.get_uptime(),
        }
        with self._lock:
            self.history.append(result)
        return result

    def get_history(self, limit: int = 20) -> List[Dict]:
        return list(reversed(self.history))[-limit:]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "collector_id": self.collector_id,
            "total_collections": len(self.history),
        }
