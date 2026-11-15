"""
security/security_expansion.py - 安全模块综合扩展

高级安全功能：威胁情报中心、攻击链分析器、漏洞利用模拟器、
安全事件响应引擎、入侵检测规则引擎、安全合规检查器、
蜜罐管理系统、安全评分卡系统。
"""
import os
import json
import time
import uuid
import math
import hashlib
import threading
import re
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter, defaultdict
from enum import Enum
from libertas.foundation.terminal import terminal


# ================================================================
# 威胁等级
# ================================================================

class ThreatLevel(Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"
    UNKNOWN = "unknown"

class AttackType(Enum):
    SQL_INJECTION = "sql_injection"
    XSS = "xss"
    CSRF = "csrf"
    PATH_TRAVERSAL = "path_traversal"
    COMMAND_INJECTION = "command_injection"
    SSRF = "ssrf"
    XXE = "xxe"
    DESERIALIZATION = "deserialization"
    BRUTE_FORCE = "brute_force"
    DDoS = "ddos"
    PHISHING = "phishing"
    MALWARE = "malware"
    RANSOMWARE = "ransomware"
    ZERO_DAY = "zero_day"
    PRIVILEGE_ESCALATION = "privilege_escalation"
    DATA_EXFILTRATION = "data_exfiltration"
    MAN_IN_THE_MIDDLE = "man_in_the_middle"
    CREDENTIAL_STUFFING = "credential_stuffing"
    UNKNOWN = "unknown"

class ThreatIntel:
    """威胁情报条目"""

    def __init__(self, title: str = "", threat_type: str = "unknown",
                 severity: str = "medium", description: str = "",
                 indicators: Optional[List[str]] = None,
                 source: str = "", cve_id: str = "",
                 affected_systems: Optional[List[str]] = None):
        self.intel_id = f"intel_{uuid.uuid4().hex[:8]}"
        self.title = title
        self.threat_type = threat_type
        self.severity = severity
        self.description = description
        self.indicators = indicators or []  # IOCs: IPs, domains, hashes, URLs
        self.source = source
        self.cve_id = cve_id
        self.affected_systems = affected_systems or []
        self.created_at = time.time()
        self.updated_at = time.time()
        self.first_seen = 0.0
        self.last_seen = 0.0
        self.confidence = 0.0  # 0-1
        self.malicious_ips: List[str] = []
        self.malicious_domains: List[str] = []
        self.malicious_hashes: List[str] = []
        self.malicious_urls: List[str] = []
        self.tags: List[str] = []
        self.references: List[str] = []
        self.is_active = True
        self.metadata: Dict[str, Any] = {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "intel_id": self.intel_id,
            "title": self.title,
            "threat_type": self.threat_type,
            "severity": self.severity,
            "description": self.description[:300],
            "indicators_count": len(self.indicators),
            "source": self.source,
            "cve_id": self.cve_id,
            "confidence": self.confidence,
            "is_active": self.is_active,
            "tags": self.tags,
        }

class ThreatIntelCenter:
    """威胁情报中心"""

    def __init__(self):
        self.center_id = f"tic_{uuid.uuid4().hex[:8]}"
        self.intel_entries: Dict[str, ThreatIntel] = {}
        self.ioc_index: Dict[str, List[str]] = {}  # indicator -> [intel_ids]
        self._lock = threading.RLock()
        self.sync_interval = 3600.0
        self.last_sync = 0.0
        self.sources: List[Dict[str, Any]] = []

    def add_intel(self, intel: ThreatIntel) -> str:
        with self._lock:
            self.intel_entries[intel.intel_id] = intel
            for indicator in intel.indicators:
                if indicator not in self.ioc_index:
                    self.ioc_index[indicator] = []
                self.ioc_index[indicator].append(intel.intel_id)
        terminal.info(f"添加威胁情报: {intel.title}", "threat_intel")
        return intel.intel_id

    def remove_intel(self, intel_id: str) -> bool:
        with self._lock:
            intel = self.intel_entries.pop(intel_id, None)
            if intel:
                for indicator in intel.indicators:
                    if indicator in self.ioc_index:
                        self.ioc_index[indicator] = [
                            iid for iid in self.ioc_index[indicator] if iid != intel_id
                        ]
                return True
        return False

    def lookup_indicator(self, indicator: str) -> List[ThreatIntel]:
        """查找指标对应的威胁情报"""
        intel_ids = self.ioc_index.get(indicator, [])
        return [self.intel_entries[iid] for iid in intel_ids if iid in self.intel_entries]

    def check_ip(self, ip: str) -> Dict[str, Any]:
        """检查IP是否恶意"""
        results = self.lookup_indicator(ip)
        if not results:
            return {"ip": ip, "malicious": False, "matches": []}
        highest_severity = max(
            (r.severity for r in results),
            key=lambda s: ["info", "low", "medium", "high", "critical"].index(s)
        )
        return {
            "ip": ip,
            "malicious": True,
            "severity": highest_severity,
            "matches": [r.to_dict() for r in results],
            "confidence": max(r.confidence for r in results),
        }

    def check_domain(self, domain: str) -> Dict[str, Any]:
        results = self.lookup_indicator(domain)
        if not results:
            return {"domain": domain, "malicious": False, "matches": []}
        severities = [r.severity for r in results]
        return {
            "domain": domain,
            "malicious": True,
            "severity": max(severities,
                          key=lambda s: ["info", "low", "medium", "high", "critical"].index(s)),
            "matches": [r.to_dict() for r in results],
        }

    def check_hash(self, file_hash: str) -> Dict[str, Any]:
        results = self.lookup_indicator(file_hash)
        if not results:
            return {"hash": file_hash, "malicious": False, "matches": []}
        severities = [r.severity for r in results]
        return {
            "hash": file_hash,
            "malicious": True,
            "severity": max(severities,
                          key=lambda s: ["info", "low", "medium", "high", "critical"].index(s)),
            "matches": [r.to_dict() for r in results],
        }

    def search_intel(self, query: str, limit: int = 20) -> List[ThreatIntel]:
        query_lower = query.lower()
        results = []
        for intel in self.intel_entries.values():
            score = 0
            if query_lower in intel.title.lower():
                score += 10
            if query_lower in intel.description.lower():
                score += 5
            if query_lower in intel.threat_type.lower():
                score += 8
            if query_lower in intel.cve_id.lower():
                score += 10
            if any(query_lower in tag.lower() for tag in intel.tags):
                score += 7
            if score > 0:
                results.append((intel, score))
        results.sort(key=lambda x: x[1], reverse=True)
        return [r[0] for r in results[:limit]]

    def list_intel(self, severity: str = "", threat_type: str = "",
                   active_only: bool = True, limit: int = 50) -> List[ThreatIntel]:
        entries = list(self.intel_entries.values())
        if severity:
            entries = [e for e in entries if e.severity == severity]
        if threat_type:
            entries = [e for e in entries if e.threat_type == threat_type]
        if active_only:
            entries = [e for e in entries if e.is_active]
        entries.sort(key=lambda e: e.created_at, reverse=True)
        return entries[:limit]

    def get_stats(self) -> Dict[str, Any]:
        severities = Counter(e.severity for e in self.intel_entries.values())
        types = Counter(e.threat_type for e in self.intel_entries.values())
        return {
            "center_id": self.center_id,
            "total_intel": len(self.intel_entries),
            "active_intel": sum(1 for e in self.intel_entries.values() if e.is_active),
            "total_iocs": len(self.ioc_index),
            "by_severity": dict(severities),
            "by_type": dict(types),
            "sources": len(self.sources),
            "last_sync": self.last_sync,
        }
