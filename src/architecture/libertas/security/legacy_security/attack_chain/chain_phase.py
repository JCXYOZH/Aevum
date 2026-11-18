"""
security/attack_chain.py - 攻击链编排器

核心能力：
- 串联信息收集→资产发现→漏洞探测→漏洞验证→利用生成→报告生成的完整攻击链路
- 支持多种预设攻击链（Web应用链、网络服务链、代码审计链、综合链）
- 自动根据目标类型选择扫描策略
- 攻击链进度追踪和中间结果保存
- 支持断点续跑
- 与四大能力（记忆/工具/代码/大脑）深度整合
"""
import os
from pathlib import Path
from datetime import datetime, date
import re
import sys
import json
import time
import uuid
import threading
from typing import Any, Dict, List, Optional, Tuple, Callable
from dataclasses import dataclass, field, asdict, is_dataclass
from enum import Enum
from collections import defaultdict


# ================================================================
# 枚举和数据结构
# ================================================================

class ChainPhase(Enum):
    """攻击链阶段"""
    RECON = "recon"                    # 信息收集
    ASSET_DISCOVERY = "asset_discovery"  # 资产发现
    VULN_SCAN = "vuln_scan"            # 漏洞扫描
    VULN_VERIFY = "vuln_verify"        # 漏洞验证
    EXPLOIT_GENERATE = "exploit_generate"  # 利用代码生成
    POST_EXPLOIT = "post_exploit"      # 后渗透
    REPORT = "report"                   # 报告生成

class ChainStatus(Enum):
    """攻击链状态"""
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class TargetType(Enum):
    """目标类型"""
    WEB_APPLICATION = "web_application"
    NETWORK_SERVICE = "network_service"
    SOURCE_CODE = "source_code"
    API_ENDPOINT = "api_endpoint"
    MOBILE_APP = "mobile_app"
    UNKNOWN = "unknown"

@dataclass
class ChainPhaseResult:
    """阶段结果"""
    phase: ChainPhase
    status: ChainStatus = ChainStatus.PENDING
    started_at: float = 0.0
    completed_at: float = 0.0
    duration_seconds: float = 0.0
    findings: List[Dict] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    output_data: Dict = field(default_factory=dict)
    skipped: bool = False

    def start(self):
        self.status = ChainStatus.RUNNING
        self.started_at = time.time()

    def complete(self, findings: List[Dict] = None, output_data: Dict = None):
        self.status = ChainStatus.COMPLETED
        self.completed_at = time.time()
        self.duration_seconds = self.completed_at - self.started_at
        if findings:
            self.findings = findings
        if output_data:
            self.output_data = output_data

    def fail(self, error: str):
        self.status = ChainStatus.FAILED
        self.completed_at = time.time()
        self.duration_seconds = self.completed_at - self.started_at
        self.errors.append(error)

    def to_dict(self) -> Dict:
        return {
            "phase": self.phase.value,
            "status": self.status.value,
            "duration_seconds": round(self.duration_seconds, 2),
            "findings_count": len(self.findings),
            "errors": self.errors,
            "output_keys": list(self.output_data.keys()),
        }

@dataclass
class AttackTarget:
    """攻击目标"""
    target: str = ""
    target_type: TargetType = TargetType.UNKNOWN
    url: str = ""
    ip: str = ""
    domain: str = ""
    port: int = 0
    source_path: str = ""
    extra: Dict = field(default_factory=dict)

    def __post_init__(self):
        if self.target:
            self._parse_target()

    def _parse_target(self):
        """解析目标字符串"""
        t = self.target.strip()
        # URL
        if t.startswith(("http://", "https://")):
            self.target_type = TargetType.WEB_APPLICATION
            self.url = t
            from urllib.parse import urlparse
            parsed = urlparse(t)
            self.domain = parsed.hostname or ""
            self.port = parsed.port or (443 if parsed.scheme == "https" else 80)
        # IP地址
        elif re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$', t):
            self.target_type = TargetType.NETWORK_SERVICE
            self.ip = t
        # 域名
        elif re.match(r'^[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}$', t):
            self.target_type = TargetType.WEB_APPLICATION
            self.domain = t
            self.url = f"http://{t}"
        # 文件路径
        elif os.path.exists(t):
            self.target_type = TargetType.SOURCE_CODE
            self.source_path = t
        # IP:端口
        elif ":" in t and re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$', t):
            self.target_type = TargetType.NETWORK_SERVICE
            parts = t.split(":")
            self.ip = parts[0]
            self.port = int(parts[1])

    def to_dict(self) -> Dict:
        return {
            "target": self.target,
            "target_type": self.target_type.value,
            "url": self.url,
            "ip": self.ip,
            "domain": self.domain,
            "port": self.port,
            "source_path": self.source_path,
        }

@dataclass
class AttackChainResult:
    """攻击链结果"""
    chain_id: str = ""
    chain_name: str = ""
    target: AttackTarget = None
    status: ChainStatus = ChainStatus.PENDING
    started_at: float = 0.0
    completed_at: float = 0.0
    duration_seconds: float = 0.0
    phases: Dict[str, ChainPhaseResult] = field(default_factory=dict)
    all_vulnerabilities: List[Dict] = field(default_factory=list)
    all_findings: List[Dict] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    config: Dict = field(default_factory=dict)
    checkpoint_data: Dict = field(default_factory=dict)

    def __post_init__(self):
        if not self.chain_id:
            self.chain_id = f"chain_{uuid.uuid4().hex[:12]}"
        if not self.started_at:
            self.started_at = time.time()
        # 初始化所有阶段
        for phase in ChainPhase:
            if phase.value not in self.phases:
                self.phases[phase.value] = ChainPhaseResult(phase=phase)

    def get_phase(self, phase: ChainPhase) -> ChainPhaseResult:
        return self.phases[phase.value]

    def add_vulnerability(self, vuln: Dict):
        self.all_vulnerabilities.append(vuln)

    def add_finding(self, finding: Dict):
        self.all_findings.append(finding)

    def get_summary(self) -> Dict:
        return {
            "chain_id": self.chain_id,
            "chain_name": self.chain_name,
            "target": self.target.to_dict() if self.target else {},
            "status": self.status.value,
            "duration_seconds": round((self.completed_at or time.time()) - self.started_at, 2),
            "total_phases": len(self.phases),
            "completed_phases": sum(1 for p in self.phases.values() if p.status == ChainStatus.COMPLETED),
            "failed_phases": sum(1 for p in self.phases.values() if p.status == ChainStatus.FAILED),
            "total_vulnerabilities": len(self.all_vulnerabilities),
            "critical_vulns": sum(1 for v in self.all_vulnerabilities if v.get("severity") == "critical"),
            "high_vulns": sum(1 for v in self.all_vulnerabilities if v.get("severity") == "high"),
            "total_findings": len(self.all_findings),
            "total_errors": len(self.errors),
            "phases": {k: v.to_dict() for k, v in self.phases.items()},
        }

    def to_dict(self) -> Dict:
        d = self.get_summary()
        d["vulnerabilities"] = self.all_vulnerabilities
        d["findings"] = self.all_findings
        d["errors"] = self.errors
        return d

    def save_checkpoint(self, path: str):
        """保存检查点（断点续跑）"""
        data = {
            "chain_id": self.chain_id,
            "chain_name": self.chain_name,
            "target": self.target.to_dict() if self.target else {},
            "status": self.status.value,
            "started_at": self.started_at,
            "phases": {k: v.to_dict() for k, v in self.phases.items()},
            "vulnerabilities": self.all_vulnerabilities,
            "findings": self.all_findings,
            "config": self.config,
            "saved_at": time.time(),
        }
        # 原来这里是直接 open(path, 'w') + json.dump：config 里的 ChainPhase 枚举
        # 会让 json.dump 抛异常，而文件已被截断，落盘的就是残缺 JSON。
        # 改用「先序列化再原子替换」，序列化失败时原文件不受影响。
        _atomic_write_json(path, data)

def _json_safe(obj, _depth=0):
    """把任意对象递归转成 json.dump 一定能序列化的形状。

    攻击链的 config 里存的是 ChainPhase 这类枚举，直接 json.dump 会抛
    "Object of type ChainPhase is not JSON serializable"。而 json.dump 是边写边输出，
    异常发生时文件已经被写了一半 —— 落盘的就是残缺 JSON，且再也读不回来。
    """
    if _depth > 12:
        return str(obj)
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, bytes):
        try:
            return obj.decode('utf-8', errors='replace')
        except Exception:
            return repr(obj)
    if isinstance(obj, Path):
        return str(obj)
    if isinstance(obj, dict):
        return {str(k): _json_safe(v, _depth + 1) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set, frozenset)):
        return [_json_safe(v, _depth + 1) for v in obj]
    # dataclass / 自带 to_dict() 的对象
    for attr in ("to_dict", "as_dict"):
        fn = getattr(obj, attr, None)
        if callable(fn):
            try:
                return _json_safe(fn(), _depth + 1)
            except Exception:
                pass
    if is_dataclass(obj):
        try:
            return _json_safe(asdict(obj), _depth + 1)
        except Exception:
            pass
    if hasattr(obj, "__dict__"):
        try:
            return {str(k): _json_safe(v, _depth + 1)
                    for k, v in vars(obj).items() if not str(k).startswith("_")}
        except Exception:
            pass
    return str(obj)
