"""攻击检测。"""

import time
from collections import defaultdict, deque
from typing import Dict, List, Optional, Set, Tuple

from .constants import RATE_LIMIT_WINDOW, SYBIL_BEHAVIOR_WINDOW, logger
from .models import SecurityEvent

class AttackDetector:
    """
    攻击检测器
    女巫攻击、日食攻击、DDoS、数据污染检测
    """

    def __init__(self, node_id: str):
        self.node_id = node_id
        self.events: List[SecurityEvent] = []
        self._rate_counters: Dict[str, deque] = defaultdict(deque)
        self._sybil_candidates: Dict[str, Dict] = {}
        self._routing_diversity: Dict[str, Set[str]] = defaultdict(set)
        self._data_sources: Dict[str, Set[str]] = defaultdict(set)
        self._data_hashes: Dict[str, Dict[str, Set[str]]] = defaultdict(
            lambda: defaultdict(set)
        )

    def check_rate_limit(self, node_id: str, max_per_window: int = 100) -> bool:
        """
        检查速率限制

        Returns:
            True表示允许，False表示超过限制
        """
        now = time.time()
        timestamps = self._rate_counters[node_id]

        # 清理过期时间戳
        while timestamps and now - timestamps[0] > RATE_LIMIT_WINDOW:
            timestamps.popleft()

        if len(timestamps) >= max_per_window:
            return False

        timestamps.append(now)
        return True

    def detect_sybil(self, node_id: str, ip_address: str,
                     behavior_similarity: float = 0.0) -> Optional[SecurityEvent]:
        """
        检测女巫攻击

        特征：
        - 同一IP段大量节点
        - 行为模式高度相似
        - 同时加入网络
        - 互相投票
        """
        now = time.time()
        ip_prefix = ".".join(ip_address.split(".")[:3]) if "." in ip_address else ip_address

        # 记录节点信息
        if node_id not in self._sybil_candidates:
            self._sybil_candidates[node_id] = {
                "ip_prefix": ip_prefix,
                "first_seen": now,
                "behavior_vector": [],
                "votes_received": set(),
            }

        # 检查同一IP段的节点数
        same_prefix = [nid for nid, info in self._sybil_candidates.items()
                       if info["ip_prefix"] == ip_prefix]

        if len(same_prefix) > 5:  # 同一/24网段超过5个节点
            event = SecurityEvent(
                event_type="sybil_attack",
                source_node_id=node_id,
                severity="high",
                description=f"同一IP段({ip_prefix})发现{len(same_prefix)}个节点，疑似女巫攻击",
                evidence={"ip_prefix": ip_prefix, "node_count": len(same_prefix),
                          "nodes": same_prefix[:10]},
                action_taken="flagged_for_review",
            )
            self.events.append(event)
            return event

        # 行为相似性检测
        if behavior_similarity > 0.9:
            event = SecurityEvent(
                event_type="sybil_attack",
                source_node_id=node_id,
                severity="medium",
                description=f"节点行为与其他节点高度相似({behavior_similarity:.2f})",
                evidence={"behavior_similarity": behavior_similarity},
                action_taken="flagged_for_review",
            )
            self.events.append(event)
            return event

        return None

    def detect_eclipse(self, target_node_id: str,
                        routing_table_nodes: List[str]) -> Optional[SecurityEvent]:
        """
        检测日食攻击

        特征：
        - 路由表中某个节点的邻居高度集中
        - 新加入节点替换了大量原有节点
        - 路由多样性降低
        """
        # 记录路由多样性
        current_set = set(routing_table_nodes)
        previous_set = self._routing_diversity[target_node_id]

        if previous_set:
            overlap = len(current_set & previous_set)
            total = len(current_set | previous_set)
            if total > 0:
                diversity = overlap / total
                if diversity < 0.3 and len(current_set) > 10:
                    event = SecurityEvent(
                        event_type="eclipse_attack",
                        source_node_id=target_node_id,
                        severity="high",
                        description=f"路由表突变，多样性仅{diversity:.2f}，疑似日食攻击",
                        evidence={"diversity": diversity, "previous_count": len(previous_set),
                                  "current_count": len(current_set)},
                        action_taken="routing_table_preserved",
                    )
                    self.events.append(event)
                    self._routing_diversity[target_node_id] = current_set
                    return event

        self._routing_diversity[target_node_id] = current_set
        return None

    def detect_data_poisoning(self, asset_ip: str, source_node_id: str,
                                data_hash: str) -> Optional[SecurityEvent]:
        """
        检测数据污染

        特征：
        - 同一资产数据来源单一且异常
        - 数据与多源共识差异大
        - 同一节点持续提交异常数据
        """
        self._data_sources[asset_ip].add(source_node_id)
        self._data_hashes[asset_ip][source_node_id].add(data_hash)

        # 单源数据本身不能判定为污染；只有多个独立来源给出不同哈希时才记录冲突。
        if len(self._data_sources[asset_ip]) < 2:
            return None

        hashes = {
            value
            for source_hashes in self._data_hashes[asset_ip].values()
            for value in source_hashes
        }
        if len(hashes) < 2:
            return None

        event = SecurityEvent(
            event_type="data_poisoning",
            source_node_id=source_node_id,
            severity="medium",
            description=f"资产 {asset_ip} 出现多个不一致的数据哈希，疑似数据污染",
            evidence={
                "asset_ip": asset_ip,
                "source_node_id": source_node_id,
                "data_hash": data_hash,
                "source_count": len(self._data_sources[asset_ip]),
                "distinct_hashes": sorted(hashes),
            },
            action_taken="flagged_for_verification",
        )
        self.events.append(event)
        return event

    def record_event(self, event: SecurityEvent):
        """记录安全事件"""
        self.events.append(event)
        if len(self.events) > 1000:
            self.events = self.events[-1000:]

    def get_events(self, event_type: Optional[str] = None,
                    severity: Optional[str] = None,
                    limit: int = 100) -> List[SecurityEvent]:
        """获取安全事件"""
        events = self.events
        if event_type:
            events = [e for e in events if e.event_type == event_type]
        if severity:
            events = [e for e in events if e.severity == severity]
        return events[-limit:]

    def get_stats(self) -> Dict:
        """获取安全统计"""
        by_type = defaultdict(int)
        by_severity = defaultdict(int)
        for event in self.events:
            by_type[event.event_type] += 1
            by_severity[event.severity] += 1

        return {
            "total_events": len(self.events),
            "by_type": dict(by_type),
            "by_severity": dict(by_severity),
            "monitored_nodes": len(self._sybil_candidates),
            "rate_limited_nodes": len(self._rate_counters),
        }
