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

class StaticVulnType(Enum):
    """静态漏洞类型"""
    SQL_INJECTION = "sql_injection"
    XSS = "xss"
    COMMAND_INJECTION = "command_injection"
    HARDCODED_CREDENTIALS = "hardcoded_credentials"
    PATH_TRAVERSAL = "path_traversal"
    SSRF = "ssrf"
    INSECURE_DESERIALIZATION = "insecure_deserialization"
    WEAK_CRYPTO = "weak_crypto"
    XXE = "xxe"
    OPEN_REDIRECT = "open_redirect"
    INSECURE_RANDOM = "insecure_random"
    DEBUG_CODE = "debug_code"
    COMMENTED_CODE = "commented_code"
    BUFFER_OVERFLOW = "buffer_overflow"
    FORMAT_STRING = "format_string"
    INTEGER_OVERFLOW = "integer_overflow"
    RACE_CONDITION = "race_condition"
    INFORMATION_DISCLOSURE = "information_disclosure"
    INSECURE_HEADER = "insecure_header"
    MISSING_AUTH = "missing_authentication"
    CSRF = "csrf"
    CORS_MISCONFIG = "cors_misconfiguration"
    WEAK_PASSWORD_POLICY = "weak_password_policy"
    UNSAFE_REFLECTION = "unsafe_reflection"
    CODE_EXECUTION = "code_execution"
    LDAP_INJECTION = "ldap_injection"
    XPATH_INJECTION = "xpath_injection"
    NOSQL_INJECTION = "nosql_injection"
    SENSITIVE_DATA_EXPOSURE = "sensitive_data_exposure"
    MISSING_RATE_LIMIT = "missing_rate_limit"

class StaticSeverity(Enum):
    """严重程度"""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"

class ConfidenceLevel(Enum):
    """置信度"""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

@dataclass
class StaticVulnerability:
    """静态漏洞"""
    vuln_id: str = ""
    vuln_type: StaticVulnType = StaticVulnType.SQL_INJECTION
    severity: StaticSeverity = StaticSeverity.MEDIUM
    confidence: ConfidenceLevel = ConfidenceLevel.MEDIUM
    file_path: str = ""
    line_number: int = 0
    column: int = 0
    code_snippet: str = ""
    function_name: str = ""
    class_name: str = ""
    description: str = ""
    evidence: str = ""
    cwe: str = ""
    remediation: str = ""
    source: str = ""
    sink: str = ""
    data_flow: List[Dict] = field(default_factory=list)
    false_positive: bool = False
    tags: List[str] = field(default_factory=list)
    discovered_at: float = 0.0

    def __post_init__(self):
        if not self.vuln_id:
            self.vuln_id = f"static_{uuid.uuid4().hex[:12]}"
        if not self.discovered_at:
            self.discovered_at = time.time()

    def to_dict(self) -> Dict:
        return {
            "vuln_id": self.vuln_id,
            "vuln_type": self.vuln_type.value,
            "severity": self.severity.value,
            "confidence": self.confidence.value,
            "file_path": self.file_path,
            "line_number": self.line_number,
            "column": self.column,
            "code_snippet": self.code_snippet,
            "function_name": self.function_name,
            "class_name": self.class_name,
            "description": self.description,
            "evidence": self.evidence,
            "cwe": self.cwe,
            "remediation": self.remediation,
            "source": self.source,
            "sink": self.sink,
            "data_flow": self.data_flow,
            "false_positive": self.false_positive,
            "tags": self.tags,
        }

@dataclass
class StaticScanResult:
    """静态扫描结果"""
    scan_id: str = ""
    project_path: str = ""
    started_at: float = 0.0
    completed_at: float = 0.0
    total_files_scanned: int = 0
    total_lines_scanned: int = 0
    vulnerabilities: List[StaticVulnerability] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    files_by_language: Dict[str, int] = field(default_factory=dict)
    scan_config: Dict = field(default_factory=dict)

    def __post_init__(self):
        if not self.scan_id:
            self.scan_id = f"static_scan_{uuid.uuid4().hex[:12]}"
        if not self.started_at:
            self.started_at = time.time()

    def add_vulnerability(self, vuln: StaticVulnerability):
        self.vulnerabilities.append(vuln)

    def get_by_severity(self, severity: StaticSeverity) -> List[StaticVulnerability]:
        return [v for v in self.vulnerabilities if v.severity == severity]

    def get_by_type(self, vuln_type: StaticVulnType) -> List[StaticVulnerability]:
        return [v for v in self.vulnerabilities if v.vuln_type == vuln_type]

    def get_by_file(self, file_path: str) -> List[StaticVulnerability]:
        return [v for v in self.vulnerabilities if v.file_path == file_path]

    def get_summary(self) -> Dict:
        return {
            "scan_id": self.scan_id,
            "project_path": self.project_path,
            "duration_seconds": (self.completed_at or time.time()) - self.started_at,
            "total_files_scanned": self.total_files_scanned,
            "total_lines_scanned": self.total_lines_scanned,
            "total_vulnerabilities": len(self.vulnerabilities),
            "by_severity": {
                "critical": len(self.get_by_severity(StaticSeverity.CRITICAL)),
                "high": len(self.get_by_severity(StaticSeverity.HIGH)),
                "medium": len(self.get_by_severity(StaticSeverity.MEDIUM)),
                "low": len(self.get_by_severity(StaticSeverity.LOW)),
                "info": len(self.get_by_severity(StaticSeverity.INFO)),
            },
            "by_type": {vt.value: len(self.get_by_type(vt)) for vt in StaticVulnType if self.get_by_type(vt)},
            "by_file": self._get_top_files(10),
            "files_by_language": self.files_by_language,
            "errors": len(self.errors),
        }

    def _get_top_files(self, limit: int = 10) -> List[Dict]:
        file_counts = Counter(v.file_path for v in self.vulnerabilities)
        return [{"file": f, "count": c} for f, c in file_counts.most_common(limit)]

    def to_dict(self) -> Dict:
        d = self.get_summary()
        d["vulnerabilities"] = [v.to_dict() for v in self.vulnerabilities]
        d["errors"] = self.errors
        return d
