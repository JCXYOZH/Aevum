"""职责模块：engine。"""

from __future__ import annotations

from typing import Optional, Dict, List, Tuple, Set, Callable, Any
from ..transport import NodeIdentity, ConnectionManager, P2PConnection, Message, ChannelType
from ..paths import DEFAULT_STATE_DIR
from ..dht import DHTNode as DHTNodeCore, compute_key
from ..protocol import ProtocolHandler, NodeCapabilities, ProofOfWork
import asyncio
from collections import defaultdict
import time
import uuid

from .assets import AssetMerger
from .constants import DATA_SYNC_INTERVAL
from .constants import RATE_LIMIT_PER_PEER
from .reputation import ReputationSystem
from .gossip import ResultGossip
from .models import ScanResult
from .models import ScanTask
from .distribution import TaskDistributor
from .constants import logger

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
