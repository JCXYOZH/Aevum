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

class VulnType(Enum):
    """漏洞类型"""
    SQLI = "sql_injection"
    XSS = "xss"
    COMMAND_INJECTION = "command_injection"
    DIRECTORY_TRAVERSAL = "directory_traversal"
    SSRF = "ssrf"
    FILE_UPLOAD = "file_upload"
    CRLF_INJECTION = "crlf_injection"
    SSTI = "ssti"
    XXE = "xxe"
    OPEN_REDIRECT = "open_redirect"
    LFI = "lfi"
    RFI = "rfi"
    INSECURE_DESERIALIZATION = "insecure_deserialization"
    WEAK_CRYPTO = "weak_crypto"
    HARDCODED_CREDENTIALS = "hardcoded_credentials"
    INFORMATION_DISCLOSURE = "information_disclosure"
    CSRF = "csrf"
    CORS_MISCONFIG = "cors_misconfiguration"
    HTTP_HEADER_SECURITY = "http_header_security"

class Severity(Enum):
    """严重程度"""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"

class Confidence(Enum):
    """置信度"""
    CONFIRMED = "confirmed"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    TENTATIVE = "tentative"

@dataclass
class InjectionPoint:
    """注入点"""
    location: str  # url_param, post_data, header, cookie, path
    name: str
    value: str = ""
    method: str = "GET"

    def to_dict(self) -> Dict:
        return {
            "location": self.location,
            "name": self.name,
            "value": self.value,
            "method": self.method,
        }

@dataclass
class ScanRequest:
    """扫描请求"""
    url: str
    method: str = "GET"
    params: Dict[str, str] = field(default_factory=dict)
    data: Dict[str, str] = field(default_factory=dict)
    headers: Dict[str, str] = field(default_factory=dict)
    cookies: Dict[str, str] = field(default_factory=dict)
    injection_point: Optional[InjectionPoint] = None
    payload: str = ""
    payload_type: str = ""
    timeout: int = 10
    allow_redirects: bool = False

    def to_dict(self) -> Dict:
        return {
            "url": self.url,
            "method": self.method,
            "params": self.params,
            "data": self.data,
            "headers": self.headers,
            "cookies": self.cookies,
            "injection_point": self.injection_point.to_dict() if self.injection_point else None,
            "payload": self.payload,
            "payload_type": self.payload_type,
            "timeout": self.timeout,
        }

@dataclass
class ScanResponse:
    """扫描响应"""
    status_code: int = 0
    headers: Dict[str, str] = field(default_factory=dict)
    body: str = ""
    body_length: int = 0
    response_time: float = 0.0
    error: str = ""
    url: str = ""
    redirected: bool = False
    redirect_url: str = ""

    def to_dict(self) -> Dict:
        return {
            "status_code": self.status_code,
            "headers": self.headers,
            "body_length": self.body_length,
            "response_time": self.response_time,
            "error": self.error,
            "url": self.url,
            "redirected": self.redirected,
            "redirect_url": self.redirect_url,
        }

@dataclass
class Vulnerability:
    """漏洞"""
    vuln_id: str = ""
    vuln_type: VulnType = VulnType.SQLI
    severity: Severity = Severity.MEDIUM
    confidence: Confidence = Confidence.TENTATIVE
    url: str = ""
    injection_point: Optional[InjectionPoint] = None
    payload: str = ""
    description: str = ""
    evidence: str = ""
    request: Optional[ScanRequest] = None
    response: Optional[ScanResponse] = None
    verification_request: Optional[ScanRequest] = None
    verification_response: Optional[ScanResponse] = None
    cwe: str = ""
    cvss: float = 0.0
    remediation: str = ""
    discovered_at: float = 0.0
    verified: bool = False
    false_positive: bool = False
    tags: List[str] = field(default_factory=list)

    def __post_init__(self):
        if not self.vuln_id:
            self.vuln_id = f"vuln_{uuid.uuid4().hex[:12]}"
        if not self.discovered_at:
            self.discovered_at = time.time()

    def to_dict(self) -> Dict:
        return {
            "vuln_id": self.vuln_id,
            "vuln_type": self.vuln_type.value,
            "severity": self.severity.value,
            "confidence": self.confidence.value,
            "url": self.url,
            "injection_point": self.injection_point.to_dict() if self.injection_point else None,
            "payload": self.payload,
            "description": self.description,
            "evidence": self.evidence,
            "request": self.request.to_dict() if self.request else None,
            "response": self.response.to_dict() if self.response else None,
            "verified": self.verified,
            "false_positive": self.false_positive,
            "cwe": self.cwe,
            "cvss": self.cvss,
            "remediation": self.remediation,
            "discovered_at": self.discovered_at,
            "tags": self.tags,
        }

@dataclass
class ScanResult:
    """扫描结果"""
    scan_id: str = ""
    target_url: str = ""
    started_at: float = 0.0
    completed_at: float = 0.0
    total_requests: int = 0
    total_injection_points: int = 0
    vulnerabilities: List[Vulnerability] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    scan_config: Dict = field(default_factory=dict)

    def __post_init__(self):
        if not self.scan_id:
            self.scan_id = f"scan_{uuid.uuid4().hex[:12]}"
        if not self.started_at:
            self.started_at = time.time()

    def add_vulnerability(self, vuln: Vulnerability):
        self.vulnerabilities.append(vuln)

    def get_by_severity(self, severity: Severity) -> List[Vulnerability]:
        return [v for v in self.vulnerabilities if v.severity == severity]

    def get_by_type(self, vuln_type: VulnType) -> List[Vulnerability]:
        return [v for v in self.vulnerabilities if v.vuln_type == vuln_type]

    def get_verified(self) -> List[Vulnerability]:
        return [v for v in self.vulnerabilities if v.verified and not v.false_positive]

    def get_summary(self) -> Dict:
        return {
            "scan_id": self.scan_id,
            "target_url": self.target_url,
            "duration_seconds": (self.completed_at or time.time()) - self.started_at,
            "total_requests": self.total_requests,
            "total_injection_points": self.total_injection_points,
            "total_vulnerabilities": len(self.vulnerabilities),
            "verified_vulnerabilities": len(self.get_verified()),
            "by_severity": {
                "critical": len(self.get_by_severity(Severity.CRITICAL)),
                "high": len(self.get_by_severity(Severity.HIGH)),
                "medium": len(self.get_by_severity(Severity.MEDIUM)),
                "low": len(self.get_by_severity(Severity.LOW)),
                "info": len(self.get_by_severity(Severity.INFO)),
            },
            "by_type": {vt.value: len(self.get_by_type(vt)) for vt in VulnType if self.get_by_type(vt)},
            "errors": len(self.errors),
        }

    def to_dict(self) -> Dict:
        d = self.get_summary()
        d["vulnerabilities"] = [v.to_dict() for v in self.vulnerabilities]
        d["errors"] = self.errors
        return d
