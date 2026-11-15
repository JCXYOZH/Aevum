"""职责模块：reputation。"""

from __future__ import annotations

from ..paths import DEFAULT_STATE_DIR
from typing import Optional, Dict, List, Tuple, Set, Callable, Any
import asyncio
import json
import os
import time

from .constants import INITIAL_REPUTATION
from .constants import REPUTATION_DECREASE
from .constants import REPUTATION_INCREASE
from .constants import REPUTATION_THRESHOLD_AUTHORITY
from .constants import REPUTATION_THRESHOLD_ISOLATE
from .models import ReputationRecord
from .constants import SYBIL_IP_PREFIX_LIMIT
from .constants import logger

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
