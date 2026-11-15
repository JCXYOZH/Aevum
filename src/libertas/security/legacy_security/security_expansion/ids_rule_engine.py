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
from .threat_level import *  # noqa: F401,F403
from .attack_chain_analyzer import *  # noqa: F401,F403

class IDSRuleEngine:
    """入侵检测规则引擎"""

    def __init__(self):
        self.engine_id = f"ids_{uuid.uuid4().hex[:8]}"
        self.rules: Dict[str, Dict[str, Any]] = {}
        self.alerts: deque = deque(maxlen=1000)
        self._lock = threading.RLock()
        self._load_default_rules()

    def _load_default_rules(self):
        """加载默认规则"""
        default_rules = [
            {
                "rule_id": "sql_injection_001",
                "name": "SQL注入检测",
                "description": "检测常见SQL注入攻击模式",
                "pattern": r"(union\s+select|or\s+1=1|--|;--|/\*|\*/|xp_cmdshell|information_schema)",
                "severity": "high",
                "category": "injection",
                "enabled": True,
            },
            {
                "rule_id": "xss_001",
                "name": "XSS攻击检测",
                "description": "检测跨站脚本攻击",
                "pattern": r"(<script|javascript:|onerror=|onload=|alert\(|document\.cookie|eval\()",
                "severity": "high",
                "category": "xss",
                "enabled": True,
            },
            {
                "rule_id": "path_traversal_001",
                "name": "路径遍历检测",
                "description": "检测目录遍历攻击",
                "pattern": r"(\.\./|\.\.\\|%2e%2e%2f|%2e%2e/|\.\.%2f)",
                "severity": "medium",
                "category": "traversal",
                "enabled": True,
            },
            {
                "rule_id": "command_injection_001",
                "name": "命令注入检测",
                "description": "检测操作系统命令注入",
                "pattern": r"(;\s*(ls|dir|cat|type|whoami|id|uname)|&&\s*(ls|dir)|`|\$\()",
                "severity": "critical",
                "category": "injection",
                "enabled": True,
            },
            {
                "rule_id": "brute_force_001",
                "name": "暴力破解检测",
                "description": "检测短时间内多次失败登录",
                "pattern": "",
                "severity": "medium",
                "category": "brute_force",
                "threshold": 5,
                "time_window": 60,
                "enabled": True,
            },
            {
                "rule_id": "ddos_001",
                "name": "DDoS攻击检测",
                "description": "检测异常高流量",
                "pattern": "",
                "severity": "high",
                "category": "ddos",
                "threshold": 1000,
                "time_window": 10,
                "enabled": True,
            },
            {
                "rule_id": "file_upload_001",
                "name": "恶意文件上传检测",
                "description": "检测可执行文件上传",
                "pattern": r"\.(exe|dll|bat|cmd|sh|php|asp|aspx|jsp)$",
                "severity": "high",
                "category": "malware",
                "enabled": True,
            },
            {
                "rule_id": "sensitive_data_001",
                "name": "敏感数据泄露检测",
                "description": "检测响应中的敏感信息",
                "pattern": r"(password\s*[:=]\s*\w+|api[_-]?key\s*[:=]\s*\w+|secret\s*[:=]\s*\w+|token\s*[:=]\s*\w+)",
                "severity": "critical",
                "category": "data_leak",
                "enabled": True,
            },
        ]
        for rule in default_rules:
            self.rules[rule["rule_id"]] = rule

    def add_rule(self, rule_id: str, name: str, pattern: str,
                 severity: str = "medium", category: str = "custom",
                 description: str = "", enabled: bool = True):
        self.rules[rule_id] = {
            "rule_id": rule_id,
            "name": name,
            "pattern": pattern,
            "severity": severity,
            "category": category,
            "description": description,
            "enabled": enabled,
            "created_at": time.time(),
            "match_count": 0,
            "last_match": 0.0,
        }

    def remove_rule(self, rule_id: str) -> bool:
        return self.rules.pop(rule_id, None) is not None

    def enable_rule(self, rule_id: str) -> bool:
        rule = self.rules.get(rule_id)
        if rule:
            rule["enabled"] = True
            return True
        return False

    def disable_rule(self, rule_id: str) -> bool:
        rule = self.rules.get(rule_id)
        if rule:
            rule["enabled"] = False
            return True
        return False

    def inspect(self, data: str, source: str = "",
                context: Optional[Dict] = None) -> List[Dict]:
        """检测数据中的攻击模式"""
        matches = []
        data_lower = data.lower()
        for rule_id, rule in self.rules.items():
            if not rule["enabled"] or not rule.get("pattern"):
                continue
            try:
                if re.search(rule["pattern"], data_lower, re.IGNORECASE):
                    rule["match_count"] += 1
                    rule["last_match"] = time.time()
                    alert = {
                        "alert_id": f"alert_{uuid.uuid4().hex[:6]}",
                        "rule_id": rule_id,
                        "rule_name": rule["name"],
                        "severity": rule["severity"],
                        "category": rule["category"],
                        "source": source,
                        "data_preview": data[:200],
                        "timestamp": time.time(),
                        "context": context or {},
                    }
                    matches.append(alert)
                    self.alerts.append(alert)
            except re.error:
                continue
        return matches

    def inspect_request(self, method: str, path: str,
                        headers: Optional[Dict] = None,
                        body: str = "", source_ip: str = "") -> List[Dict]:
        """检测HTTP请求"""
        all_matches = []
        # 检查路径
        all_matches.extend(self.inspect(path, source=f"{source_ip} path",
                                        context={"method": method, "path": path}))
        # 检查请求体
        if body:
            all_matches.extend(self.inspect(body, source=f"{source_ip} body",
                                            context={"method": method, "path": path}))
        # 检查User-Agent
        if headers:
            ua = headers.get("User-Agent", "")
            if ua:
                all_matches.extend(self.inspect(ua, source=f"{source_ip} ua",
                                                context={"method": method, "path": path}))
        return all_matches

    def get_alerts(self, severity: str = "", category: str = "",
                   limit: int = 50) -> List[Dict]:
        alerts = list(reversed(self.alerts))
        if severity:
            alerts = [a for a in alerts if a["severity"] == severity]
        if category:
            alerts = [a for a in alerts if a["category"] == category]
        return alerts[:limit]

    def list_rules(self, category: str = "", enabled_only: bool = False) -> List[Dict]:
        rules = list(self.rules.values())
        if category:
            rules = [r for r in rules if r["category"] == category]
        if enabled_only:
            rules = [r for r in rules if r["enabled"]]
        return rules

    def get_stats(self) -> Dict[str, Any]:
        return {
            "engine_id": self.engine_id,
            "total_rules": len(self.rules),
            "enabled_rules": sum(1 for r in self.rules.values() if r["enabled"]),
            "total_alerts": len(self.alerts),
            "by_severity": dict(Counter(a["severity"] for a in self.alerts)),
            "by_category": dict(Counter(a["category"] for a in self.alerts)),
            "top_rules": sorted(
                [(r["rule_id"], r["match_count"]) for r in self.rules.values()],
                key=lambda x: x[1], reverse=True
            )[:5],
        }
