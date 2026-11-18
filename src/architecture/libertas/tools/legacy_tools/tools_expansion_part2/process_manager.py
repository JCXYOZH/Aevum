"""
tools/tools_expansion2.py - 综合工具集扩展（第二部分）

高级工具：系统信息收集器、进程管理器、网络连接监控器、
日志分析器、配置审计器、备份管理器、压缩工具集、
编码转换工具集、时间日期工具集、数学计算工具集。
"""
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


class ProcessManager:
    """进程管理器"""

    def __init__(self):
        self.manager_id = f"proc_{uuid.uuid4().hex[:8]}"
        self.monitored_processes: Dict[int, Dict[str, Any]] = {}
        self._lock = threading.RLock()

    def list_processes(self) -> List[Dict[str, Any]]:
        processes = []
        try:
            if platform.system() == "Windows":
                result = subprocess.run(
                    ["tasklist", "/FO", "CSV", "/NH"],
                    capture_output=True, timeout=10
                )
                for line in safe_decode(result.stdout).strip().split("\n"):
                    parts = line.strip('"').split('","')
                    if len(parts) >= 5:
                        processes.append({
                            "pid": int(parts[1]),
                            "name": parts[0],
                            "memory_kb": int(parts[4].replace(",", "").replace(" K", "")),
                            "session": parts[2],
                            "session_num": int(parts[3]),
                        })
            else:
                result = subprocess.run(
                    ["ps", "aux"],
                    capture_output=True, timeout=10
                )
                for line in safe_decode(result.stdout).strip().split("\n")[1:]:
                    parts = line.split(None, 10)
                    if len(parts) >= 11:
                        processes.append({
                            "user": parts[0],
                            "pid": int(parts[1]),
                            "cpu_percent": float(parts[2]),
                            "memory_percent": float(parts[3]),
                            "vsz": int(parts[4]),
                            "rss": int(parts[5]),
                            "tty": parts[6],
                            "stat": parts[7],
                            "start": parts[8],
                            "time": parts[9],
                            "command": parts[10],
                        })
        except Exception as e:
            terminal.warn(f"进程列表获取失败: {e}", "process_manager")
        return processes

    def get_process(self, pid: int) -> Optional[Dict[str, Any]]:
        for proc in self.list_processes():
            if proc.get("pid") == pid:
                return proc
        return None

    def kill_process(self, pid: int, force: bool = False) -> bool:
        try:
            if platform.system() == "Windows":
                cmd = ["taskkill", "/PID", str(pid)]
                if force:
                    cmd.append("/F")
                subprocess.run(cmd, capture_output=True, timeout=10)
            else:
                import signal
                os.kill(pid, signal.SIGKILL if force else signal.SIGTERM)
            return True
        except Exception as e:
            terminal.warn(f"终止进程失败: {e}", "process_manager")
            return False

    def start_process(self, command: str, working_dir: str = "",
                      environment: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        try:
            env = os.environ.copy()
            if environment:
                env.update(environment)
            proc = subprocess.Popen(
                command,
                shell=True,
                cwd=working_dir or None,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            return {
                "pid": proc.pid,
                "command": command,
                "status": "running",
                "started_at": time.time(),
            }
        except Exception as e:
            return {"error": str(e), "status": "failed"}

    def monitor_process(self, pid: int, interval: float = 5.0) -> str:
        monitor_id = f"mon_{uuid.uuid4().hex[:6]}"
        self.monitored_processes[pid] = {
            "monitor_id": monitor_id,
            "pid": pid,
            "interval": interval,
            "started_at": time.time(),
            "history": deque(maxlen=100),
            "running": True,
        }
        return monitor_id

    def stop_monitoring(self, pid: int) -> bool:
        if pid in self.monitored_processes:
            self.monitored_processes[pid]["running"] = False
            del self.monitored_processes[pid]
            return True
        return False

    def find_process_by_name(self, name: str) -> List[Dict[str, Any]]:
        return [p for p in self.list_processes()
                if name.lower() in p.get("name", "").lower() or
                name.lower() in p.get("command", "").lower()]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "manager_id": self.manager_id,
            "monitored_processes": len(self.monitored_processes),
        }
