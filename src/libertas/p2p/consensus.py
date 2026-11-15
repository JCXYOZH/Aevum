"""
Libertas - P2P自治规则层
========================
去中心化协作的核心：任务分发、结果Gossip、信誉系统、冲突解决、防滥用。

核心能力：
1. 任务分片与分发（按能力/负载/信誉分配）
2. 结果Gossip传播（指数级覆盖全网）
3. 多源验证与冲突解决（信誉加权平均）
4. 信誉系统（初始0.5，准确+，虚假-，阈值隔离）
5. 防滥用（工作量证明、速率限制、Sybil防护）
6. 数据一致性（版本向量、最终一致性）
7. 节点退出与数据迁移
8. 攻击面分析与暴露面评估

版本：1.0.0
"""

import asyncio
import json
import time
import hashlib
import uuid
import os
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple, Set, Callable, Any
from enum import Enum
from collections import defaultdict
import logging

from .transport import NodeIdentity, ConnectionManager, P2PConnection, Message, ChannelType
from .protocol import ProtocolHandler, NodeCapabilities, ProofOfWork
from .dht import DHTNode as DHTNodeCore, compute_key
from .paths import DEFAULT_STATE_DIR

logger = logging.getLogger(__name__)


# ============================================================
# 常量
# ============================================================

INITIAL_REPUTATION = 0.5
REPUTATION_INCREASE = 0.01
REPUTATION_DECREASE = 0.1
REPUTATION_THRESHOLD_ISOLATE = 0.3
REPUTATION_THRESHOLD_AUTHORITY = 0.9
REPUTATION_AUTHORITY_MULTIPLIER = 2.0
GOSSIP_FANOUT = 3  # 每个结果转发给3个邻居
GOSSIP_MAX_HOPS = 5
TASK_TIMEOUT = 300  # 任务超时5分钟
TASK_REASSIGN_DELAY = 60  # 任务重新分配延迟
MAX_TASKS_PER_NODE = 10
SYBIL_IP_PREFIX_LIMIT = 5  # 同一/24网段最多5个节点
RATE_LIMIT_PER_PEER = 100  # 每个邻居每秒最多消息数
DATA_SYNC_INTERVAL = 300  # 数据同步间隔5分钟


# ============================================================
# 数据结构
# ============================================================

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


# ============================================================
# 任务分发器
# ============================================================

class TaskDistributor:
    """
    任务分片与分发器
    按节点能力、当前负载、信誉分配任务
    """

    def __init__(self, consensus: "ConsensusEngine"):
        self.consensus = consensus
        self.tasks: Dict[str, ScanTask] = {}
        self._task_lock = asyncio.Lock()
        self._reassign_task: Optional[asyncio.Task] = None

    async def create_task(self, target: str, ports: List[int],
                           scan_type: str = "quick", priority: int = 0,
                           options: Optional[Dict] = None) -> ScanTask:
        """创建扫描任务"""
        task = ScanTask(
            task_id=str(uuid.uuid4())[:8],
            creator=self.consensus.identity.node_id,
            target=target,
            ports=ports,
            scan_type=scan_type,
            priority=priority,
            options=options or {},
            reputation_stake=min(0.1, self.consensus.get_reputation(self.consensus.identity.node_id) * 0.1),
        )

        async with self._task_lock:
            self.tasks[task.task_id] = task

        # 广播任务到网络
        await self._broadcast_task(task)

        # 尝试分配
        await self._assign_task(task)

        return task

    async def _broadcast_task(self, task: ScanTask):
        """广播任务到网络"""
        msg = Message(
            channel=ChannelType.SCAN.value,
            message_type="SCAN_TASK",
            payload=task.to_dict(),
            source_node=self.consensus.identity.node_id,
        )
        await self.consensus.protocol.broadcast_message(
            "SCAN_TASK", task.to_dict(), channel=ChannelType.SCAN.value
        )

    async def _assign_task(self, task: ScanTask) -> bool:
        """
        分配任务给最合适的节点

        选择标准：
        1. 有对应能力
        2. 当前负载最低
        3. 信誉最高
        4. 网络延迟最低
        """
        candidates = await self._find_candidates(task)
        if not candidates:
            # 没有合适的候选节点，自己执行
            task.assigned_to = self.consensus.identity.node_id
            task.status = "assigned"
            task.assigned_at = time.time()
            asyncio.create_task(self._execute_task_local(task))
            return True

        # 选择最佳候选
        best = candidates[0]
        task.assigned_to = best["node_id"]
        task.status = "assigned"
        task.assigned_at = time.time()

        # 发送任务分配通知
        await self.consensus.protocol.send_message(
            best["node_id"], "SCAN_TASK_ASSIGN",
            task.to_dict(), channel=ChannelType.SCAN.value
        )

        return True

    async def _find_candidates(self, task: ScanTask) -> List[Dict]:
        """找到合适的候选节点"""
        candidates = []
        connected_nodes = self.consensus.protocol.conn_manager.get_all_connections()

        for conn in connected_nodes:
            node_id = conn.node_id
            if not node_id:
                continue

            # 检查是否被隔离
            if self.consensus.is_isolated(node_id):
                continue

            # 检查能力
            node_info = self.consensus.protocol.get_node_info(node_id)
            if not node_info:
                continue

            caps = node_info.capabilities
            if task.scan_type == "vuln_verify" and not caps.get("vuln_verify", False):
                continue
            if task.scan_type == "weak_password" and not caps.get("weak_password", False):
                continue

            # 检查当前负载
            node_tasks = [t for t in self.tasks.values()
                          if t.assigned_to == node_id and t.status in ("assigned", "running")]
            if len(node_tasks) >= MAX_TASKS_PER_NODE:
                continue

            # 计算综合评分
            reputation = self.consensus.get_reputation(node_id)
            latency = conn.stats.latency_ms
            load = len(node_tasks) / MAX_TASKS_PER_NODE

            score = reputation * 0.5 + (1 - load) * 0.3 + (1 - min(latency / 1000, 1)) * 0.2

            candidates.append({
                "node_id": node_id,
                "score": score,
                "reputation": reputation,
                "latency": latency,
                "load": load,
            })

        # 按评分排序
        candidates.sort(key=lambda x: x["score"], reverse=True)
        return candidates[:5]  # 返回前5个候选

    async def _execute_task_local(self, task: ScanTask):
        """本地执行任务"""
        task.status = "running"
        try:
            # 调用实际的扫描引擎（由上层注入）
            if self.consensus.scan_executor:
                results = await self.consensus.scan_executor(
                    task.target, task.ports, task.scan_type, task.options
                )
                task.result_count = len(results)

                # 提交结果
                for result_data in results:
                    await self.consensus.result_gossip.submit_result(task, result_data)

            task.status = "completed"
            task.completed_at = time.time()

            # 增加完成任务计数
            self.consensus.reputation_system.record_task_completed(
                self.consensus.identity.node_id
            )

        except Exception as e:
            task.status = "failed"
            task.completed_at = time.time()
            logger.error(f"任务执行失败 {task.task_id}: {e}")

            # 记录失败
            self.consensus.reputation_system.record_task_failed(
                self.consensus.identity.node_id
            )

        # 广播任务完成
        await self.consensus.protocol.broadcast_message(
            "TASK_COMPLETE", task.to_dict(), channel=ChannelType.SCAN.value
        )

    async def handle_task_assignment(self, task_data: Dict):
        """处理被分配的任务"""
        task_id = task_data.get("task_id", "")
        if task_id in self.tasks:
            task = self.tasks[task_id]
        else:
            task = ScanTask(**{k: v for k, v in task_data.items()
                               if k in ScanTask.__dataclass_fields__})
            self.tasks[task_id] = task

        task.assigned_to = self.consensus.identity.node_id
        task.status = "assigned"
        task.assigned_at = time.time()

        # 本地执行
        asyncio.create_task(self._execute_task_local(task))

    async def check_timeouts(self):
        """检查超时任务并重新分配"""
        now = time.time()
        for task in list(self.tasks.values()):
            if task.status in ("assigned", "running"):
                if now - task.assigned_at > TASK_TIMEOUT:
                    # 任务超时
                    task.status = "timeout"

                    # 扣除执行者信誉
                    if task.assigned_to and task.assigned_to != self.consensus.identity.node_id:
                        self.consensus.reputation_system.decrease_reputation(
                            task.assigned_to, REPUTATION_DECREASE
                        )

                    # 退还创建者抵押
                    # 重新分配
                    await self._assign_task(task)

    def get_task(self, task_id: str) -> Optional[ScanTask]:
        return self.tasks.get(task_id)

    def get_all_tasks(self) -> List[ScanTask]:
        return list(self.tasks.values())

    async def start_reassign_loop(self):
        """启动任务超时检查循环"""
        while True:
            try:
                await self.check_timeouts()
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"任务重分配异常: {e}")
                await asyncio.sleep(30)


# ============================================================
# 结果Gossip传播器
# ============================================================

class ResultGossip:
    """
    结果Gossip传播器
    指数级传播扫描结果，多源验证
    """

    def __init__(self, consensus: "ConsensusEngine"):
        self.consensus = consensus
        self.seen_results: Set[str] = set()  # 已处理的结果ID（防重复）
        self._gossip_lock = asyncio.Lock()

    async def submit_result(self, task: ScanTask, result_data: Dict):
        """提交扫描结果并Gossip传播"""
        result = ScanResult(
            result_id=str(uuid.uuid4())[:8],
            task_id=task.task_id,
            scanner=self.consensus.identity.node_id,
            asset_ip=result_data.get("ip", ""),
            open_ports=result_data.get("ports", []),
            fingerprints=result_data.get("fingerprints", []),
            cves=result_data.get("cves", []),
            risk_score=result_data.get("risk_score", 0.0),
            reputation=self.consensus.get_reputation(self.consensus.identity.node_id),
        )

        # 初始化版本向量
        result.version_vector[self.consensus.identity.node_id] = 1

        # 本地入库
        await self.consensus.asset_merger.merge_result(result)

        # Gossip传播
        await self._gossip_result(result)

    async def _gossip_result(self, result: ScanResult):
        """Gossip传播结果给随机K个邻居"""
        if result.ttl <= 0:
            return

        if result.result_id in self.seen_results:
            return
        self.seen_results.add(result.result_id)

        # 选择随机K个邻居
        connections = self.consensus.protocol.conn_manager.get_all_connections()
        if len(connections) <= GOSSIP_FANOUT:
            targets = connections
        else:
            import random
            targets = random.sample(connections, GOSSIP_FANOUT)

        # 减少TTL
        result.ttl -= 1

        # 发送
        msg_payload = result.to_dict()
        for conn in targets:
            if conn.node_id:
                await self.consensus.protocol.send_message(
                    conn.node_id, "SCAN_RESULT", msg_payload,
                    channel=ChannelType.SCAN.value, timeout=5.0
                )

    async def handle_result(self, result_data: Dict):
        """处理收到的扫描结果"""
        result_id = result_data.get("result_id", "")
        if result_id in self.seen_results:
            # 已处理过，不再传播
            return

        self.seen_results.add(result_id)

        # 构造结果对象
        result = ScanResult(
            result_id=result_id,
            task_id=result_data.get("task_id", ""),
            scanner=result_data.get("scanner", ""),
            asset_ip=result_data.get("asset_ip", ""),
            open_ports=result_data.get("open_ports", []),
            fingerprints=result_data.get("fingerprints", []),
            cves=result_data.get("cves", []),
            risk_score=result_data.get("risk_score", 0.0),
            timestamp=result_data.get("timestamp", time.time()),
            reputation=result_data.get("reputation", INITIAL_REPUTATION),
            ttl=result_data.get("ttl", GOSSIP_MAX_HOPS),
            verified_by=result_data.get("verified_by", []),
            version_vector=result_data.get("version_vector", {}),
        )

        # 验证结果（如果有能力）
        if self.consensus.should_verify(result):
            verified = await self.consensus.verify_result(result)
            if verified:
                result.verified_by.append(self.consensus.identity.node_id)
                # 投票给扫描者
                await self.consensus.reputation_system.vote(
                    result.scanner, self.consensus.identity.node_id, "accurate"
                )
            else:
                # 结果不准确，投票
                await self.consensus.reputation_system.vote(
                    result.scanner, self.consensus.identity.node_id, "inaccurate"
                )
                return  # 不准确的结果不传播

        # 本地入库（多源合并）
        await self.consensus.asset_merger.merge_result(result)

        # 继续Gossip传播
        if result.ttl > 0:
            result.ttl -= 1
            await self._gossip_result(result)


# ============================================================
# 信誉系统
# ============================================================

class ReputationSystem:
    """
    信誉系统
    初始0.5，准确+，虚假-，阈值隔离，权威节点加权
    """

    def __init__(self, consensus: "ConsensusEngine", state_dir: str = DEFAULT_STATE_DIR):
        self.consensus = consensus
        self.state_dir = state_dir
        self.reputations: Dict[str, ReputationRecord] = {}
        self._vote_lock = asyncio.Lock()
        os.makedirs(state_dir, exist_ok=True)
        self._load()

    def get_reputation(self, node_id: str) -> float:
        """获取节点信誉"""
        if node_id == self.consensus.identity.node_id:
            return 1.0  # 自己信誉最高
        record = self.reputations.get(node_id)
        if record:
            return record.reputation
        return INITIAL_REPUTATION

    def get_record(self, node_id: str) -> ReputationRecord:
        """获取信誉记录"""
        if node_id not in self.reputations:
            self.reputations[node_id] = ReputationRecord(
                node_id=node_id,
                ip_prefix=self._get_ip_prefix(node_id),
            )
        return self.reputations[node_id]

    def _get_ip_prefix(self, node_id: str) -> str:
        """获取节点IP前缀（用于Sybil防护）"""
        node_info = self.consensus.protocol.get_node_info(node_id)
        if node_info and node_info.address:
            parts = node_info.address.split(".")
            if len(parts) >= 3:
                return ".".join(parts[:3])
        return ""

    async def vote(self, target_node: str, voter_node: str, vote_type: str):
        """
        对节点投票

        Args:
            target_node: 被投票节点
            voter_node: 投票节点
            vote_type: accurate/inaccurate/spam/duplicate
        """
        async with self._vote_lock:
            record = self.get_record(target_node)
            record.total_votes += 1
            record.last_active = time.time()

            if vote_type == "accurate":
                record.accurate_votes += 1
                # 信誉增加（投票者信誉越高，增加越多）
                voter_rep = self.get_reputation(voter_node)
                increase = REPUTATION_INCREASE * voter_rep
                record.reputation = min(1.0, record.reputation + increase)

            elif vote_type in ("inaccurate", "spam"):
                record.inaccurate_votes += 1
                # 信誉减少
                voter_rep = self.get_reputation(voter_node)
                decrease = REPUTATION_DECREASE * voter_rep
                record.reputation = max(0.0, record.reputation - decrease)

            # 检查是否需要隔离
            if record.reputation < REPUTATION_THRESHOLD_ISOLATE:
                record.is_isolated = True
                logger.warning(f"节点 {target_node} 被隔离，信誉: {record.reputation}")

            # 检查是否成为权威节点
            if record.reputation >= REPUTATION_THRESHOLD_AUTHORITY and \
               record.total_votes >= 10 and \
               record.accurate_votes / record.total_votes > 0.9:
                record.is_authority = True

            self._save()

    def record_task_completed(self, node_id: str):
        """记录任务完成"""
        record = self.get_record(node_id)
        record.tasks_completed += 1
        record.last_active = time.time()
        self._save()

    def record_task_failed(self, node_id: str):
        """记录任务失败"""
        record = self.get_record(node_id)
        record.tasks_failed += 1
        record.last_active = time.time()
        # 失败降低信誉
        record.reputation = max(0.0, record.reputation - REPUTATION_DECREASE / 2)
        self._save()

    def record_result_submitted(self, node_id: str):
        """记录结果提交"""
        record = self.get_record(node_id)
        record.results_submitted += 1
        record.last_active = time.time()

    def record_result_verified(self, node_id: str):
        """记录结果被验证"""
        record = self.get_record(node_id)
        record.results_verified += 1

    def decrease_reputation(self, node_id: str, amount: float):
        """直接降低信誉"""
        record = self.get_record(node_id)
        record.reputation = max(0.0, record.reputation - amount)
        if record.reputation < REPUTATION_THRESHOLD_ISOLATE:
            record.is_isolated = True
        self._save()

    def is_isolated(self, node_id: str) -> bool:
        """检查节点是否被隔离"""
        record = self.reputations.get(node_id)
        return record.is_isolated if record else False

    def is_authority(self, node_id: str) -> bool:
        """检查节点是否是权威节点"""
        record = self.reputations.get(node_id)
        return record.is_authority if record else False

    def check_sybil(self, node_id: str) -> bool:
        """
        Sybil攻击检测
        同一/24网段超过限制数量的节点，新节点信誉上限

        Returns:
            是否是可疑Sybil节点
        """
        record = self.get_record(node_id)
        if not record.ip_prefix:
            return False

        # 统计同一网段的节点数
        same_prefix = [r for r in self.reputations.values()
                       if r.ip_prefix == record.ip_prefix]

        if len(same_prefix) > SYBIL_IP_PREFIX_LIMIT:
            # 超过限制，新节点信誉上限
            if record.total_votes < 5:
                record.reputation = min(record.reputation, INITIAL_REPUTATION)
                return True

        return False

    def get_all_reputations(self) -> List[ReputationRecord]:
        """获取所有信誉记录"""
        return sorted(self.reputations.values(), key=lambda r: r.reputation, reverse=True)

    def get_stats(self) -> Dict:
        """获取信誉系统统计"""
        total = len(self.reputations)
        isolated = sum(1 for r in self.reputations.values() if r.is_isolated)
        authority = sum(1 for r in self.reputations.values() if r.is_authority)
        avg_rep = sum(r.reputation for r in self.reputations.values()) / total if total > 0 else 0

        return {
            "total_nodes": total,
            "isolated_nodes": isolated,
            "authority_nodes": authority,
            "average_reputation": round(avg_rep, 4),
            "total_votes": sum(r.total_votes for r in self.reputations.values()),
        }

    def _save(self):
        """持久化信誉数据"""
        try:
            filepath = os.path.join(self.state_dir, "reputations.json")
            data = {nid: rec.to_dict() for nid, rec in self.reputations.items()}
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
        except Exception as e:
            logger.error(f"信誉数据持久化失败: {e}")

    def _load(self):
        """加载信誉数据"""
        try:
            filepath = os.path.join(self.state_dir, "reputations.json")
            if os.path.exists(filepath):
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for nid, rec_data in data.items():
                    rec = ReputationRecord(
                        node_id=nid,
                        reputation=rec_data.get("reputation", INITIAL_REPUTATION),
                        total_votes=rec_data.get("total_votes", 0),
                        accurate_votes=rec_data.get("accurate_votes", 0),
                        inaccurate_votes=rec_data.get("inaccurate_votes", 0),
                        tasks_completed=rec_data.get("tasks_completed", 0),
                        tasks_failed=rec_data.get("tasks_failed", 0),
                        results_submitted=rec_data.get("results_submitted", 0),
                        results_verified=rec_data.get("results_verified", 0),
                        first_seen=rec_data.get("first_seen", time.time()),
                        last_active=rec_data.get("last_active", time.time()),
                        is_isolated=rec_data.get("is_isolated", False),
                        is_authority=rec_data.get("is_authority", False),
                        ip_prefix=rec_data.get("ip_prefix", ""),
                    )
                    self.reputations[nid] = rec
        except Exception as e:
            logger.error(f"信誉数据加载失败: {e}")


# ============================================================
# 资产多源合并器
# ============================================================

class AssetMerger:
    """
    资产多源合并器
    多个节点扫描同一资产时，信誉加权合并，冲突解决
    """

    def __init__(self, consensus: "ConsensusEngine"):
        self.consensus = consensus
        self.assets: Dict[str, AssetRecord] = {}
        self._merge_lock = asyncio.Lock()

    async def merge_result(self, result: ScanResult):
        """合并扫描结果到资产记录"""
        async with self._merge_lock:
            ip = result.asset_ip
            if ip not in self.assets:
                self.assets[ip] = AssetRecord(asset_ip=ip)

            asset = self.assets[ip]

            # 记录来源
            asset.sources[result.scanner] = result.to_dict()

            # 更新版本向量
            asset.version_vector[result.scanner] = \
                asset.version_vector.get(result.scanner, 0) + 1

            # 信誉加权合并端口
            await self._merge_ports(asset, result)

            # 合并指纹
            for fp in result.fingerprints:
                if fp not in asset.merged_fingerprints:
                    asset.merged_fingerprints.append(fp)

            # 合并CVE
            for cve in result.cves:
                if cve not in asset.merged_cves:
                    asset.merged_cves.append(cve)

            # 信誉加权风险评分
            await self._merge_risk_score(asset, result)

            # 计算共识程度
            asset.consensus_level = self._calculate_consensus(asset)

            asset.last_updated = time.time()

            # 通知上层入库
            if self.consensus.on_asset_merged:
                try:
                    await self.consensus.on_asset_merged(asset)
                except Exception as e:
                    logger.error(f"资产合并回调异常: {e}")

    async def _merge_ports(self, asset: AssetRecord, result: ScanResult):
        """信誉加权合并端口"""
        scanner_rep = self.consensus.get_reputation(result.scanner)
        if self.consensus.reputation_system.is_authority(result.scanner):
            scanner_rep *= REPUTATION_AUTHORITY_MULTIPLIER

        # 统计每个端口的投票
        port_votes: Dict[int, List[Tuple[str, float]]] = {}  # port -> [(state, reputation)]

        for source_id, source_data in asset.sources.items():
            source_rep = self.consensus.get_reputation(source_id)
            if self.consensus.reputation_system.is_authority(source_id):
                source_rep *= REPUTATION_AUTHORITY_MULTIPLIER

            for port_data in source_data.get("open_ports", []):
                port = port_data.get("port", 0)
                state = port_data.get("state", "open")
                if port not in port_votes:
                    port_votes[port] = []
                port_votes[port].append((state, source_rep))

        # 合并：加权投票，超过50%权重认为开放
        merged_ports = []
        for port, votes in port_votes.items():
            open_weight = sum(rep for state, rep in votes if state == "open")
            total_weight = sum(rep for _, rep in votes)

            if total_weight > 0 and open_weight / total_weight > 0.5:
                # 找到最新的端口数据
                latest_port_data = None
                latest_time = 0
                for source_id, source_data in asset.sources.items():
                    for port_data in source_data.get("open_ports", []):
                        if port_data.get("port") == port and source_data.get("timestamp", 0) > latest_time:
                            latest_port_data = port_data
                            latest_time = source_data.get("timestamp", 0)

                if latest_port_data:
                    merged_ports.append(latest_port_data)

        asset.merged_ports = merged_ports

    async def _merge_risk_score(self, asset: AssetRecord, result: ScanResult):
        """信誉加权合并风险评分"""
        total_weight = 0.0
        weighted_score = 0.0

        for source_id, source_data in asset.sources.items():
            source_rep = self.consensus.get_reputation(source_id)
            if self.consensus.reputation_system.is_authority(source_id):
                source_rep *= REPUTATION_AUTHORITY_MULTIPLIER

            score = source_data.get("risk_score", 0.0)
            weighted_score += score * source_rep
            total_weight += source_rep

        if total_weight > 0:
            asset.merged_risk_score = weighted_score / total_weight

    def _calculate_consensus(self, asset: AssetRecord) -> float:
        """计算共识程度（0-1）"""
        if len(asset.sources) < 2:
            return 1.0  # 只有一个来源，默认完全共识

        # 比较各来源的端口列表相似度
        source_ports = []
        for source_data in asset.sources.values():
            ports = set(p.get("port", 0) for p in source_data.get("open_ports", []))
            source_ports.append(ports)

        if not source_ports:
            return 0.0

        # 计算Jaccard相似度
        intersection = set.intersection(*source_ports) if source_ports else set()
        union = set.union(*source_ports) if source_ports else set()

        if not union:
            return 1.0

        return len(intersection) / len(union)

    def get_asset(self, ip: str) -> Optional[AssetRecord]:
        return self.assets.get(ip)

    def get_all_assets(self) -> List[AssetRecord]:
        return list(self.assets.values())

    def get_assets_by_risk(self, min_risk: float = 0.0) -> List[AssetRecord]:
        return [a for a in self.assets.values() if a.merged_risk_score >= min_risk]

    def get_stats(self) -> Dict:
        total = len(self.assets)
        high_risk = len([a for a in self.assets.values() if a.merged_risk_score >= 70])
        multi_source = len([a for a in self.assets.values() if len(a.sources) >= 2])
        avg_consensus = sum(a.consensus_level for a in self.assets.values()) / total if total > 0 else 0

        return {
            "total_assets": total,
            "high_risk_assets": high_risk,
            "multi_source_assets": multi_source,
            "average_consensus": round(avg_consensus, 4),
        }


# ============================================================
# 自治引擎（整合所有层）
# ============================================================

class ConsensusEngine:
    """
    P2P自治规则引擎
    整合任务分发、结果Gossip、信誉系统、资产合并、防滥用
    """

    def __init__(self, identity: NodeIdentity, protocol: ProtocolHandler,
                 dht_node: Optional[DHTNodeCore] = None,
                 state_dir: str = DEFAULT_STATE_DIR):
        self.identity = identity
        self.protocol = protocol
        self.dht_node = dht_node
        self.state_dir = state_dir

        # 子系统
        self.task_distributor = TaskDistributor(self)
        self.result_gossip = ResultGossip(self)
        self.reputation_system = ReputationSystem(self, state_dir)
        self.asset_merger = AssetMerger(self)

        # 扫描执行器（由上层注入）
        self.scan_executor: Optional[Callable] = None

        # 资产合并回调
        self.on_asset_merged: Optional[Callable] = None

        # 速率限制
        self._rate_limits: Dict[str, List[float]] = defaultdict(list)

        # 后台任务
        self._maintenance_task: Optional[asyncio.Task] = None
        self._sync_task: Optional[asyncio.Task] = None

        # 注册协议处理器
        self._register_protocol_handlers()

    def _register_protocol_handlers(self):
        """注册协议层消息处理器"""
        self.protocol.register_handler("SCAN_TASK", self._handle_scan_task_message)
        self.protocol.register_handler("SCAN_RESULT", self._handle_scan_result_message)
        self.protocol.register_handler("TASK_COMPLETE", self._handle_task_complete_message)
        self.protocol.register_handler("SCAN_TASK_ASSIGN", self._handle_task_assign_message)
        self.protocol.register_handler("ASSET_SYNC", self._handle_asset_sync_message)
        self.protocol.register_handler("ASSET_SYNC_REQUEST", self._handle_asset_sync_request_message)
        self.protocol.register_handler("REPUTATION_VOTE", self._handle_reputation_vote_message)
        self.protocol.register_handler("REPUTATION_QUERY", self._handle_reputation_query_message)

    def set_scan_executor(self, executor: Callable):
        """设置扫描执行器（由上层注入）"""
        self.scan_executor = executor

    def set_on_asset_merged(self, callback: Callable):
        """设置资产合并回调"""
        self.on_asset_merged = callback

    # ============================================================
    # 公开API
    # ============================================================

    async def create_scan_task(self, target: str, ports: List[int],
                                scan_type: str = "quick", priority: int = 0,
                                options: Optional[Dict] = None) -> ScanTask:
        """创建扫描任务（自动分发到网络）"""
        return await self.task_distributor.create_task(
            target, ports, scan_type, priority, options
        )

    def get_reputation(self, node_id: str) -> float:
        """获取节点信誉"""
        return self.reputation_system.get_reputation(node_id)

    def is_isolated(self, node_id: str) -> bool:
        """检查节点是否被隔离"""
        return self.reputation_system.is_isolated(node_id)

    def should_verify(self, result: ScanResult) -> bool:
        """
        判断是否应该验证这个结果
        低信誉节点的结果、高风险资产、多源冲突时验证
        """
        scanner_rep = self.get_reputation(result.scanner)
        if scanner_rep < 0.7:
            return True  # 低信誉节点结果需要验证
        if result.risk_score >= 70:
            return True  # 高风险需要验证
        if result.asset_ip in self.asset_merger.assets:
            asset = self.asset_merger.assets[result.asset_ip]
            if asset.consensus_level < 0.8:
                return True  # 低共识需要验证
        return False

    async def verify_result(self, result: ScanResult) -> bool:
        """
        验证扫描结果（重新扫描关键端口）
        由上层注入的扫描执行器执行
        """
        if not self.scan_executor:
            return True  # 没有执行器，默认信任

        try:
            # 只验证前3个端口
            verify_ports = [p.get("port", 0) for p in result.open_ports[:3]]
            if not verify_ports:
                return True

            verify_results = await self.scan_executor(
                result.asset_ip, verify_ports, "verify", {}
            )

            # 比较结果
            if verify_results:
                verified_ports = set(p.get("port", 0) for p in verify_results[0].get("ports", []))
                original_ports = set(p.get("port", 0) for p in result.open_ports[:3])
                # 80%以上匹配则认为准确
                if original_ports:
                    overlap = len(verified_ports & original_ports)
                    return overlap / len(original_ports) >= 0.8

            return True
        except Exception as e:
            logger.error(f"结果验证异常: {e}")
            return True  # 验证失败时默认信任

    # ============================================================
    # 消息处理
    # ============================================================

    async def _handle_scan_task_message(self, conn: P2PConnection, message: Message) -> Dict:
        """处理SCAN_TASK消息"""
        task_data = message.payload
        task_id = task_data.get("task_id", "")

        # 检查速率限制
        if not self._check_rate_limit(conn.node_id):
            return {"accepted": False, "reason": "rate_limited"}

        # 检查是否已存在
        if task_id in self.task_distributor.tasks:
            return {"accepted": True, "reason": "already_known"}

        # 检查创建者信誉（抵押）
        creator = task_data.get("creator", "")
        if self.is_isolated(creator):
            return {"accepted": False, "reason": "creator_isolated"}

        # 存储任务
        task = ScanTask(**{k: v for k, v in task_data.items()
                           if k in ScanTask.__dataclass_fields__})
        self.task_distributor.tasks[task_id] = task

        # 如果分配给自己，执行
        if task.assigned_to == self.identity.node_id:
            await self.task_distributor.handle_task_assignment(task_data)

        return {"accepted": True}

    async def _handle_scan_result_message(self, conn: P2PConnection, message: Message):
        """处理SCAN_RESULT消息"""
        # 检查速率限制
        if not self._check_rate_limit(conn.node_id):
            return

        await self.result_gossip.handle_result(message.payload)

    async def _handle_task_complete_message(self, conn: P2PConnection, message: Message):
        """处理TASK_COMPLETE消息"""
        task_data = message.payload
        task_id = task_data.get("task_id", "")
        task = self.task_distributor.get_task(task_id)
        if task:
            task.status = task_data.get("status", "completed")
            task.completed_at = task_data.get("completed_at", time.time())
            task.result_count = task_data.get("result_count", 0)

    async def _handle_task_assign_message(self, conn: P2PConnection, message: Message) -> Dict:
        """处理SCAN_TASK_ASSIGN消息"""
        await self.task_distributor.handle_task_assignment(message.payload)
        return {"accepted": True}

    async def _handle_asset_sync_message(self, conn: P2PConnection, message: Message) -> Dict:
        """处理ASSET_SYNC消息"""
        assets = message.payload.get("assets", [])
        # 合并资产数据
        for asset_data in assets:
            ip = asset_data.get("asset_ip", "")
            if ip:
                # 构造一个ScanResult用于合并
                result = ScanResult(
                    result_id=str(uuid.uuid4())[:8],
                    task_id="sync",
                    scanner=conn.node_id,
                    asset_ip=ip,
                    open_ports=asset_data.get("merged_ports", []),
                    fingerprints=asset_data.get("merged_fingerprints", []),
                    cves=asset_data.get("merged_cves", []),
                    risk_score=asset_data.get("merged_risk_score", 0.0),
                    reputation=self.get_reputation(conn.node_id),
                )
                await self.asset_merger.merge_result(result)

        return {"received": len(assets), "status": "ok"}

    async def _handle_asset_sync_request_message(self, conn: P2PConnection, message: Message) -> Dict:
        """处理ASSET_SYNC_REQUEST消息"""
        # 返回本地资产（增量同步）
        since = message.payload.get("since", 0)
        assets = []
        for asset in self.asset_merger.get_all_assets():
            if asset.last_updated >= since:
                assets.append(asset.to_dict())

        return {"assets": assets[:100], "status": "ok"}  # 最多100条

    async def _handle_reputation_vote_message(self, conn: P2PConnection, message: Message):
        """处理REPUTATION_VOTE消息"""
        target = message.payload.get("target", "")
        vote_type = message.payload.get("vote_type", "")
        if target and vote_type:
            await self.reputation_system.vote(target, conn.node_id, vote_type)

    async def _handle_reputation_query_message(self, conn: P2PConnection, message: Message) -> Dict:
        """处理REPUTATION_QUERY消息"""
        target = message.payload.get("target", "")
        record = self.reputation_system.get_record(target)
        return {"reputation": record.reputation, "votes": record.total_votes}

    # ============================================================
    # 速率限制
    # ============================================================

    def _check_rate_limit(self, node_id: str) -> bool:
        """检查节点速率限制"""
        if not node_id:
            return True

        now = time.time()
        timestamps = self._rate_limits[node_id]

        # 清理1秒前的记录
        self._rate_limits[node_id] = [t for t in timestamps if now - t < 1.0]

        if len(self._rate_limits[node_id]) >= RATE_LIMIT_PER_PEER:
            return False

        self._rate_limits[node_id].append(now)
        return True

    # ============================================================
    # 后台维护
    # ============================================================

    async def start(self):
        """启动自治引擎后台任务"""
        self._maintenance_task = asyncio.create_task(self.task_distributor.start_reassign_loop())
        self._sync_task = asyncio.create_task(self._data_sync_loop())

    async def stop(self):
        """停止后台任务"""
        if self._maintenance_task:
            self._maintenance_task.cancel()
        if self._sync_task:
            self._sync_task.cancel()

    async def _data_sync_loop(self):
        """数据同步循环"""
        while True:
            try:
                await asyncio.sleep(DATA_SYNC_INTERVAL)

                # 向随机邻居请求增量同步
                connections = self.protocol.conn_manager.get_all_connections()
                if connections:
                    import random
                    target = random.choice(connections)
                    if target.node_id:
                        since = time.time() - DATA_SYNC_INTERVAL
                        await self.protocol.send_message(
                            target.node_id, "ASSET_SYNC_REQUEST",
                            {"since": since}, channel=ChannelType.DATA.value
                        )

                # 清理过期的速率限制记录
                now = time.time()
                for node_id in list(self._rate_limits.keys()):
                    self._rate_limits[node_id] = [
                        t for t in self._rate_limits[node_id] if now - t < 1.0
                    ]
                    if not self._rate_limits[node_id]:
                        del self._rate_limits[node_id]

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"数据同步异常: {e}")
                await asyncio.sleep(DATA_SYNC_INTERVAL)

    # ============================================================
    # 统计
    # ============================================================

    async def get_stats(self) -> Dict:
        """获取自治引擎统计"""
        return {
            "tasks": {
                "total": len(self.task_distributor.get_all_tasks()),
                "pending": len([t for t in self.task_distributor.get_all_tasks() if t.status == "pending"]),
                "running": len([t for t in self.task_distributor.get_all_tasks() if t.status == "running"]),
                "completed": len([t for t in self.task_distributor.get_all_tasks() if t.status == "completed"]),
            },
            "reputation": self.reputation_system.get_stats(),
            "assets": self.asset_merger.get_stats(),
            "gossip": {
                "seen_results": len(self.result_gossip.seen_results),
            },
            "rate_limited_nodes": len(self._rate_limits),
        }
