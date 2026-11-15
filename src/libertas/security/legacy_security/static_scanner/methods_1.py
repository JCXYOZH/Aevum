"""
security/static_scanner.py - 静态代码漏洞扫描器

核心能力：
- 扫描源代码文件中的漏洞模式
- 支持Python、JavaScript、Java、PHP、C/C++等多语言
- 检测SQL注入、XSS、命令注入、硬编码凭证、路径遍历、SSRF、
  不安全反序列化、弱加密、XXE、开放重定向等漏洞
- 基础数据流分析（source到sink追踪）
- 漏洞报告生成（JSON/Markdown/HTML）
- 与Codebase模块集成，支持整个项目扫描
"""
import os
import re
import sys
import json
import time
import uuid
import ast
import hashlib
import threading
from typing import Any, Dict, List, Optional, Tuple, Set, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict, Counter


# ================================================================
# 枚举和数据结构
# ================================================================
from .models import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403

class VulnPatternLibraryPart1(object):
    def __init__(self):
        self.patterns = self._init_patterns()
    def _init_patterns(self) -> Dict[str, List[Dict]]:
        """初始化所有漏洞模式"""
        return {
            "python": self._python_patterns(),
            "javascript": self._javascript_patterns(),
            "java": self._java_patterns(),
            "php": self._php_patterns(),
            "c_cpp": self._c_cpp_patterns(),
            "ruby": self._ruby_patterns(),
            "go": self._go_patterns(),
            "generic": self._generic_patterns(),
        }
    def _python_patterns(self) -> List[Dict]:
        """Python漏洞模式"""
        return [
            {
                "id": "py_sqli_001",
                "type": "sql_injection",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""execute\s*\(\s*["'].*?%s.*?["']\s*%""",
                "description": "SQL字符串格式化注入（%s拼接）",
                "cwe": "CWE-89",
                "remediation": "使用参数化查询：cursor.execute(sql, params)",
            },
            {
                "id": "py_sqli_002",
                "type": "sql_injection",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""execute\s*\(\s*f["'].*?\{.*?\}.*?["']""",
                "description": "SQL f-string拼接注入",
                "cwe": "CWE-89",
                "remediation": "使用参数化查询",
            },
            {
                "id": "py_sqli_003",
                "type": "sql_injection",
                "severity": "critical",
                "confidence": "medium",
                "pattern": r"""execute\s*\(\s*["'].*?\+\s*\w+""",
                "description": "SQL字符串拼接注入",
                "cwe": "CWE-89",
                "remediation": "使用参数化查询",
            },
            {
                "id": "py_cmd_001",
                "type": "command_injection",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""os\.system\s*\(\s*[^)]*\+""",
                "description": "os.system命令注入（字符串拼接）",
                "cwe": "CWE-78",
                "remediation": "使用subprocess.run(args, shell=False)",
            },
            {
                "id": "py_cmd_002",
                "type": "command_injection",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""subprocess\.\w+\s*\([^)]*shell\s*=\s*True""",
                "description": "subprocess shell=True命令注入",
                "cwe": "CWE-78",
                "remediation": "设置shell=False并使用参数列表",
            },
            {
                "id": "py_cmd_003",
                "type": "command_injection",
                "severity": "critical",
                "confidence": "medium",
                "pattern": r"""os\.popen\s*\(\s*[^)]*\+""",
                "description": "os.popen命令注入",
                "cwe": "CWE-78",
                "remediation": "使用subprocess模块",
            },
            {
                "id": "py_xss_001",
                "type": "xss",
                "severity": "high",
                "confidence": "medium",
                "pattern": r"""mark_safe\s*\(\s*[^)]*request""",
                "description": "Django mark_safe与用户输入组合导致XSS",
                "cwe": "CWE-79",
                "remediation": "对用户输入进行HTML转义",
            },
            {
                "id": "py_xss_002",
                "type": "xss",
                "severity": "high",
                "confidence": "medium",
                "pattern": r"""HttpResponse\s*\(\s*[^)]*request\.\w+""",
                "description": "HttpResponse直接输出用户输入导致XSS",
                "cwe": "CWE-79",
                "remediation": "使用模板引擎自动转义",
            },
            {
                "id": "py_path_001",
                "type": "path_traversal",
                "severity": "high",
                "confidence": "medium",
                "pattern": r"""open\s*\(\s*[^)]*request\.\w+""",
                "description": "文件路径使用用户输入导致路径遍历",
                "cwe": "CWE-22",
                "remediation": "使用os.path.normpath和白名单验证",
            },
            {
                "id": "py_ssrf_001",
                "type": "ssrf",
                "severity": "high",
                "confidence": "medium",
                "pattern": r"""requests\.\w+\s*\(\s*[^)]*request\.\w+""",
                "description": "requests库使用用户输入URL导致SSRF",
                "cwe": "CWE-918",
                "remediation": "对目标URL进行白名单验证",
            },
            {
                "id": "py_deser_001",
                "type": "insecure_deserialization",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""pickle\.loads?\s*\(\s*[^)]*request""",
                "description": "pickle反序列化用户输入导致RCE",
                "cwe": "CWE-502",
                "remediation": "使用JSON等安全格式，禁止反序列化不可信数据",
            },
            {
                "id": "py_deser_002",
                "type": "insecure_deserialization",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""yaml\.load\s*\(\s*[^)]*request""",
                "description": "yaml.load反序列化用户输入",
                "cwe": "CWE-502",
                "remediation": "使用yaml.safe_load",
            },
            {
                "id": "py_crypto_001",
                "type": "weak_crypto",
                "severity": "medium",
                "confidence": "high",
                "pattern": r"""hashlib\.md5\s*\(""",
                "description": "使用MD5弱哈希算法",
                "cwe": "CWE-327",
                "remediation": "使用SHA-256或更强的算法",
            },
            {
                "id": "py_crypto_002",
                "type": "weak_crypto",
                "severity": "medium",
                "confidence": "high",
                "pattern": r"""hashlib\.sha1\s*\(""",
                "description": "使用SHA-1弱哈希算法",
                "cwe": "CWE-327",
                "remediation": "使用SHA-256或更强的算法",
            },
            {
                "id": "py_crypto_003",
                "type": "weak_crypto",
                "severity": "high",
                "confidence": "high",
                "pattern": r"""DES\s*\(|AES\.new\s*\([^)]*ECB""",
                "description": "使用DES或ECB模式弱加密",
                "cwe": "CWE-327",
                "remediation": "使用AES-GCM或ChaCha20",
            },
            {
                "id": "py_random_001",
                "type": "insecure_random",
                "severity": "medium",
                "confidence": "high",
                "pattern": r"""random\.\w+\s*\(\s*\)""",
                "description": "使用random模块生成安全随机数",
                "cwe": "CWE-330",
                "remediation": "使用secrets模块",
            },
            {
                "id": "py_creds_001",
                "type": "hardcoded_credentials",
                "severity": "high",
                "confidence": "medium",
                "pattern": r"""password\s*=\s*["'][^"']{3,}["']""",
                "description": "硬编码密码",
                "cwe": "CWE-798",
                "remediation": "使用环境变量或密钥管理服务",
            },
            {
                "id": "py_creds_002",
                "type": "hardcoded_credentials",
                "severity": "high",
                "confidence": "medium",
                "pattern": r"""api_key\s*=\s*["'][^"']{8,}["']""",
                "description": "硬编码API密钥",
                "cwe": "CWE-798",
                "remediation": "使用环境变量或密钥管理服务",
            },
            {
                "id": "py_creds_003",
                "type": "hardcoded_credentials",
                "severity": "high",
                "confidence": "medium",
                "pattern": r"""secret\s*=\s*["'][^"']{8,}["']""",
                "description": "硬编码密钥",
                "cwe": "CWE-798",
                "remediation": "使用环境变量或密钥管理服务",
            },
            {
                "id": "py_creds_004",
                "type": "hardcoded_credentials",
                "severity": "high",
                "confidence": "high",
                "pattern": r"""token\s*=\s*["'][A-Za-z0-9_\-]{20,}["']""",
                "description": "硬编码Token",
                "cwe": "CWE-798",
                "remediation": "使用环境变量或密钥管理服务",
            },
            {
                "id": "py_debug_001",
                "type": "debug_code",
                "severity": "low",
                "confidence": "high",
                "pattern": r"""DEBUG\s*=\s*True""",
                "description": "调试模式开启",
                "cwe": "CWE-489",
                "remediation": "生产环境关闭DEBUG模式",
            },
            {
                "id": "py_eval_001",
                "type": "code_execution",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""eval\s*\(\s*[^)]*request""",
                "description": "eval执行用户输入导致代码执行",
                "cwe": "CWE-95",
                "remediation": "禁止使用eval，使用ast.literal_eval",
            },
            {
                "id": "py_eval_002",
                "type": "code_execution",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""exec\s*\(\s*[^)]*request""",
                "description": "exec执行用户输入导致代码执行",
                "cwe": "CWE-95",
                "remediation": "禁止使用exec执行不可信代码",
            },
        ]
    def _javascript_patterns(self) -> List[Dict]:
        """JavaScript漏洞模式"""
        return [
            {
                "id": "js_xss_001",
                "type": "xss",
                "severity": "high",
                "confidence": "high",
                "pattern": r"""innerHTML\s*=\s*[^;]*req\.\w+""",
                "description": "innerHTML直接赋值用户输入导致XSS",
                "cwe": "CWE-79",
                "remediation": "使用textContent或DOM API",
            },
            {
                "id": "js_xss_002",
                "type": "xss",
                "severity": "high",
                "confidence": "high",
                "pattern": r"""document\.write\s*\(\s*[^)]*req\.\w+""",
                "description": "document.write输出用户输入导致XSS",
                "cwe": "CWE-79",
                "remediation": "使用安全的DOM操作",
            },
            {
                "id": "js_sqli_001",
                "type": "sql_injection",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""query\s*\(\s*`[^`]*\$\{[^}]*\}""",
                "description": "SQL模板字符串拼接注入",
                "cwe": "CWE-89",
                "remediation": "使用参数化查询",
            },
            {
                "id": "js_cmd_001",
                "type": "command_injection",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""exec\s*\(\s*[^)]*\+\s*req""",
                "description": "child_process.exec命令注入",
                "cwe": "CWE-78",
                "remediation": "使用execFile或spawn",
            },
            {
                "id": "js_creds_001",
                "type": "hardcoded_credentials",
                "severity": "high",
                "confidence": "medium",
                "pattern": r"""password\s*[:=]\s*["'][^"']{3,}["']""",
                "description": "硬编码密码",
                "cwe": "CWE-798",
                "remediation": "使用环境变量",
            },
            {
                "id": "js_eval_001",
                "type": "code_execution",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""eval\s*\(\s*[^)]*req\.\w+""",
                "description": "eval执行用户输入",
                "cwe": "CWE-95",
                "remediation": "禁止使用eval",
            },
            {
                "id": "js_cors_001",
                "type": "cors_misconfiguration",
                "severity": "medium",
                "confidence": "high",
                "pattern": r"""Access-Control-Allow-Origin["']?\s*[:=]\s*["']\*["']""",
                "description": "CORS允许任意来源",
                "cwe": "CWE-942",
                "remediation": "限制允许的来源",
            },
        ]
