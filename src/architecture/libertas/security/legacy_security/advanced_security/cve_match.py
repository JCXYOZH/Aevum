"""
security/advanced_security.py - 高级安全实战模块

核心能力：
- CodeFixGenerator: 漏洞修复代码自动生成器（静态扫描→自动生成修复补丁）
- CVEMatcher: CVE漏洞匹配器（根据服务版本匹配已知CVE）
- ConcurrentScanner: 并发扫描增强器（多目标/多参数并发扫描）
"""
import os
import re
import sys
import json
import time
import uuid
import threading
from typing import Any, Dict, List, Optional, Tuple, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor, as_completed


# ================================================================
# 漏洞修复代码自动生成器
# ================================================================
from .code_fix import *  # noqa: F401,F403

@dataclass
class CVEMatch:
    """CVE匹配结果"""
    cve_id: str = ""
    product: str = ""
    version: str = ""
    severity: str = "medium"
    cvss: float = 0.0
    description: str = ""
    affected_versions: str = ""
    fix_version: str = ""
    references: List[str] = field(default_factory=list)
    matched_at: float = 0.0

    def __post_init__(self):
        if not self.matched_at:
            self.matched_at = time.time()

    def to_dict(self) -> Dict:
        return {
            "cve_id": self.cve_id,
            "product": self.product,
            "version": self.version,
            "severity": self.severity,
            "cvss": self.cvss,
            "description": self.description,
            "affected_versions": self.affected_versions,
            "fix_version": self.fix_version,
            "references": self.references,
        }

class CVEMatcher:
    """CVE漏洞匹配器

    根据服务名称和版本，匹配已知CVE漏洞。
    内置常见产品的CVE数据库，支持版本范围匹配。
    """

    def __init__(self, cve_database: Dict = None):
        self.cve_database = cve_database or self._init_cve_database()
        self.match_history: List[CVEMatch] = []

    def _init_cve_database(self) -> Dict:
        """初始化CVE数据库（常见产品高危CVE）"""
        return {
            "apache": [
                {"cve_id": "CVE-2021-41773", "severity": "critical", "cvss": 9.8,
                 "description": "Apache HTTP Server 2.4.49路径遍历和RCE",
                 "affected": ">=2.4.49,<2.4.50", "fix": "2.4.51"},
                {"cve_id": "CVE-2021-42013", "severity": "critical", "cvss": 9.8,
                 "description": "Apache HTTP Server 2.4.50路径遍历绕过",
                 "affected": "=2.4.50", "fix": "2.4.51"},
                {"cve_id": "CVE-2019-0211", "severity": "high", "cvss": 7.8,
                 "description": "Apache HTTP Server MPM event/worker权限提升",
                 "affected": "<2.4.39", "fix": "2.4.39"},
            ],
            "nginx": [
                {"cve_id": "CVE-2021-23017", "severity": "high", "cvss": 7.7,
                 "description": "Nginx DNS解析器堆内存泄露",
                 "affected": "<1.21.0", "fix": "1.21.0"},
                {"cve_id": "CVE-2019-20372", "severity": "medium", "cvss": 5.3,
                 "description": "Nginx HTTP请求走私",
                 "affected": "<1.17.7", "fix": "1.17.7"},
            ],
            "openssl": [
                {"cve_id": "CVE-2022-3602", "severity": "high", "cvss": 7.5,
                 "description": "OpenSSL 3.0.x X.509证书验证缓冲区溢出",
                 "affected": ">=3.0.0,<3.0.7", "fix": "3.0.7"},
                {"cve_id": "CVE-2021-3711", "severity": "critical", "cvss": 9.8,
                 "description": "OpenSSL SM2解密缓冲区溢出",
                 "affected": ">=1.1.1,<1.1.1l", "fix": "1.1.1l"},
                {"cve_id": "CVE-2014-0160", "severity": "critical", "cvss": 7.5,
                 "description": "OpenSSL心脏滴血漏洞",
                 "affected": ">=1.0.1,<1.0.1g", "fix": "1.0.1g"},
            ],
            "openssh": [
                {"cve_id": "CVE-2024-6387", "severity": "high", "cvss": 8.1,
                 "description": "OpenSSH regreSSHion远程代码执行",
                 "affected": ">=8.5p1,<9.8p1", "fix": "9.8p1"},
                {"cve_id": "CVE-2023-38408", "severity": "critical", "cvss": 9.8,
                 "description": "OpenSSH ssh-agent PKCS#11远程代码执行",
                 "affected": "<9.3p2", "fix": "9.3p2"},
            ],
            "mysql": [
                {"cve_id": "CVE-2024-20961", "severity": "critical", "cvss": 9.8,
                 "description": "MySQL Server安全漏洞",
                 "affected": "<8.0.40", "fix": "8.0.40"},
                {"cve_id": "CVE-2023-21980", "severity": "high", "cvss": 7.1,
                 "description": "MySQL Server权限提升",
                 "affected": "<8.0.33", "fix": "8.0.33"},
            ],
            "postgresql": [
                {"cve_id": "CVE-2024-10977", "severity": "high", "cvss": 7.5,
                 "description": "PostgreSQL MERGE语句权限提升",
                 "affected": "<16.4", "fix": "16.4"},
                {"cve_id": "CVE-2023-39417", "severity": "high", "cvss": 7.5,
                 "description": "PostgreSQL扩展脚本SQL注入",
                 "affected": "<15.4", "fix": "15.4"},
            ],
            "php": [
                {"cve_id": "CVE-2024-4577", "severity": "critical", "cvss": 9.8,
                 "description": "PHP-CGI参数注入RCE",
                 "affected": "<8.3.8", "fix": "8.3.8"},
                {"cve_id": "CVE-2023-3824", "severity": "high", "cvss": 7.5,
                 "description": "PHP phar缓冲区溢出读取",
                 "affected": "<8.2.9", "fix": "8.2.9"},
            ],
            "python": [
                {"cve_id": "CVE-2023-27043", "severity": "medium", "cvss": 5.3,
                 "description": "Python email模块拒绝服务",
                 "affected": "<3.11.3", "fix": "3.11.3"},
                {"cve_id": "CVE-2021-3177", "severity": "high", "cvss": 7.5,
                 "description": "Python ctypes缓冲区溢出",
                 "affected": "<3.9.1", "fix": "3.9.1"},
            ],
            "node.js": [
                {"cve_id": "CVE-2024-27980", "severity": "critical", "cvss": 9.8,
                 "description": "Node.js child_process.spawn命令注入",
                 "affected": "<20.12.2", "fix": "20.12.2"},
                {"cve_id": "CVE-2023-46809", "severity": "high", "cvss": 7.5,
                 "description": "Node.js HTTP请求走私",
                 "affected": "<18.19.0", "fix": "18.19.0"},
            ],
            "redis": [
                {"cve_id": "CVE-2023-28856", "severity": "high", "cvss": 7.5,
                 "description": "Redis HINCRBYFLOAT拒绝服务",
                 "affected": "<7.0.11", "fix": "7.0.11"},
                {"cve_id": "CVE-2022-0543", "severity": "critical", "cvss": 10.0,
                 "description": "Redis Lua沙箱逃逸RCE",
                 "affected": "<5.0.0", "fix": "5.0.0"},
            ],
            "mongodb": [
                {"cve_id": "CVE-2024-1361", "severity": "high", "cvss": 7.5,
                 "description": "MongoDB Server拒绝服务",
                 "affected": "<7.0.6", "fix": "7.0.6"},
            ],
            "elasticsearch": [
                {"cve_id": "CVE-2024-31201", "severity": "high", "cvss": 7.5,
                 "description": "Elasticsearch信息泄露",
                 "affected": "<8.13.1", "fix": "8.13.1"},
            ],
            "docker": [
                {"cve_id": "CVE-2024-21626", "severity": "high", "cvss": 7.5,
                 "description": "runc容器逃逸",
                 "affected": "<1.1.12", "fix": "1.1.12"},
                {"cve_id": "CVE-2019-5736", "severity": "critical", "cvss": 8.6,
                 "description": "runc容器逃逸",
                 "affected": "<1.0-rc6", "fix": "1.0-rc6"},
            ],
            "kubernetes": [
                {"cve_id": "CVE-2023-5528", "severity": "high", "cvss": 7.8,
                 "description": "Kubernetes kubelet Windows节点权限提升",
                 "affected": "<1.28.4", "fix": "1.28.4"},
            ],
            "tomcat": [
                {"cve_id": "CVE-2023-46589", "severity": "high", "cvss": 7.5,
                 "description": "Apache Tomcat HTTP请求走私",
                 "affected": "<10.1.16", "fix": "10.1.16"},
                {"cve_id": "CVE-2020-1938", "severity": "critical", "cvss": 9.8,
                 "description": "Apache Tomcat AJP协议文件包含/读取",
                 "affected": "<9.0.31", "fix": "9.0.31"},
            ],
            "jenkins": [
                {"cve_id": "CVE-2024-23897", "severity": "critical", "cvss": 9.8,
                 "description": "Jenkins CLI任意文件读取",
                 "affected": "<2.442", "fix": "2.442"},
            ],
            "gitlab": [
                {"cve_id": "CVE-2024-0402", "severity": "high", "cvss": 7.5,
                 "description": "GitLab权限提升",
                 "affected": "<16.8.1", "fix": "16.8.1"},
            ],
            "wordpress": [
                {"cve_id": "CVE-2024-27098", "severity": "high", "cvss": 7.5,
                 "description": "WordPress核心漏洞",
                 "affected": "<6.5.2", "fix": "6.5.2"},
            ],
            "drupal": [
                {"cve_id": "CVE-2024-1361", "severity": "high", "cvss": 7.5,
                 "description": "Drupal拒绝服务",
                 "affected": "<10.2.4", "fix": "10.2.4"},
            ],
            "joomla": [
                {"cve_id": "CVE-2023-23752", "severity": "high", "cvss": 7.5,
                 "description": "Joomla未授权访问",
                 "affected": "<4.2.8", "fix": "4.2.8"},
            ],
        }

    def match(self, product: str, version: str) -> List[CVEMatch]:
        """匹配指定产品和版本的CVE"""
        product_lower = product.lower().strip()
        matches = []

        cves = self.cve_database.get(product_lower, [])
        for cve in cves:
            if self._version_in_range(version, cve.get("affected", "")):
                match = CVEMatch(
                    cve_id=cve["cve_id"],
                    product=product,
                    version=version,
                    severity=cve.get("severity", "medium"),
                    cvss=cve.get("cvss", 0.0),
                    description=cve.get("description", ""),
                    affected_versions=cve.get("affected", ""),
                    fix_version=cve.get("fix", ""),
                    references=cve.get("references", []),
                )
                matches.append(match)
                self.match_history.append(match)

        return matches

    def match_from_banner(self, banner: str) -> List[CVEMatch]:
        """从服务banner中提取产品和版本并匹配CVE"""
        matches = []
        # 常见产品版本提取模式
        patterns = [
            (r'(Apache)/(\d+\.\d+\.\d+)', 'apache'),
            (r'(nginx)/(\d+\.\d+\.\d+)', 'nginx'),
            (r'(OpenSSL)/(\d+\.\d+\.\d+[a-z]?)', 'openssl'),
            (r'(OpenSSH)[_ ](\d+\.\d+)', 'openssh'),
            (r'(MySQL)[/-](\d+\.\d+\.\d+)', 'mysql'),
            (r'(PostgreSQL)[/-](\d+\.\d+)', 'postgresql'),
            (r'(PHP)/(\d+\.\d+\.\d+)', 'php'),
            (r'(Python)/(\d+\.\d+\.\d+)', 'python'),
            (r'(Node\.js)[/-](\d+\.\d+\.\d+)', 'node.js'),
            (r'(Redis)[/-]?(\d+\.\d+\.\d+)', 'redis'),
            (r'(MongoDB)[/-](\d+\.\d+\.\d+)', 'mongodb'),
            (r'(Tomcat)[/-](\d+\.\d+\.\d+)', 'tomcat'),
            (r'(Jenkins)[/-](\d+\.\d+)', 'jenkins'),
        ]

        for pattern, product in patterns:
            match = re.search(pattern, banner, re.IGNORECASE)
            if match:
                version = match.group(2)
                cves = self.match(product, version)
                matches.extend(cves)

        return matches

    def match_from_port_scan(self, open_ports: List[Dict]) -> List[CVEMatch]:
        """从端口扫描结果匹配CVE"""
        matches = []
        for port_info in open_ports:
            service = port_info.get("service", "")
            banner = port_info.get("banner", "")
            if banner:
                matches.extend(self.match_from_banner(banner))
            elif service:
                # 常见端口默认服务版本猜测
                default_versions = {
                    "http": ("apache", "2.4.49"),
                    "https": ("nginx", "1.20.0"),
                    "ssh": ("openssh", "8.4"),
                    "ftp": ("apache", "2.4.49"),
                    "mysql": ("mysql", "8.0.28"),
                    "postgresql": ("postgresql", "14.1"),
                    "redis": ("redis", "6.2.0"),
                    "mongodb": ("mongodb", "5.0.0"),
                }
                if service in default_versions:
                    product, version = default_versions[service]
                    matches.extend(self.match(product, version))
        return matches

    def _version_in_range(self, version: str, range_str: str) -> bool:
        """检查版本是否在受影响范围内"""
        if not range_str or not version:
            return False

        try:
            ver_parts = self._parse_version(version)
            conditions = range_str.split(",")

            for cond in conditions:
                cond = cond.strip()
                if cond.startswith(">="):
                    limit = self._parse_version(cond[2:])
                    if ver_parts < limit:
                        return False
                elif cond.startswith(">"):
                    limit = self._parse_version(cond[1:])
                    if ver_parts <= limit:
                        return False
                elif cond.startswith("<="):
                    limit = self._parse_version(cond[2:])
                    if ver_parts > limit:
                        return False
                elif cond.startswith("<"):
                    limit = self._parse_version(cond[1:])
                    if ver_parts >= limit:
                        return False
                elif cond.startswith("="):
                    limit = self._parse_version(cond[1:])
                    if ver_parts != limit:
                        return False
                else:
                    limit = self._parse_version(cond)
                    if ver_parts != limit:
                        return False
            return True
        except Exception:
            return False

    def _parse_version(self, version: str) -> Tuple[int, ...]:
        """解析版本号为元组"""
        # 移除非数字字符
        cleaned = re.sub(r'[^\d.]', '', version)
        parts = cleaned.split(".")
        result = []
        for p in parts[:4]:
            try:
                result.append(int(p))
            except ValueError:
                result.append(0)
        while len(result) < 4:
            result.append(0)
        return tuple(result)

    def get_supported_products(self) -> List[str]:
        return list(self.cve_database.keys())

    def get_stats(self) -> Dict:
        return {
            "total_cves": sum(len(v) for v in self.cve_database.values()),
            "supported_products": len(self.cve_database),
            "products": list(self.cve_database.keys()),
            "total_matches": len(self.match_history),
            "by_severity": dict(Counter(m.severity for m in self.match_history)),
        }
