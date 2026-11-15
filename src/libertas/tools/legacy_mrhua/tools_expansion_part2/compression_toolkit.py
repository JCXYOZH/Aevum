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


class CompressionToolkit:
    """压缩工具集"""

    def __init__(self):
        self.toolkit_id = f"comp_{uuid.uuid4().hex[:8]}"
        self.supported_formats = ["zip", "tar", "tar.gz", "tar.bz2", "tar.xz", "gz", "bz2", "xz"]

    def compress(self, source_path: str, output_path: str = "",
                 format: str = "zip", compression_level: int = 6) -> Dict[str, Any]:
        if not os.path.exists(source_path):
            return {"error": f"源路径不存在: {source_path}"}
        if format not in self.supported_formats:
            return {"error": f"不支持的格式: {format}"}
        if not output_path:
            base = os.path.basename(source_path.rstrip(os.sep))
            ext = "." + format.replace("tar.", "tar.")
            output_path = base + ext

        result = {
            "source": source_path,
            "output": output_path,
            "format": format,
            "compression_level": compression_level,
            "original_size": 0,
            "compressed_size": 0,
            "compression_ratio": 0.0,
            "status": "running",
            "started_at": time.time(),
        }

        try:
            # 计算原始大小
            if os.path.isdir(source_path):
                for root, dirs, files in os.walk(source_path):
                    for f in files:
                        result["original_size"] += os.path.getsize(os.path.join(root, f))
            else:
                result["original_size"] = os.path.getsize(source_path)

            if format == "zip":
                with zipfile.ZipFile(output_path, "w",
                                     compression=zipfile.ZIP_DEFLATED,
                                     compresslevel=compression_level) as zf:
                    if os.path.isdir(source_path):
                        for root, dirs, files in os.walk(source_path):
                            for f in files:
                                filepath = os.path.join(root, f)
                                arcname = os.path.relpath(filepath, source_path)
                                zf.write(filepath, arcname)
                    else:
                        zf.write(source_path, os.path.basename(source_path))
            elif format.startswith("tar"):
                mode = "w"
                if format == "tar.gz":
                    mode = "w:gz"
                elif format == "tar.bz2":
                    mode = "w:bz2"
                elif format == "tar.xz":
                    mode = "w:xz"
                with tarfile.open(output_path, mode) as tf:
                    tf.add(source_path, arcname=os.path.basename(source_path.rstrip(os.sep)))
            elif format in ("gz", "bz2", "xz"):
                if os.path.isdir(source_path):
                    return {"error": "单文件压缩格式不支持目录"}
                open_func = {"gz": gzip.open, "bz2": bz2.open, "xz": lzma.open}[format]
                with open(source_path, "rb") as f_in:
                    with open_func(output_path, "wb", compresslevel=compression_level) as f_out:
                        shutil.copyfileobj(f_in, f_out)

            result["compressed_size"] = os.path.getsize(output_path)
            result["compression_ratio"] = round(
                result["compressed_size"] / max(result["original_size"], 1), 4
            )
            result["status"] = "completed"
        except Exception as e:
            result["status"] = "failed"
            result["error"] = str(e)

        result["duration_ms"] = round((time.time() - result["started_at"]) * 1000, 1)
        return result

    def decompress(self, archive_path: str, output_dir: str = "") -> Dict[str, Any]:
        if not os.path.exists(archive_path):
            return {"error": f"压缩文件不存在: {archive_path}"}
        if not output_dir:
            output_dir = os.path.splitext(archive_path)[0]
        os.makedirs(output_dir, exist_ok=True)

        result = {
            "archive": archive_path,
            "output_dir": output_dir,
            "status": "running",
            "files_extracted": 0,
            "started_at": time.time(),
        }

        try:
            if archive_path.endswith(".zip"):
                with zipfile.ZipFile(archive_path, "r") as zf:
                    zf.extractall(output_dir)
                    result["files_extracted"] = len(zf.namelist())
            elif archive_path.endswith((".tar", ".tar.gz", ".tar.bz2", ".tar.xz", ".tgz")):
                with tarfile.open(archive_path, "r:*") as tf:
                    tf.extractall(output_dir)
                    result["files_extracted"] = len(tf.getnames())
            elif archive_path.endswith(".gz"):
                with gzip.open(archive_path, "rb") as f_in:
                    output_file = os.path.join(output_dir, os.path.basename(archive_path[:-3]))
                    with open(output_file, "wb") as f_out:
                        shutil.copyfileobj(f_in, f_out)
                    result["files_extracted"] = 1
            elif archive_path.endswith(".bz2"):
                with bz2.open(archive_path, "rb") as f_in:
                    output_file = os.path.join(output_dir, os.path.basename(archive_path[:-4]))
                    with open(output_file, "wb") as f_out:
                        shutil.copyfileobj(f_in, f_out)
                    result["files_extracted"] = 1
            elif archive_path.endswith(".xz"):
                with lzma.open(archive_path, "rb") as f_in:
                    output_file = os.path.join(output_dir, os.path.basename(archive_path[:-3]))
                    with open(output_file, "wb") as f_out:
                        shutil.copyfileobj(f_in, f_out)
                    result["files_extracted"] = 1
            else:
                return {"error": "不支持的压缩格式"}
            result["status"] = "completed"
        except Exception as e:
            result["status"] = "failed"
            result["error"] = str(e)

        result["duration_ms"] = round((time.time() - result["started_at"]) * 1000, 1)
        return result

    def list_archive_contents(self, archive_path: str) -> List[Dict[str, Any]]:
        if not os.path.exists(archive_path):
            return []
        contents = []
        try:
            if archive_path.endswith(".zip"):
                with zipfile.ZipFile(archive_path, "r") as zf:
                    for info in zf.infolist():
                        contents.append({
                            "name": info.filename,
                            "size": info.file_size,
                            "compressed_size": info.compress_size,
                            "is_dir": info.is_dir(),
                        })
            elif archive_path.endswith((".tar", ".tar.gz", ".tar.bz2", ".tar.xz")):
                with tarfile.open(archive_path, "r:*") as tf:
                    for member in tf.getmembers():
                        contents.append({
                            "name": member.name,
                            "size": member.size,
                            "is_dir": member.isdir(),
                            "mode": oct(member.mode),
                        })
        except Exception:
            pass
        return contents

    def get_stats(self) -> Dict[str, Any]:
        return {
            "toolkit_id": self.toolkit_id,
            "supported_formats": self.supported_formats,
        }
