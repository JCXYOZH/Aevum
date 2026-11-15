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
from .methods_1 import *  # noqa: F401,F403

class VulnPatternLibraryPart2(object):
    def _java_patterns(self) -> List[Dict]:
        """Java漏洞模式"""
        return [
            {
                "id": "java_sqli_001",
                "type": "sql_injection",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""Statement\s+\w+\s*=.*executeQuery\s*\(\s*[^)]*\+""",
                "description": "JDBC Statement字符串拼接SQL注入",
                "cwe": "CWE-89",
                "remediation": "使用PreparedStatement",
            },
            {
                "id": "java_cmd_001",
                "type": "command_injection",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""Runtime\.getRuntime\(\)\.exec\s*\(\s*[^)]*\+""",
                "description": "Runtime.exec命令注入",
                "cwe": "CWE-78",
                "remediation": "使用参数数组，禁止字符串拼接",
            },
            {
                "id": "java_xss_001",
                "type": "xss",
                "severity": "high",
                "confidence": "medium",
                "pattern": r"""out\.print\s*\(\s*[^)]*request\.getParameter""",
                "description": "JSP直接输出参数导致XSS",
                "cwe": "CWE-79",
                "remediation": "使用JSTL fn:escapeXml",
            },
            {
                "id": "java_deser_001",
                "type": "insecure_deserialization",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""ObjectInputStream\s*\(\s*[^)]*request""",
                "description": "Java反序列化用户输入",
                "cwe": "CWE-502",
                "remediation": "使用白名单反序列化或JSON",
            },
            {
                "id": "java_xxe_001",
                "type": "xxe",
                "severity": "high",
                "confidence": "high",
                "pattern": r"""DocumentBuilderFactory\s*\(.*setFeature.*false""",
                "description": "XML解析未禁用外部实体导致XXE",
                "cwe": "CWE-611",
                "remediation": "设置disallow-doctype-decl为true",
            },
            {
                "id": "java_creds_001",
                "type": "hardcoded_credentials",
                "severity": "high",
                "confidence": "medium",
                "pattern": r'String\s+password\s*=\s*"[^"]{3,}"',
                "description": "硬编码密码",
                "cwe": "CWE-798",
                "remediation": "使用配置文件或环境变量",
            },
        ]
    def _php_patterns(self) -> List[Dict]:
        """PHP漏洞模式"""
        return [
            {
                "id": "php_sqli_001",
                "type": "sql_injection",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""mysql_query\s*\(\s*[^)]*\$_(GET|POST|REQUEST)""",
                "description": "mysql_query直接使用用户输入导致SQL注入",
                "cwe": "CWE-89",
                "remediation": "使用mysqli或PDO参数化查询",
            },
            {
                "id": "php_xss_001",
                "type": "xss",
                "severity": "high",
                "confidence": "high",
                "pattern": r"""echo\s+\$_(GET|POST|REQUEST)""",
                "description": "echo直接输出用户输入导致XSS",
                "cwe": "CWE-79",
                "remediation": "使用htmlspecialchars()",
            },
            {
                "id": "php_cmd_001",
                "type": "command_injection",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""(system|exec|shell_exec|passthru|popen)\s*\(\s*[^)]*\$_(GET|POST|REQUEST)""",
                "description": "命令执行函数使用用户输入",
                "cwe": "CWE-78",
                "remediation": "使用escapeshellarg()",
            },
            {
                "id": "php_path_001",
                "type": "path_traversal",
                "severity": "high",
                "confidence": "high",
                "pattern": r"""(include|require|fopen|file_get_contents)\s*\(\s*[^)]*\$_(GET|POST|REQUEST)""",
                "description": "文件操作使用用户输入导致路径遍历/LFI",
                "cwe": "CWE-22",
                "remediation": "使用白名单和basename()",
            },
            {
                "id": "php_creds_001",
                "type": "hardcoded_credentials",
                "severity": "high",
                "confidence": "medium",
                "pattern": r"""\$password\s*=\s*["'][^"']{3,}["']""",
                "description": "硬编码密码",
                "cwe": "CWE-798",
                "remediation": "使用环境变量",
            },
            {
                "id": "php_eval_001",
                "type": "code_execution",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""eval\s*\(\s*[^)]*\$_(GET|POST|REQUEST)""",
                "description": "eval执行用户输入",
                "cwe": "CWE-95",
                "remediation": "禁止使用eval",
            },
        ]
    def _c_cpp_patterns(self) -> List[Dict]:
        """C/C++漏洞模式"""
        return [
            {
                "id": "c_buffer_001",
                "type": "buffer_overflow",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""(strcpy|strcat|sprintf|gets)\s*\(""",
                "description": "使用不安全的字符串函数导致缓冲区溢出",
                "cwe": "CWE-120",
                "remediation": "使用strncpy、strncat、snprintf、fgets",
            },
            {
                "id": "c_format_001",
                "type": "format_string",
                "severity": "high",
                "confidence": "high",
                "pattern": r"""(printf|fprintf|sprintf|snprintf)\s*\(\s*\w+\s*\)""",
                "description": "格式化字符串漏洞（用户输入作为格式串）",
                "cwe": "CWE-134",
                "remediation": "使用固定格式字符串：printf(\"%s\", user_input)",
            },
            {
                "id": "c_creds_001",
                "type": "hardcoded_credentials",
                "severity": "high",
                "confidence": "medium",
                "pattern": r'char\s+\w*password\w*\s*\[\s*\d+\s*\]\s*=\s*"[^"]{3,}"',
                "description": "硬编码密码",
                "cwe": "CWE-798",
                "remediation": "使用配置文件",
            },
            {
                "id": "c_crypto_001",
                "type": "weak_crypto",
                "severity": "medium",
                "confidence": "high",
                "pattern": r"""MD5_Init|MD5_Update|MD5_Final|SHA1_Init""",
                "description": "使用弱哈希算法",
                "cwe": "CWE-327",
                "remediation": "使用SHA-256或更强算法",
            },
            {
                "id": "c_random_001",
                "type": "insecure_random",
                "severity": "medium",
                "confidence": "high",
                "pattern": r"""\brand\s*\(\s*\)""",
                "description": "使用rand()生成安全随机数",
                "cwe": "CWE-330",
                "remediation": "使用/dev/urandom或arc4random",
            },
        ]
    def _ruby_patterns(self) -> List[Dict]:
        """Ruby漏洞模式"""
        return [
            {
                "id": "rb_sqli_001",
                "type": "sql_injection",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""\.where\s*\(\s*["'][^"']*#\{[^}]*\}""",
                "description": "Rails where字符串插值SQL注入",
                "cwe": "CWE-89",
                "remediation": "使用参数化查询：where(\"col = ?\", value)",
            },
            {
                "id": "rb_cmd_001",
                "type": "command_injection",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""system\s*\(\s*[^)]*#\{[^}]*\}""",
                "description": "system命令注入",
                "cwe": "CWE-78",
                "remediation": "使用数组形式：system(cmd, arg1, arg2)",
            },
            {
                "id": "rb_eval_001",
                "type": "code_execution",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""eval\s*\(\s*params""",
                "description": "eval执行用户输入",
                "cwe": "CWE-95",
                "remediation": "禁止使用eval",
            },
        ]
    def _go_patterns(self) -> List[Dict]:
        """Go漏洞模式"""
        return [
            {
                "id": "go_sqli_001",
                "type": "sql_injection",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""fmt\.Sprintf\s*\(\s*"[^"]*%s[^"]*"\s*,\s*[^)]*r\.""",
                "description": "SQL查询使用fmt.Sprintf拼接用户输入",
                "cwe": "CWE-89",
                "remediation": "使用?占位符参数化查询",
            },
            {
                "id": "go_cmd_001",
                "type": "command_injection",
                "severity": "critical",
                "confidence": "high",
                "pattern": r"""exec\.Command\s*\(\s*"[^"]*"\s*,\s*[^)]*r\.""",
                "description": "exec.Command使用用户输入作为命令",
                "cwe": "CWE-78",
                "remediation": "验证命令参数，使用白名单",
            },
            {
                "id": "go_creds_001",
                "type": "hardcoded_credentials",
                "severity": "high",
                "confidence": "medium",
                "pattern": r'password\s*[:=]\s*"[^"]{3,}"',
                "description": "硬编码密码",
                "cwe": "CWE-798",
                "remediation": "使用环境变量",
            },
        ]
    def _generic_patterns(self) -> List[Dict]:
        """通用漏洞模式（适用于所有语言）"""
        return [
            {
                "id": "gen_creds_001",
                "type": "hardcoded_credentials",
                "severity": "high",
                "confidence": "medium",
                "pattern": r"""AKIA[0-9A-Z]{16}""",
                "description": "AWS Access Key ID",
                "cwe": "CWE-798",
                "remediation": "使用IAM角色或环境变量",
            },
            {
                "id": "gen_creds_002",
                "type": "hardcoded_credentials",
                "severity": "high",
                "confidence": "medium",
                "pattern": r"""-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----""",
                "description": "私钥泄露",
                "cwe": "CWE-798",
                "remediation": "立即轮换密钥，使用密钥管理服务",
            },
            {
                "id": "gen_creds_003",
                "type": "hardcoded_credentials",
                "severity": "high",
                "confidence": "medium",
                "pattern": r"""xox[baprs]-[A-Za-z0-9-]{10,}""",
                "description": "Slack Token",
                "cwe": "CWE-798",
                "remediation": "立即轮换Token",
            },
            {
                "id": "gen_creds_004",
                "type": "hardcoded_credentials",
                "severity": "high",
                "confidence": "medium",
                "pattern": r"""ghp_[A-Za-z0-9]{36}""",
                "description": "GitHub Personal Access Token",
                "cwe": "CWE-798",
                "remediation": "立即轮换Token",
            },
            {
                "id": "gen_info_001",
                "type": "information_disclosure",
                "severity": "low",
                "confidence": "medium",
                "pattern": r"""TODO|FIXME|HACK|XXX""",
                "description": "代码中的待办标记",
                "cwe": "CWE-546",
                "remediation": "处理或移除待办标记",
            },
        ]
    def get_patterns(self, language: str) -> List[Dict]:
        """获取指定语言的漏洞模式"""
        return self.patterns.get(language, [])
    def get_all_languages(self) -> List[str]:
        return list(self.patterns.keys())
    def get_pattern_by_id(self, pattern_id: str) -> Optional[Dict]:
        for language, patterns in self.patterns.items():
            for p in patterns:
                if p["id"] == pattern_id:
                    return {**p, "language": language}
        return None
    def search_patterns(self, keyword: str) -> List[Dict]:
        results = []
        keyword_lower = keyword.lower()
        for language, patterns in self.patterns.items():
            for p in patterns:
                if (keyword_lower in p["id"].lower() or
                        keyword_lower in p["type"].lower() or
                        keyword_lower in p["description"].lower()):
                    results.append({**p, "language": language})
        return results
