"""职责模块：models。"""

from __future__ import annotations

from typing import Optional, Dict, List, Tuple, Set, Callable, Any
from enum import Enum
from dataclasses import dataclass, field
import time

from .constants import GOSSIP_MAX_HOPS
from .constants import INITIAL_REPUTATION

class TaskStatus(Enum):
    PENDING = "pending"
    ASSIGNED = "assigned"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"

class VoteType(Enum):
    ACCURATE = "accurate"
    INACCURATE = "inaccurate"
    SPAM = "spam"
    DUPLICATE = "duplicate"

@dataclass
class ScanTask:
    """扫描任务"""
    task_id: str
    creator: str  # 创建者节点ID
    target: str  # 目标（IP/CIDR/域名）
    ports: List[int]
    scan_type: str = "quick"
    priority: int = 0
    status: str = "pending"
    assigned_to: str = ""  # 分配给哪个节点
    created_at: float = field(default_factory=time.time)
    assigned_at: float = 0.0
    completed_at: float = 0.0
    result_count: int = 0
    options: Dict = field(default_factory=dict)
    reputation_stake: float = 0.0  # 创建者抵押的信誉

    def to_dict(self) -> Dict:
        return {
            "task_id": self.task_id,
            "creator": self.creator,
            "target": self.target,
            "ports": self.ports,
            "scan_type": self.scan_type,
            "priority": self.priority,
            "status": self.status,
            "assigned_to": self.assigned_to,
            "created_at": self.created_at,
            "assigned_at": self.assigned_at,
            "completed_at": self.completed_at,
            "result_count": self.result_count,
            "options": self.options,
        }

@dataclass
class ScanResult:
    """扫描结果"""
    result_id: str
    task_id: str
    scanner: str  # 扫描者节点ID
    asset_ip: str
    open_ports: List[Dict]
    fingerprints: List[str]
    cves: List[str]
    risk_score: float
    timestamp: float = field(default_factory=time.time)
    reputation: float = INITIAL_REPUTATION  # 扫描者当时的信誉
    ttl: int = GOSSIP_MAX_HOPS
    verified_by: List[str] = field(default_factory=list)  # 验证者列表
    version_vector: Dict[str, int] = field(default_factory=dict)  # 版本向量

    def to_dict(self) -> Dict:
        return {
            "result_id": self.result_id,
            "task_id": self.task_id,
            "scanner": self.scanner,
            "asset_ip": self.asset_ip,
            "open_ports": self.open_ports,
            "fingerprints": self.fingerprints,
            "cves": self.cves,
            "risk_score": self.risk_score,
            "timestamp": self.timestamp,
            "reputation": self.reputation,
            "ttl": self.ttl,
            "verified_by": self.verified_by,
            "version_vector": self.version_vector,
        }

@dataclass
class ReputationRecord:
    """信誉记录"""
    node_id: str
    reputation: float = INITIAL_REPUTATION
    total_votes: int = 0
    accurate_votes: int = 0
    inaccurate_votes: int = 0
    tasks_completed: int = 0
    tasks_failed: int = 0
    results_submitted: int = 0
    results_verified: int = 0
    first_seen: float = field(default_factory=time.time)
    last_active: float = field(default_factory=time.time)
    is_isolated: bool = False
    is_authority: bool = False
    ip_prefix: str = ""  # 用于Sybil防护

    def to_dict(self) -> Dict:
        return {
            "node_id": self.node_id,
            "reputation": self.reputation,
            "total_votes": self.total_votes,
            "accurate_votes": self.accurate_votes,
            "inaccurate_votes": self.inaccurate_votes,
            "tasks_completed": self.tasks_completed,
            "tasks_failed": self.tasks_failed,
            "results_submitted": self.results_submitted,
            "results_verified": self.results_verified,
            "first_seen": self.first_seen,
            "last_active": self.last_active,
            "is_isolated": self.is_isolated,
            "is_authority": self.is_authority,
        }

@dataclass
class AssetRecord:
    """P2P网络中的资产记录（多源合并）"""
    asset_ip: str
    sources: Dict[str, Dict] = field(default_factory=dict)  # node_id -> 该节点的扫描结果
    merged_ports: List[Dict] = field(default_factory=list)
    merged_fingerprints: List[str] = field(default_factory=list)
    merged_cves: List[str] = field(default_factory=list)
    merged_risk_score: float = 0.0
    consensus_level: float = 0.0  # 共识程度（0-1）
    last_updated: float = field(default_factory=time.time)
    version_vector: Dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "asset_ip": self.asset_ip,
            "source_count": len(self.sources),
            "merged_ports": self.merged_ports,
            "merged_fingerprints": self.merged_fingerprints,
            "merged_cves": self.merged_cves,
            "merged_risk_score": self.merged_risk_score,
            "consensus_level": self.consensus_level,
            "last_updated": self.last_updated,
        }
