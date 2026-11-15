"""
security/vuln_detector.py - 漏洞探测与验证引擎

核心能力：
- 自动发送payload到目标的多个注入点（URL参数、POST数据、Header、Cookie）
- 分析响应判断漏洞是否存在（状态码、内容、时间延迟、错误信息、特定模式）
- 漏洞验证（确认漏洞真实存在，排除误报）
- 支持SQL注入、XSS、命令注入、目录遍历、SSRF、文件上传、CRLF、SSTI等漏洞类型
- 扫描报告生成
"""
import os
import re
import sys
import json
import time
import uuid
import socket
import hashlib
import threading
import urllib.parse
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Tuple, Set, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict


# ================================================================
# 漏洞类型和严重程度枚举
# ================================================================
from .models import *  # noqa: F401,F403
from .http_client import *  # noqa: F401,F403

class ResponseAnalyzer:
    """响应分析器 - 通过多种技术判断漏洞是否存在"""

    def __init__(self):
        self.sql_error_patterns = self._init_sql_error_patterns()
        self.xss_reflection_patterns = self._init_xss_patterns()
        self.command_output_patterns = self._init_command_patterns()
        self.file_content_patterns = self._init_file_patterns()
        self.baseline_cache: Dict[str, ScanResponse] = {}

    def _init_sql_error_patterns(self) -> List[Dict]:
        """SQL错误模式"""
        return [
            {"pattern": r"SQL syntax.*MySQL", "database": "MySQL", "regex": True},
            {"pattern": r"Warning.*mysql_.*", "database": "MySQL", "regex": True},
            {"pattern": r"MySQLSyntaxErrorException", "database": "MySQL", "regex": True},
            {"pattern": r"valid MySQL result", "database": "MySQL", "regex": True},
            {"pattern": r"PostgreSQL.*ERROR", "database": "PostgreSQL", "regex": True},
            {"pattern": r"Warning.*pg_.*", "database": "PostgreSQL", "regex": True},
            {"pattern": r"org.postgresql.util.PSQLException", "database": "PostgreSQL", "regex": True},
            {"pattern": r"Microsoft SQL Server.*Driver", "database": "MSSQL", "regex": True},
            {"pattern": r"ODBC SQL Server Driver", "database": "MSSQL", "regex": True},
            {"pattern": r"System.Data.SqlClient.SqlException", "database": "MSSQL", "regex": True},
            {"pattern": r"ORA-\d{5}", "database": "Oracle", "regex": True},
            {"pattern": r"Oracle error", "database": "Oracle", "regex": True},
            {"pattern": r"java.sql.SQLException", "database": "Java", "regex": True},
            {"pattern": r"SQLite/JDBCDriver", "database": "SQLite", "regex": True},
            {"pattern": r"sqlite3.OperationalError", "database": "SQLite", "regex": True},
            {"pattern": r"unclosed quotation mark", "database": "Generic", "regex": True},
            {"pattern": r"quoted string not properly terminated", "database": "Generic", "regex": True},
            {"pattern": r"you have an error in your SQL syntax", "database": "MySQL", "regex": True, "ignore_case": True},
        ]

    def _init_xss_patterns(self) -> List[Dict]:
        """XSS反射模式"""
        return [
            {"pattern": "<script>alert", "description": "script标签反射", "regex": False},
            {"pattern": "<img src=x onerror", "description": "img事件反射", "regex": False},
            {"pattern": "<svg onload", "description": "svg事件反射", "regex": False},
            {"pattern": "javascript:alert", "description": "javascript伪协议", "regex": False},
            {"pattern": "onerror=alert", "description": "onerror事件", "regex": False},
            {"pattern": "onload=alert", "description": "onload事件", "regex": False},
        ]

    def _init_command_patterns(self) -> List[Dict]:
        """命令执行输出模式"""
        return [
            {"pattern": r"uid=\d+\([^)]+\)", "description": "id命令输出", "regex": True},
            {"pattern": r"root:x:0:0", "description": "/etc/passwd内容", "regex": False},
            {"pattern": r"Linux version \d", "description": "uname输出", "regex": True},
            {"pattern": r"[a-zA-Z0-9_]+\\[a-zA-Z0-9_]+", "description": "whoami输出", "regex": True},
        ]

    def _init_file_patterns(self) -> List[Dict]:
        """文件内容模式"""
        return [
            {"pattern": "root:x:0:0:root", "description": "/etc/passwd", "regex": False},
            {"pattern": "[extensions]", "description": "php.ini", "regex": False},
            {"pattern": "; for 16-bit app support", "description": "win.ini", "regex": False},
            {"pattern": "boot loader", "description": "grub.conf", "regex": False},
            {"pattern": "NAME=", "description": "os-release", "regex": False},
        ]

    def set_baseline(self, url: str, response: ScanResponse):
        """设置基线响应（用于对比分析）"""
        self.baseline_cache[url] = response

    def get_baseline(self, url: str) -> Optional[ScanResponse]:
        """获取基线响应"""
        return self.baseline_cache.get(url)

    def analyze_sql_injection(self, request: ScanRequest, response: ScanResponse,
                                baseline: Optional[ScanResponse] = None) -> Dict:
        """分析SQL注入"""
        result = {"vulnerable": False, "technique": "", "evidence": "", "confidence": "low"}

        # 1. 错误-based检测
        for pattern_info in self.sql_error_patterns:
            pattern = pattern_info["pattern"]
            if pattern_info.get("regex"):
                flags = re.IGNORECASE if pattern_info.get("ignore_case") else 0
                if re.search(pattern, response.body, flags):
                    result["vulnerable"] = True
                    result["technique"] = "error_based"
                    result["evidence"] = f"数据库错误: {pattern_info['database']} - 匹配模式: {pattern[:50]}"
                    result["confidence"] = "high"
                    return result
            else:
                if pattern.lower() in response.body.lower():
                    result["vulnerable"] = True
                    result["technique"] = "error_based"
                    result["evidence"] = f"数据库错误: {pattern_info['database']}"
                    result["confidence"] = "high"
                    return result

        # 2. 布尔-based检测（需要基线对比）
        if baseline and request.payload:
            # 如果payload包含OR '1'='1且响应长度明显大于基线
            if "OR '1'='1" in request.payload or "OR 1=1" in request.payload:
                if response.body_length > baseline.body_length * 1.2:
                    result["vulnerable"] = True
                    result["technique"] = "boolean_based"
                    result["evidence"] = f"布尔真响应长度({response.body_length}) > 基线({baseline.body_length})"
                    result["confidence"] = "medium"
                    return result
            # 如果payload包含OR '1'='2且响应长度明显小于基线
            if "OR '1'='2" in request.payload or "OR 1=2" in request.payload:
                if response.body_length < baseline.body_length * 0.8:
                    result["vulnerable"] = True
                    result["technique"] = "boolean_based"
                    result["evidence"] = f"布尔假响应长度({response.body_length}) < 基线({baseline.body_length})"
                    result["confidence"] = "medium"
                    return result

        # 3. 时间-based检测
        if request.payload and ("SLEEP" in request.payload.upper() or "WAITFOR" in request.payload.upper()):
            if response.response_time > 3000:  # 超过3秒
                result["vulnerable"] = True
                result["technique"] = "time_based"
                result["evidence"] = f"响应时间{response.response_time:.0f}ms > 3000ms阈值"
                result["confidence"] = "high"
                return result

        return result

    def analyze_xss(self, request: ScanRequest, response: ScanResponse) -> Dict:
        """分析XSS"""
        result = {"vulnerable": False, "technique": "", "evidence": "", "confidence": "low"}

        for pattern_info in self.xss_reflection_patterns:
            pattern = pattern_info["pattern"]
            if pattern.lower() in response.body.lower():
                result["vulnerable"] = True
                result["technique"] = "reflected"
                result["evidence"] = f"Payload反射: {pattern_info['description']}"
                result["confidence"] = "high"
                return result

        # 检查payload是否原样反射
        if request.payload and request.payload in response.body:
            result["vulnerable"] = True
            result["technique"] = "reflected"
            result["evidence"] = f"Payload原样反射在响应中"
            result["confidence"] = "medium"

        return result

    def analyze_command_injection(self, request: ScanRequest, response: ScanResponse) -> Dict:
        """分析命令注入"""
        result = {"vulnerable": False, "technique": "", "evidence": "", "confidence": "low"}

        # 1. 内容匹配
        for pattern_info in self.command_output_patterns:
            pattern = pattern_info["pattern"]
            if pattern_info.get("regex"):
                if re.search(pattern, response.body):
                    result["vulnerable"] = True
                    result["technique"] = "result_based"
                    result["evidence"] = f"命令输出匹配: {pattern_info['description']}"
                    result["confidence"] = "high"
                    return result
            else:
                if pattern in response.body:
                    result["vulnerable"] = True
                    result["technique"] = "result_based"
                    result["evidence"] = f"命令输出匹配: {pattern_info['description']}"
                    result["confidence"] = "high"
                    return result

        # 2. 时间延迟
        if request.payload and "sleep" in request.payload.lower():
            if response.response_time > 3000:
                result["vulnerable"] = True
                result["technique"] = "time_based"
                result["evidence"] = f"响应时间{response.response_time:.0f}ms > 3000ms"
                result["confidence"] = "high"
                return result

        return result

    def analyze_directory_traversal(self, request: ScanRequest, response: ScanResponse) -> Dict:
        """分析目录遍历"""
        result = {"vulnerable": False, "technique": "", "evidence": "", "confidence": "low"}

        for pattern_info in self.file_content_patterns:
            if pattern_info["pattern"] in response.body:
                result["vulnerable"] = True
                result["technique"] = "file_read"
                result["evidence"] = f"文件内容匹配: {pattern_info['description']}"
                result["confidence"] = "high"
                return result

        return result

    def analyze_ssti(self, request: ScanRequest, response: ScanResponse) -> Dict:
        """分析SSTI"""
        result = {"vulnerable": False, "technique": "", "evidence": "", "confidence": "low"}

        # {{7*7}} → 49
        if "{{7*7}}" in request.payload and "49" in response.body:
            result["vulnerable"] = True
            result["technique"] = "expression_eval"
            result["evidence"] = "{{7*7}} 被计算为 49"
            result["confidence"] = "high"
            return result

        # ${7*7} → 49
        if "${7*7}" in request.payload and "49" in response.body:
            result["vulnerable"] = True
            result["technique"] = "el_expression"
            result["evidence"] = "${{7*7}} 被计算为 49"
            result["confidence"] = "high"
            return result

        return result

    def analyze_ssrf(self, request: ScanRequest, response: ScanResponse) -> Dict:
        """分析SSRF"""
        result = {"vulnerable": False, "technique": "", "evidence": "", "confidence": "low"}

        # 检查响应是否包含内部服务特征
        if "169.254.169.254" in request.payload:
            if response.status_code == 200 and response.body_length > 0:
                if "ami-id" in response.body or "instance-id" in response.body or "local-ipv4" in response.body:
                    result["vulnerable"] = True
                    result["technique"] = "cloud_metadata"
                    result["evidence"] = "云元数据响应包含实例信息"
                    result["confidence"] = "high"
                    return result

        if "127.0.0.1" in request.payload or "localhost" in request.payload:
            if response.status_code == 200 and response.body_length > 0:
                result["vulnerable"] = True
                result["technique"] = "loopback_access"
                result["evidence"] = f"成功访问本地服务，响应长度{response.body_length}"
                result["confidence"] = "medium"
                return result

        return result

    def analyze_generic(self, request: ScanRequest, response: ScanResponse,
                        vuln_type: str, baseline: Optional[ScanResponse] = None) -> Dict:
        """通用分析入口"""
        analyzers = {
            "sql_injection": self.analyze_sql_injection,
            "xss": self.analyze_xss,
            "command_injection": self.analyze_command_injection,
            "directory_traversal": self.analyze_directory_traversal,
            "ssti": self.analyze_ssti,
            "ssrf": self.analyze_ssrf,
        }
        analyzer = analyzers.get(vuln_type)
        if analyzer:
            if vuln_type == "sql_injection":
                return analyzer(request, response, baseline)
            return analyzer(request, response)
        return {"vulnerable": False, "technique": "", "evidence": "", "confidence": "low"}
