"""职责模块：gossip。"""

from __future__ import annotations

from ..transport import NodeIdentity, ConnectionManager, P2PConnection, Message, ChannelType
from typing import Optional, Dict, List, Tuple, Set, Callable, Any
import asyncio
import time
import uuid

from .constants import GOSSIP_FANOUT
from .constants import GOSSIP_MAX_HOPS
from .constants import INITIAL_REPUTATION
from .models import ScanResult
from .models import ScanTask

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
