"""
tools/tools_expansion.py - 工具集综合扩展模块

新增高级工具：网络侦察工具集、密码学工具集、数据处理工具集、
系统管理工具集、文件分析工具集、文本处理工具集。
"""
import os
import json
import time
import uuid
import math
import hashlib
import hmac
import base64
import socket
import struct
import threading
import subprocess
import re
from typing import Any, Dict, List, Optional, Tuple
from libertas.foundation.byte_stream import safe_decode
from collections import deque, Counter
from enum import Enum
from libertas.foundation.terminal import terminal


# ================================================================
# 网络侦察工具集
# ================================================================


class FileAnalysisTool:
    """文件分析工具"""

    def __init__(self):
        self.tool_id = f"fat_{uuid.uuid4().hex[:8]}"
        self.signatures = {
            b"\x89PNG": "PNG图片",
            b"\xff\xd8\xff": "JPEG图片",
            b"GIF87a": "GIF图片",
            b"GIF89a": "GIF图片",
            b"%PDF": "PDF文档",
            b"PK\x03\x04": "ZIP压缩包",
            b"PK\x05\x06": "ZIP压缩包(空)",
            b"\x1f\x8b": "GZIP压缩",
            b"\x42\x5a\x68": "BZIP2压缩",
            b"\x75\x73\x74\x61\x72": "TAR归档",
            b"MZ": "Windows可执行文件",
            b"\x7fELF": "Linux可执行文件",
            b"\xcf\xfa\xed\xfe": "macOS可执行文件",
            b"<?xml": "XML文档",
            b"{\\rtf": "RTF文档",
            b"ID3": "MP3音频",
            b"OggS": "OGG音频",
            b"RIFF": "WAV/AVI媒体",
            b"\x00\x00\x01\xba": "MPEG视频",
            b"\x00\x00\x01\xb3": "MPEG视频",
        }

    def detect_file_type(self, file_path: str) -> Dict[str, Any]:
        """检测文件类型"""
        result = {"file": file_path, "type": "unknown", "extension": "",
                  "size": 0, "magic_bytes": "", "error": ""}
        try:
            if not os.path.exists(file_path):
                result["error"] = "文件不存在"
                return result
            result["size"] = os.path.getsize(file_path)
            result["extension"] = os.path.splitext(file_path)[1].lower()
            with open(file_path, "rb") as f:
                header = f.read(16)
            result["magic_bytes"] = header.hex()
            for sig, ftype in self.signatures.items():
                if header.startswith(sig):
                    result["type"] = ftype
                    break
        except Exception as e:
            result["error"] = str(e)
        return result

    def analyze_text_file(self, file_path: str) -> Dict[str, Any]:
        """分析文本文件"""
        result = {"file": file_path, "lines": 0, "words": 0, "characters": 0,
                  "encoding": "", "line_endings": "", "error": ""}
        try:
            with open(file_path, "rb") as f:
                raw = f.read()
            # 检测编码
            for enc in ["utf-8", "gbk", "gb2312", "latin-1"]:
                try:
                    text = raw.decode(enc)
                    result["encoding"] = enc
                    break
                except UnicodeDecodeError:
                    continue
            if not result["encoding"]:
                text = raw.decode("latin-1", errors="replace")
                result["encoding"] = "unknown"
            result["lines"] = text.count("\n") + 1
            result["words"] = len(text.split())
            result["characters"] = len(text)
            if "\r\n" in text:
                result["line_endings"] = "CRLF (Windows)"
            elif "\n" in text:
                result["line_endings"] = "LF (Unix)"
            elif "\r" in text:
                result["line_endings"] = "CR (Mac)"
        except Exception as e:
            result["error"] = str(e)
        return result

    def calculate_entropy(self, file_path: str) -> Dict[str, Any]:
        """计算文件熵（检测加密/压缩）"""
        result = {"file": file_path, "entropy": 0.0, "entropy_level": "", "error": ""}
        try:
            with open(file_path, "rb") as f:
                data = f.read()
            if not data:
                return result
            byte_counts = Counter(data)
            total = len(data)
            entropy = 0.0
            for count in byte_counts.values():
                p = count / total
                entropy -= p * math.log2(p)
            result["entropy"] = round(entropy, 4)
            if entropy < 3:
                result["entropy_level"] = "低（可能是文本/未压缩）"
            elif entropy < 6:
                result["entropy_level"] = "中（可能是结构化数据）"
            elif entropy < 7.5:
                result["entropy_level"] = "高（可能是压缩/加密）"
            else:
                result["entropy_level"] = "极高（很可能是加密）"
        except Exception as e:
            result["error"] = str(e)
        return result

    def find_duplicates(self, directory: str,
                         hash_algorithm: str = "md5") -> Dict[str, List[str]]:
        """查找重复文件"""
        hash_map = {}
        duplicates = {}
        for root, dirs, files in os.walk(directory):
            for f in files:
                path = os.path.join(root, f)
                try:
                    with open(path, "rb") as fh:
                        file_hash = hashlib.new(hash_algorithm, fh.read()).hexdigest()
                    if file_hash in hash_map:
                        if file_hash not in duplicates:
                            duplicates[file_hash] = [hash_map[file_hash]]
                        duplicates[file_hash].append(path)
                    else:
                        hash_map[file_hash] = path
                except Exception:
                    continue
        return duplicates

    def get_stats(self) -> Dict[str, Any]:
        return {
            "tool_id": self.tool_id,
            "known_signatures": len(self.signatures),
        }
