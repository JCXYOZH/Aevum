"""
Libertas - 信誉系统增强
========================
信誉衰减、历史记录、集体信誉、信誉预测。

版本：1.0.0
"""

import asyncio
import time
import hashlib
import json
import os
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple, Set
from collections import defaultdict, deque
import logging

from .paths import DEFAULT_STATE_DIR

logger = logging.getLogger(__name__)


@dataclass
class ReputationHistoryEntry:
    """信誉历史记录"""
    timestamp: float
    reputation: float
    reason: str
    change: float


@dataclass
class CollectiveReputation:
    """集体信誉（组织/网段）"""
    group_id: str
    group_type: str  # org/ip_prefix/asn
    reputation: float = 0.5
    member_count: int = 0
    total_votes: int = 0
    accurate_votes: int = 0
    created_at: float = field(default_factory=time.time)
    last_updated: float = field(default_factory=time.time)


class EnhancedReputationSystem:
    """
    增强版信誉系统
    信誉衰减、历史记录、集体信誉、信誉预测
    """

    def __init__(self, node_id: str, state_dir: str = DEFAULT_STATE_DIR):
        self.node_id = node_id
        self.state_dir = state_dir
        self.reputations: Dict[str, float] = defaultdict(lambda: 0.5)
        self.history: Dict[str, deque] = defaultdict(lambda: deque(maxlen=1000))
        self.collective: Dict[str, CollectiveReputation] = {}
        self.vote_counts: Dict[str, Dict] = defaultdict(lambda: {"total": 0, "accurate": 0, "inaccurate": 0})
        self.last_active: Dict[str, float] = {}
        self._decay_rate = 0.01  # 每天衰减1%
        self._lock = asyncio.Lock()
        os.makedirs(state_dir, exist_ok=True)
        self._load()

    async def vote(self, target_node_id: str, voter_node_id: str,
                   vote_type: str, reason: str = "") -> float:
        """
        投票

        Returns:
            投票后的信誉值
        """
        async with self._lock:
            old_rep = self.reputations[target_node_id]
            voter_rep = self.reputations.get(voter_node_id, 0.5)

            self.vote_counts[target_node_id]["total"] += 1

            if vote_type == "accurate":
                self.vote_counts[target_node_id]["accurate"] += 1
                change = 0.01 * voter_rep
                self.reputations[target_node_id] = min(1.0, old_rep + change)
            elif vote_type in ("inaccurate", "spam", "duplicate"):
                self.vote_counts[target_node_id]["inaccurate"] += 1
                change = -0.1 * voter_rep
                self.reputations[target_node_id] = max(0.0, old_rep + change)
            else:
                change = 0.0

            self.last_active[target_node_id] = time.time()

            # 记录历史
            self.history[target_node_id].append(ReputationHistoryEntry(
                timestamp=time.time(),
                reputation=self.reputations[target_node_id],
                reason=reason or vote_type,
                change=change,
            ))

            self._save()
            return self.reputations[target_node_id]

    def get_reputation(self, node_id: str) -> float:
        """获取信誉（含衰减计算）"""
        base = self.reputations.get(node_id, 0.5)
        last_active = self.last_active.get(node_id, time.time())
        days_inactive = (time.time() - last_active) / 86400

        if days_inactive > 7:  # 7天不活动开始衰减
            decay = self._decay_rate * (days_inactive - 7)
            return max(0.1, base - decay)
        return base

    def get_history(self, node_id: str, limit: int = 100) -> List[Dict]:
        """获取信誉历史"""
        history = list(self.history.get(node_id, []))
        return [
            {"timestamp": h.timestamp, "reputation": h.reputation,
             "reason": h.reason, "change": h.change}
            for h in history[-limit:]
        ]

    def get_trend(self, node_id: str, window: int = 10) -> float:
        """获取信誉趋势（最近N次变化的平均值）"""
        history = list(self.history.get(node_id, []))
        if len(history) < 2:
            return 0.0
        recent = history[-window:]
        changes = [h.change for h in recent]
        return sum(changes) / len(changes) if changes else 0.0

    def predict_reputation(self, node_id: str, days: int = 7) -> float:
        """预测未来信誉"""
        current = self.get_reputation(node_id)
        trend = self.get_trend(node_id)
        predicted = current + trend * days
        return max(0.0, min(1.0, predicted))

    def update_collective(self, group_id: str, group_type: str,
                            node_reputation: float, vote_type: str):
        """更新集体信誉"""
        if group_id not in self.collective:
            self.collective[group_id] = CollectiveReputation(
                group_id=group_id, group_type=group_type
            )

        collective = self.collective[group_id]
        collective.member_count += 1
        collective.total_votes += 1
        if vote_type == "accurate":
            collective.accurate_votes += 1
        collective.reputation = sum(
            self.reputations.get(nid, 0.5)
            for nid in self.reputations
            if self._get_node_group(nid) == group_id
        ) / max(1, collective.member_count)
        collective.last_updated = time.time()

    def _get_node_group(self, node_id: str) -> str:
        """获取节点所属组（简化版）"""
        return hashlib.md5(node_id.encode()).hexdigest()[:8]

    def get_collective_reputation(self, group_id: str) -> Optional[float]:
        if group_id in self.collective:
            return self.collective[group_id].reputation
        return None

    def get_top_nodes(self, count: int = 10) -> List[Tuple[str, float]]:
        """获取信誉最高的节点"""
        sorted_nodes = sorted(
            self.reputations.items(), key=lambda x: x[1], reverse=True
        )
        return sorted_nodes[:count]

    def get_at_risk_nodes(self, threshold: float = 0.3) -> List[Tuple[str, float]]:
        """获取低信誉节点"""
        return [(nid, rep) for nid, rep in self.reputations.items() if rep < threshold]

    def get_stats(self) -> Dict:
        total = len(self.reputations)
        avg = sum(self.reputations.values()) / total if total > 0 else 0
        high = sum(1 for r in self.reputations.values() if r >= 0.8)
        low = sum(1 for r in self.reputations.values() if r < 0.3)

        return {
            "total_nodes": total,
            "average_reputation": round(avg, 4),
            "high_reputation": high,
            "low_reputation": low,
            "collective_groups": len(self.collective),
            "total_votes": sum(v["total"] for v in self.vote_counts.values()),
            "decay_rate": self._decay_rate,
        }

    def _save(self):
        try:
            filepath = os.path.join(self.state_dir, "enhanced_reputation.json")
            data = {
                "reputations": dict(self.reputations),
                "vote_counts": dict(self.vote_counts),
                "last_active": self.last_active,
                "collective": {k: v.__dict__ for k, v in self.collective.items()},
            }
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
        except Exception:
            pass

    def _load(self):
        try:
            filepath = os.path.join(self.state_dir, "enhanced_reputation.json")
            if os.path.exists(filepath):
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.reputations.update(data.get("reputations", {}))
                self.vote_counts.update(data.get("vote_counts", {}))
                self.last_active.update(data.get("last_active", {}))
        except Exception:
            pass
