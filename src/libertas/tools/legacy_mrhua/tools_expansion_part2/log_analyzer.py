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


class LogAnalyzer:
    """日志分析器"""

    def __init__(self):
        self.analyzer_id = f"log_{uuid.uuid4().hex[:8]}"
        self.patterns: Dict[str, str] = {
            "timestamp": r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}",
            "ip_address": r"\b(?:\d{1,3}\.){3}\d{1,3}\b",
            "url": r"https?://[^\s]+",
            "email": r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
            "error": r"(?i)\b(error|exception|fatal|critical|fail(ed|ure)?)\b",
            "warning": r"(?i)\b(warn(ing)?|alert|notice)\b",
            "status_code": r"\b[1-5]\d{2}\b",
            "session_id": r"[a-f0-9]{16,}",
        }
        self._lock = threading.RLock()

    def add_pattern(self, name: str, pattern: str):
        self.patterns[name] = pattern

    def remove_pattern(self, name: str) -> bool:
        return self.patterns.pop(name, None) is not None

    def analyze_line(self, line: str) -> Dict[str, Any]:
        result = {
            "line": line[:200],
            "length": len(line),
            "matches": {},
            "severity": "info",
            "timestamp": "",
            "ip_addresses": [],
            "urls": [],
            "emails": [],
            "status_codes": [],
        }
        for name, pattern in self.patterns.items():
            try:
                matches = re.findall(pattern, line)
                if matches:
                    result["matches"][name] = len(matches)
                    if name == "timestamp":
                        result["timestamp"] = matches[0]
                    elif name == "ip_address":
                        result["ip_addresses"] = matches
                    elif name == "url":
                        result["urls"] = matches
                    elif name == "email":
                        result["emails"] = matches
                    elif name == "status_code":
                        result["status_codes"] = [int(m) for m in matches]
            except re.error:
                continue
        # 确定严重程度
        if "error" in result["matches"]:
            result["severity"] = "error"
        elif "warning" in result["matches"]:
            result["severity"] = "warning"
        return result

    def analyze_file(self, filepath: str, max_lines: int = 10000) -> Dict[str, Any]:
        if not os.path.exists(filepath):
            return {"error": f"文件不存在: {filepath}"}
        results = {
            "filepath": filepath,
            "file_size": os.path.getsize(filepath),
            "total_lines": 0,
            "analyzed_lines": 0,
            "errors": 0,
            "warnings": 0,
            "info": 0,
            "ip_addresses": Counter(),
            "status_codes": Counter(),
            "urls": Counter(),
            "timestamps": [],
            "error_lines": [],
            "warning_lines": [],
            "pattern_matches": Counter(),
        }
        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                for i, line in enumerate(f):
                    results["total_lines"] += 1
                    if i >= max_lines:
                        continue
                    results["analyzed_lines"] += 1
                    analysis = self.analyze_line(line)
                    if analysis["severity"] == "error":
                        results["errors"] += 1
                        if len(results["error_lines"]) < 100:
                            results["error_lines"].append(line.strip()[:200])
                    elif analysis["severity"] == "warning":
                        results["warnings"] += 1
                        if len(results["warning_lines"]) < 100:
                            results["warning_lines"].append(line.strip()[:200])
                    else:
                        results["info"] += 1
                    for ip in analysis["ip_addresses"]:
                        results["ip_addresses"][ip] += 1
                    for code in analysis["status_codes"]:
                        results["status_codes"][code] += 1
                    for url in analysis["urls"]:
                        results["urls"][url] += 1
                    for pattern, count in analysis["matches"].items():
                        results["pattern_matches"][pattern] += count
        except Exception as e:
            results["error"] = str(e)
        # 转换Counter为dict
        results["ip_addresses"] = dict(results["ip_addresses"].most_common(20))
        results["status_codes"] = dict(results["status_codes"].most_common(20))
        results["urls"] = dict(results["urls"].most_common(20))
        results["pattern_matches"] = dict(results["pattern_matches"])
        return results

    def search_logs(self, directory: str, pattern: str,
                    file_pattern: str = "*.log",
                    max_results: int = 100) -> List[Dict[str, Any]]:
        results = []
        try:
            regex = re.compile(pattern, re.IGNORECASE)
        except re.error as e:
            return [{"error": f"无效正则: {e}"}]
        for root, dirs, files in os.walk(directory):
            for filename in files:
                if not self._match_file_pattern(filename, file_pattern):
                    continue
                filepath = os.path.join(root, filename)
                try:
                    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                        for i, line in enumerate(f, 1):
                            if regex.search(line):
                                results.append({
                                    "filepath": filepath,
                                    "line_number": i,
                                    "content": line.strip()[:300],
                                })
                                if len(results) >= max_results:
                                    return results
                except Exception:
                    continue
        return results

    def _match_file_pattern(self, filename: str, pattern: str) -> bool:
        import fnmatch
        return fnmatch.fnmatch(filename, pattern)

    def get_stats(self) -> Dict[str, Any]:
        return {
            "analyzer_id": self.analyzer_id,
            "patterns": len(self.patterns),
            "pattern_names": list(self.patterns.keys()),
        }
