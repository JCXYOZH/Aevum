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
from .methods_2 import *  # noqa: F401,F403
from . import VulnPatternLibrary  # noqa: F401

class LanguageDetector:
    """语言检测器 - 根据文件扩展名判断编程语言"""

    EXTENSION_MAP = {
        ".py": "python", ".pyw": "python",
        ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript",
        ".ts": "javascript", ".tsx": "javascript",
        ".java": "java",
        ".php": "php", ".php3": "php", ".php4": "php", ".php5": "php",
        ".c": "c_cpp", ".h": "c_cpp", ".cpp": "c_cpp", ".cc": "c_cpp",
        ".hpp": "c_cpp", ".cxx": "c_cpp",
        ".rb": "ruby", ".rbw": "ruby",
        ".go": "go",
        ".rs": "generic", ".swift": "generic", ".kt": "generic",
        ".cs": "generic", ".vb": "generic",
        ".sh": "generic", ".bash": "generic",
        ".sql": "generic",
        ".html": "generic", ".htm": "generic",
        ".xml": "generic", ".yml": "generic", ".yaml": "generic",
        ".json": "generic",
    }

    @classmethod
    def detect(cls, file_path: str) -> str:
        ext = os.path.splitext(file_path)[1].lower()
        return cls.EXTENSION_MAP.get(ext, "generic")

    @classmethod
    def is_supported(cls, file_path: str) -> bool:
        ext = os.path.splitext(file_path)[1].lower()
        return ext in cls.EXTENSION_MAP

class StaticCodeScanner:
    """静态代码漏洞扫描器 - 主类

    完整流程：遍历文件 → 检测语言 → 匹配漏洞模式 → 数据流分析 →
    误报过滤 → 生成报告
    """

    def __init__(self, min_severity: str = "low", include_generic: bool = True,
                 exclude_patterns: List[str] = None, max_file_size: int = 1024 * 1024,
                 data_flow_analysis: bool = True, false_positive_filter: bool = True):
        self.pattern_library = VulnPatternLibrary()
        self.min_severity = min_severity
        self.include_generic = include_generic
        self.exclude_patterns = exclude_patterns or [
            r"__pycache__", r"\.git", r"node_modules", r"\.venv", r"venv",
            r"env", r"\.env", r"dist", r"build", r"\.tox", r"\.mypy_cache",
            r"\.pytest_cache", r"migrations", r"vendor", r"third_party",
        ]
        self.max_file_size = max_file_size
        self.data_flow_analysis = data_flow_analysis
        self.false_positive_filter = false_positive_filter
        self.scan_history: List[StaticScanResult] = []
        self._severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}

    def scan_project(self, project_path: str, languages: List[str] = None) -> StaticScanResult:
        """扫描整个项目"""
        result = StaticScanResult(project_path=project_path)
        result.scan_config = {
            "min_severity": self.min_severity,
            "languages": languages or "all",
            "data_flow_analysis": self.data_flow_analysis,
            "false_positive_filter": self.false_positive_filter,
        }

        # 遍历文件
        files = self._collect_files(project_path)
        result.total_files_scanned = len(files)

        for file_path in files:
            try:
                language = LanguageDetector.detect(file_path)
                if languages and language not in languages:
                    continue
                result.files_by_language[language] = result.files_by_language.get(language, 0) + 1

                vulns = self.scan_file(file_path, language)
                for vuln in vulns:
                    if self._passes_severity_filter(vuln):
                        result.add_vulnerability(vuln)
            except Exception as e:
                result.errors.append(f"{file_path}: {str(e)}")

        result.completed_at = time.time()
        self.scan_history.append(result)
        return result

    def scan_file(self, file_path: str, language: str = "") -> List[StaticVulnerability]:
        """扫描单个文件"""
        if not language:
            language = LanguageDetector.detect(file_path)

        if not os.path.exists(file_path):
            return []

        file_size = os.path.getsize(file_path)
        if file_size > self.max_file_size:
            return []

        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except Exception:
            return []

        lines = content.split("\n")
        vulnerabilities = []

        # 获取该语言的模式
        patterns = self.pattern_library.get_patterns(language)
        if self.include_generic:
            patterns = patterns + self.pattern_library.get_patterns("generic")

        # 匹配模式
        for pattern in patterns:
            try:
                regex = re.compile(pattern["pattern"], re.IGNORECASE | re.MULTILINE)
                for match in regex.finditer(content):
                    line_number = content[:match.start()].count("\n") + 1
                    column = match.start() - content[:match.start()].rfind("\n")
                    code_snippet = lines[line_number - 1].strip() if line_number <= len(lines) else ""

                    vuln = StaticVulnerability(
                        vuln_type=self._get_vuln_type_enum(pattern["type"]),
                        severity=self._get_severity_enum(pattern["severity"]),
                        confidence=self._get_confidence_enum(pattern.get("confidence", "medium")),
                        file_path=file_path,
                        line_number=line_number,
                        column=column,
                        code_snippet=code_snippet,
                        function_name=self._find_enclosing_function(lines, line_number),
                        class_name=self._find_enclosing_class(lines, line_number),
                        description=pattern["description"],
                        evidence=f"匹配模式: {pattern['pattern'][:80]}",
                        cwe=pattern.get("cwe", ""),
                        remediation=pattern.get("remediation", ""),
                        tags=[pattern["id"], language, pattern["type"]],
                    )

                    # 误报过滤
                    if self.false_positive_filter:
                        if self._is_false_positive(vuln, content, lines):
                            vuln.false_positive = True
                            continue

                    vulnerabilities.append(vuln)
            except re.error:
                continue

        # Python AST分析（如果启用数据流分析）
        if self.data_flow_analysis and language == "python":
            ast_vulns = self._analyze_python_ast(file_path, content)
            vulnerabilities.extend(ast_vulns)

        return vulnerabilities

    def _collect_files(self, project_path: str) -> List[str]:
        """收集项目中的所有文件"""
        files = []
        exclude_regex = [re.compile(p) for p in self.exclude_patterns]

        for root, dirs, filenames in os.walk(project_path):
            # 过滤排除目录
            dirs[:] = [d for d in dirs if not any(r.search(d) for r in exclude_regex)]
            dirs[:] = [d for d in dirs if not any(r.search(os.path.join(root, d)) for r in exclude_regex)]

            for filename in filenames:
                file_path = os.path.join(root, filename)
                if any(r.search(file_path) for r in exclude_regex):
                    continue
                if LanguageDetector.is_supported(file_path):
                    files.append(file_path)

        return sorted(files)

    def _analyze_python_ast(self, file_path: str, content: str) -> List[StaticVulnerability]:
        """Python AST分析 - 检测更复杂的漏洞模式"""
        vulnerabilities = []
        try:
            tree = ast.parse(content)
        except SyntaxError:
            return vulnerabilities

        lines = content.split("\n")

        # 检测危险函数调用
        dangerous_calls = {
            "eval": ("code_execution", "critical", "eval()函数调用"),
            "exec": ("code_execution", "critical", "exec()函数调用"),
            "compile": ("code_execution", "medium", "compile()函数调用"),
            "pickle.loads": ("insecure_deserialization", "critical", "pickle.loads反序列化"),
            "pickle.load": ("insecure_deserialization", "critical", "pickle.load反序列化"),
            "yaml.load": ("insecure_deserialization", "high", "yaml.load反序列化"),
            "os.system": ("command_injection", "critical", "os.system命令执行"),
            "os.popen": ("command_injection", "high", "os.popen命令执行"),
            "subprocess.call": ("command_injection", "high", "subprocess.call命令执行"),
            "subprocess.run": ("command_injection", "medium", "subprocess.run命令执行"),
            "subprocess.Popen": ("command_injection", "medium", "subprocess.Popen命令执行"),
        }

        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                func_name = self._get_full_func_name(node.func)
                if func_name in dangerous_calls:
                    vuln_type, severity, description = dangerous_calls[func_name]
                    # 检查参数是否包含用户输入
                    has_user_input = self._call_has_user_input(node)
                    confidence = "high" if has_user_input else "low"

                    vuln = StaticVulnerability(
                        vuln_type=self._get_vuln_type_enum(vuln_type),
                        severity=self._get_severity_enum(severity),
                        confidence=self._get_confidence_enum(confidence),
                        file_path=file_path,
                        line_number=node.lineno,
                        column=node.col_offset,
                        code_snippet=lines[node.lineno - 1].strip() if node.lineno <= len(lines) else "",
                        function_name=self._find_enclosing_function(lines, node.lineno),
                        description=description + ("（包含用户输入）" if has_user_input else ""),
                        evidence=f"AST检测到危险函数调用: {func_name}",
                        cwe=self._get_cwe_for_type(vuln_type),
                        tags=["ast_analysis", func_name, vuln_type],
                    )
                    vulnerabilities.append(vuln)

        return vulnerabilities

    def _get_full_func_name(self, node) -> str:
        """获取函数完整名称（如 os.system）"""
        if isinstance(node, ast.Name):
            return node.id
        elif isinstance(node, ast.Attribute):
            return f"{self._get_full_func_name(node.value)}.{node.attr}"
        return ""

    def _call_has_user_input(self, call_node) -> bool:
        """检查函数调用参数是否包含用户输入"""
        user_input_patterns = ["request", "args", "form", "data", "input", "argv", "environ"]
        for arg in call_node.args:
            if isinstance(arg, ast.Name):
                if any(p in arg.id.lower() for p in user_input_patterns):
                    return True
            elif isinstance(arg, ast.Attribute):
                full = self._get_full_func_name(arg)
                if any(p in full.lower() for p in user_input_patterns):
                    return True
        return False

    def _is_false_positive(self, vuln: StaticVulnerability, content: str, lines: List[str]) -> bool:
        """误报过滤"""
        # 检查是否在注释中
        line = lines[vuln.line_number - 1] if vuln.line_number <= len(lines) else ""
        stripped = line.strip()
        if stripped.startswith(("#", "//", "/*", "*", "<!--")):
            return True

        # 检查是否在文档字符串中
        if vuln.vuln_type == StaticVulnType.HARDCODED_CREDENTIALS:
            # 检查是否在测试文件中
            if "test" in vuln.file_path.lower():
                return True
            # 检查值是否是占位符
            if any(p in vuln.code_snippet.lower() for p in ["example", "placeholder", "dummy", "changeme", "your_"]):
                return True

        return False

    def _find_enclosing_function(self, lines: List[str], line_number: int) -> str:
        """查找包含指定行的函数名"""
        for i in range(line_number - 1, -1, -1):
            match = re.match(r"\s*(?:async\s+)?def\s+(\w+)", lines[i])
            if match:
                return match.group(1)
        return ""

    def _find_enclosing_class(self, lines: List[str], line_number: int) -> str:
        """查找包含指定行的类名"""
        for i in range(line_number - 1, -1, -1):
            match = re.match(r"\s*class\s+(\w+)", lines[i])
            if match:
                return match.group(1)
        return ""

    def _get_vuln_type_enum(self, vuln_type: str) -> StaticVulnType:
        mapping = {vt.value: vt for vt in StaticVulnType}
        return mapping.get(vuln_type, StaticVulnType.INFORMATION_DISCLOSURE)

    def _get_severity_enum(self, severity: str) -> StaticSeverity:
        mapping = {s.value: s for s in StaticSeverity}
        return mapping.get(severity, StaticSeverity.MEDIUM)

    def _get_confidence_enum(self, confidence: str) -> ConfidenceLevel:
        mapping = {c.value: c for c in ConfidenceLevel}
        return mapping.get(confidence, ConfidenceLevel.MEDIUM)

    def _get_cwe_for_type(self, vuln_type: str) -> str:
        cwe_map = {
            "sql_injection": "CWE-89", "xss": "CWE-79",
            "command_injection": "CWE-78", "path_traversal": "CWE-22",
            "ssrf": "CWE-918", "insecure_deserialization": "CWE-502",
            "weak_crypto": "CWE-327", "xxe": "CWE-611",
            "code_execution": "CWE-95", "hardcoded_credentials": "CWE-798",
        }
        return cwe_map.get(vuln_type, "")

    def _passes_severity_filter(self, vuln: StaticVulnerability) -> bool:
        min_level = self._severity_order.get(self.min_severity, 3)
        vuln_level = self._severity_order.get(vuln.severity.value, 3)
        return vuln_level <= min_level

    def get_scan_history(self, limit: int = 10) -> List[Dict]:
        return [r.get_summary() for r in self.scan_history[-limit:]]

    def get_stats(self) -> Dict:
        return {
            "total_scans": len(self.scan_history),
            "total_vulnerabilities": sum(len(r.vulnerabilities) for r in self.scan_history),
            "supported_languages": self.pattern_library.get_all_languages(),
            "total_patterns": sum(len(p) for p in self.pattern_library.patterns.values()),
        }
