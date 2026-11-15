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


class BackupManager:
    """备份管理器"""

    def __init__(self, backup_dir: str = ""):
        self.manager_id = f"backup_{uuid.uuid4().hex[:8]}"
        self.backup_dir = backup_dir or os.path.join(get_data_dir(), "backups")
        self.backups: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()
        os.makedirs(self.backup_dir, exist_ok=True)

    def create_backup(self, source_path: str, name: str = "",
                      compress: bool = True) -> Dict[str, Any]:
        if not os.path.exists(source_path):
            return {"error": f"源路径不存在: {source_path}"}
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        backup_name = name or f"backup_{timestamp}"
        backup_id = f"bk_{uuid.uuid4().hex[:6]}"
        backup_path = os.path.join(self.backup_dir, f"{backup_name}_{timestamp}")

        result = {
            "backup_id": backup_id,
            "name": backup_name,
            "source": source_path,
            "backup_path": backup_path,
            "timestamp": time.time(),
            "status": "running",
            "files_count": 0,
            "total_size": 0,
            "compressed": compress,
        }

        try:
            if os.path.isdir(source_path):
                if compress:
                    archive_path = backup_path + ".zip"
                    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zf:
                        for root, dirs, files in os.walk(source_path):
                            for file in files:
                                filepath = os.path.join(root, file)
                                arcname = os.path.relpath(filepath, source_path)
                                zf.write(filepath, arcname)
                                result["files_count"] += 1
                                result["total_size"] += os.path.getsize(filepath)
                    result["backup_path"] = archive_path
                else:
                    shutil.copytree(source_path, backup_path)
                    for root, dirs, files in os.walk(backup_path):
                        result["files_count"] += len(files)
                        for file in files:
                            result["total_size"] += os.path.getsize(os.path.join(root, file))
            else:
                if compress:
                    archive_path = backup_path + ".zip"
                    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zf:
                        zf.write(source_path, os.path.basename(source_path))
                    result["backup_path"] = archive_path
                else:
                    shutil.copy2(source_path, backup_path + os.path.splitext(source_path)[1])
                result["files_count"] = 1
                result["total_size"] = os.path.getsize(source_path)

            result["status"] = "completed"
            result["backup_size"] = os.path.getsize(result["backup_path"])
            result["compression_ratio"] = round(
                result["backup_size"] / max(result["total_size"], 1), 4
            )
        except Exception as e:
            result["status"] = "failed"
            result["error"] = str(e)

        with self._lock:
            self.backups[backup_id] = result
        return result

    def restore_backup(self, backup_id: str, target_path: str) -> Dict[str, Any]:
        backup = self.backups.get(backup_id)
        if not backup:
            return {"error": f"备份不存在: {backup_id}"}
        backup_path = backup["backup_path"]
        if not os.path.exists(backup_path):
            return {"error": f"备份文件不存在: {backup_path}"}
        try:
            os.makedirs(target_path, exist_ok=True)
            if backup_path.endswith(".zip"):
                with zipfile.ZipFile(backup_path, "r") as zf:
                    zf.extractall(target_path)
            else:
                if os.path.isdir(backup_path):
                    shutil.copytree(backup_path, target_path, dirs_exist_ok=True)
                else:
                    shutil.copy2(backup_path, target_path)
            return {
                "backup_id": backup_id,
                "target_path": target_path,
                "status": "completed",
                "restored_at": time.time(),
            }
        except Exception as e:
            return {"error": str(e), "status": "failed"}

    def list_backups(self) -> List[Dict[str, Any]]:
        backups = list(self.backups.values())
        backups.sort(key=lambda b: b["timestamp"], reverse=True)
        return backups

    def delete_backup(self, backup_id: str) -> bool:
        backup = self.backups.pop(backup_id, None)
        if backup and os.path.exists(backup["backup_path"]):
            try:
                if os.path.isdir(backup["backup_path"]):
                    shutil.rmtree(backup["backup_path"])
                else:
                    os.remove(backup["backup_path"])
            except Exception:
                pass
            return True
        return False

    def cleanup_old_backups(self, keep_count: int = 10) -> int:
        backups = self.list_backups()
        deleted = 0
        for backup in backups[keep_count:]:
            if self.delete_backup(backup["backup_id"]):
                deleted += 1
        return deleted

    def get_stats(self) -> Dict[str, Any]:
        total_size = sum(b.get("backup_size", 0) for b in self.backups.values())
        return {
            "manager_id": self.manager_id,
            "backup_dir": self.backup_dir,
            "total_backups": len(self.backups),
            "total_size": total_size,
            "successful": sum(1 for b in self.backups.values() if b["status"] == "completed"),
            "failed": sum(1 for b in self.backups.values() if b["status"] == "failed"),
        }
