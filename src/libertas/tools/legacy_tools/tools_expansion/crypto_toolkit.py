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


class CryptoToolkit:
    """密码学工具集"""

    def __init__(self):
        self.tool_id = f"ct_{uuid.uuid4().hex[:8]}"
        self.hash_algorithms = ["md5", "sha1", "sha256", "sha512", "sha3_256", "blake2b"]
        self.encoding_formats = ["base64", "hex", "url", "html"]

    def hash_text(self, text: str, algorithm: str = "sha256") -> Dict[str, Any]:
        """文本哈希"""
        result = {"algorithm": algorithm, "input_length": len(text), "hash": "", "error": ""}
        try:
            if algorithm == "md5":
                result["hash"] = hashlib.md5(text.encode()).hexdigest()
            elif algorithm == "sha1":
                result["hash"] = hashlib.sha1(text.encode()).hexdigest()
            elif algorithm == "sha256":
                result["hash"] = hashlib.sha256(text.encode()).hexdigest()
            elif algorithm == "sha512":
                result["hash"] = hashlib.sha512(text.encode()).hexdigest()
            elif algorithm == "sha3_256":
                result["hash"] = hashlib.sha3_256(text.encode()).hexdigest()
            elif algorithm == "blake2b":
                result["hash"] = hashlib.blake2b(text.encode()).hexdigest()
            else:
                result["error"] = f"不支持的算法: {algorithm}"
        except Exception as e:
            result["error"] = str(e)
        return result

    def hash_file(self, file_path: str, algorithm: str = "sha256",
                  chunk_size: int = 8192) -> Dict[str, Any]:
        """文件哈希"""
        result = {"algorithm": algorithm, "file": file_path, "hash": "",
                  "file_size": 0, "error": ""}
        try:
            if not os.path.exists(file_path):
                result["error"] = "文件不存在"
                return result
            result["file_size"] = os.path.getsize(file_path)
            hasher = hashlib.new(algorithm)
            with open(file_path, "rb") as f:
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    hasher.update(chunk)
            result["hash"] = hasher.hexdigest()
        except Exception as e:
            result["error"] = str(e)
        return result

    def hmac_sign(self, message: str, key: str,
                   algorithm: str = "sha256") -> Dict[str, Any]:
        """HMAC 签名"""
        result = {"algorithm": algorithm, "signature": "", "error": ""}
        try:
            result["signature"] = hmac.new(
                key.encode(), message.encode(), algorithm
            ).hexdigest()
        except Exception as e:
            result["error"] = str(e)
        return result

    def hmac_verify(self, message: str, key: str, signature: str,
                    algorithm: str = "sha256") -> bool:
        """HMAC 验证"""
        try:
            expected = hmac.new(
                key.encode(), message.encode(), algorithm
            ).hexdigest()
            return hmac.compare_digest(expected, signature)
        except Exception:
            return False

    def base64_encode(self, text: str) -> str:
        return base64.b64encode(text.encode()).decode()

    def base64_decode(self, encoded: str) -> str:
        # 解出来的可能是任意字节（非 UTF-8）：无参 .decode() 固定按 UTF-8 解，
        # 会抛 UnicodeDecodeError（同"默认编码"缺陷族）。统一走 safe_decode
        # （级联解码，永不抛；合法 UTF-8 输入结果与改前逐字一致）。
        return safe_decode(base64.b64decode(encoded.encode()))

    def hex_encode(self, text: str) -> str:
        return text.encode().hex()

    def hex_decode(self, hex_str: str) -> str:
        # 同上：十六进制还原出来的可能是非 UTF-8 字节
        return safe_decode(bytes.fromhex(hex_str))

    def url_encode(self, text: str) -> str:
        import urllib.parse
        return urllib.parse.quote(text)

    def url_decode(self, encoded: str) -> str:
        import urllib.parse
        return urllib.parse.unquote(encoded)

    def generate_password(self, length: int = 16,
                          include_upper: bool = True,
                          include_lower: bool = True,
                          include_digits: bool = True,
                          include_symbols: bool = True) -> str:
        """生成安全密码"""
        import secrets
        import string
        chars = ""
        if include_upper:
            chars += string.ascii_uppercase
        if include_lower:
            chars += string.ascii_lowercase
        if include_digits:
            chars += string.digits
        if include_symbols:
            chars += "!@#$%^&*()_+-=[]{}|;:,.<>?"
        if not chars:
            chars = string.ascii_letters
        return "".join(secrets.choice(chars) for _ in range(length))

    def password_strength(self, password: str) -> Dict[str, Any]:
        """密码强度评估"""
        score = 0
        feedback = []
        length = len(password)
        if length >= 8:
            score += 1
        if length >= 12:
            score += 1
        if length >= 16:
            score += 1
        if any(c.isupper() for c in password):
            score += 1
        if any(c.islower() for c in password):
            score += 1
        if any(c.isdigit() for c in password):
            score += 1
        if any(not c.isalnum() for c in password):
            score += 1
        # 常见弱密码检查
        weak_passwords = {"password", "123456", "admin", "qwerty", "letmein", "welcome"}
        if password.lower() in weak_passwords:
            score = 0
            feedback.append("常见弱密码")
        if score <= 2:
            strength = "极弱"
        elif score <= 4:
            strength = "弱"
        elif score <= 6:
            strength = "中等"
        elif score <= 7:
            strength = "强"
        else:
            strength = "极强"
        return {
            "score": score,
            "max_score": 8,
            "strength": strength,
            "length": length,
            "has_upper": any(c.isupper() for c in password),
            "has_lower": any(c.islower() for c in password),
            "has_digits": any(c.isdigit() for c in password),
            "has_symbols": any(not c.isalnum() for c in password),
            "feedback": feedback,
        }

    def get_stats(self) -> Dict[str, Any]:
        return {
            "tool_id": self.tool_id,
            "supported_hashes": self.hash_algorithms,
            "supported_encodings": self.encoding_formats,
        }
