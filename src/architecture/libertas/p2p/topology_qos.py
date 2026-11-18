"""
Libertas - 拓扑优化与流量控制
==============================
拓扑优化、QoS优先级、流量整形、带宽管理。

版本：1.0.0
"""

import asyncio
import time
import hashlib
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple, Set
from collections import defaultdict, deque
import logging

logger = logging.getLogger(__name__)


@dataclass
class LinkMetrics:
    """链路指标"""
    peer_node_id: str
    latency_ms: float = 0.0
    bandwidth_kbps: float = 0.0
    packet_loss: float = 0.0
    jitter_ms: float = 0.0
    last_measured: float = field(default_factory=time.time)
    quality_score: float = 0.0  # 0-100

    def calculate_quality(self) -> float:
        """计算链路质量分数"""
        latency_score = max(0, 100 - self.latency_ms / 10)  # 1000ms=0分
        bandwidth_score = min(100, self.bandwidth_kbps / 100)  # 10Mbps=100分
        loss_score = max(0, 100 - self.packet_loss * 100)  # 100%丢包=0分
        self.quality_score = (latency_score * 0.4 + bandwidth_score * 0.3 +
                               loss_score * 0.3)
        return self.quality_score


class TopologyOptimizer:
    """
    拓扑优化器
    根据链路质量优化连接，选择最优路径
    """

    def __init__(self, node_id: str):
        self.node_id = node_id
        self.links: Dict[str, LinkMetrics] = {}
        self._preferred_peers: List[str] = []
        self._routing_table: Dict[str, str] = {}  # target -> next_hop

    def update_link_metrics(self, peer_node_id: str, latency_ms: float,
                             bandwidth_kbps: float = 0.0,
                             packet_loss: float = 0.0):
        """更新链路指标"""
        if peer_node_id not in self.links:
            self.links[peer_node_id] = LinkMetrics(peer_node_id=peer_node_id)

        link = self.links[peer_node_id]
        # 指数移动平均
        alpha = 0.3
        link.latency_ms = link.latency_ms * (1 - alpha) + latency_ms * alpha
        link.bandwidth_kbps = link.bandwidth_kbps * (1 - alpha) + bandwidth_kbps * alpha
        link.packet_loss = link.packet_loss * (1 - alpha) + packet_loss * alpha
        link.last_measured = time.time()
        link.calculate_quality()

        # 更新首选对等节点
        self._update_preferred_peers()

    def _update_preferred_peers(self):
        """更新首选对等节点列表"""
        sorted_peers = sorted(
            self.links.values(), key=lambda x: x.quality_score, reverse=True
        )
        self._preferred_peers = [l.peer_node_id for l in sorted_peers[:20]]

    def get_best_peer(self, exclude: Optional[Set[str]] = None) -> Optional[str]:
        """获取最优对等节点"""
        for peer in self._preferred_peers:
            if not exclude or peer not in exclude:
                return peer
        return None

    def get_optimal_path(self, target_node_id: str) -> List[str]:
        """
        获取到目标节点的最优路径
        简化版：直接连接或通过首选节点中继
        """
        if target_node_id in self.links:
            return [self.node_id, target_node_id]

        # 通过首选节点中继
        best_peer = self.get_best_peer()
        if best_peer:
            return [self.node_id, best_peer, target_node_id]

        return [self.node_id, target_node_id]

    def get_topology_stats(self) -> Dict:
        total_links = len(self.links)
        avg_quality = sum(l.quality_score for l in self.links.values()) / total_links if total_links > 0 else 0
        high_quality = sum(1 for l in self.links.values() if l.quality_score >= 70)

        return {
            "total_links": total_links,
            "average_quality": round(avg_quality, 2),
            "high_quality_links": high_quality,
            "preferred_peers": len(self._preferred_peers),
            "best_peer": self.get_best_peer(),
        }


class TrafficController:
    """
    流量控制器
    QoS优先级、流量整形、带宽管理
    """

    # 消息优先级
    PRIORITY_CRITICAL = 0  # 控制消息、握手
    PRIORITY_HIGH = 1      # 任务分发、结果
    PRIORITY_NORMAL = 2    # 数据同步、Gossip
    PRIORITY_LOW = 3       # 节点发现、PEX
    PRIORITY_BACKGROUND = 4  # 维护、心跳

    def __init__(self, max_bandwidth_kbps: float = 10000.0):
        self.max_bandwidth = max_bandwidth_kbps
        self._queues: Dict[int, deque] = defaultdict(deque)
        self._bandwidth_usage: Dict[str, float] = defaultdict(float)  # peer -> kbps
        self._total_sent = 0
        self._total_received = 0
        self._last_reset = time.time()
        self._priority_weights = {0: 0.4, 1: 0.3, 2: 0.2, 3: 0.08, 4: 0.02}

    def enqueue(self, message: Dict, priority: int = 2):
        """消息入队"""
        priority = max(0, min(4, priority))
        self._queues[priority].append(message)

    def dequeue(self, max_messages: int = 10) -> List[Dict]:
        """
        按优先级出队（加权公平队列）
        """
        messages = []
        for priority in range(5):
            weight = self._priority_weights.get(priority, 0.1)
            count = max(1, int(max_messages * weight))
            while count > 0 and self._queues[priority]:
                messages.append(self._queues[priority].popleft())
                count -= 1
            if len(messages) >= max_messages:
                break
        return messages

    def record_sent(self, peer_node_id: str, bytes_count: int):
        """记录发送字节数"""
        self._total_sent += bytes_count
        self._bandwidth_usage[peer_node_id] += bytes_count / 1024  # KB

    def record_received(self, bytes_count: int):
        """记录接收字节数"""
        self._total_received += bytes_count

    def get_current_usage(self) -> float:
        """获取当前带宽使用率（kbps）"""
        elapsed = time.time() - self._last_reset
        if elapsed < 1:
            return 0.0
        total_kb = sum(self._bandwidth_usage.values())
        return total_kb / elapsed  # kbps

    def is_bandwidth_available(self, peer_node_id: str,
                                 required_kbps: float = 100.0) -> bool:
        """检查带宽是否可用"""
        current = self.get_current_usage()
        peer_usage = self._bandwidth_usage.get(peer_node_id, 0)
        return (current + required_kbps <= self.max_bandwidth and
                peer_usage < self.max_bandwidth * 0.5)  # 单节点不超过50%

    def reset_counters(self):
        """重置计数器"""
        self._bandwidth_usage.clear()
        self._last_reset = time.time()

    def get_stats(self) -> Dict:
        return {
            "max_bandwidth_kbps": self.max_bandwidth,
            "current_usage_kbps": round(self.get_current_usage(), 2),
            "usage_percent": round(self.get_current_usage() / self.max_bandwidth * 100, 2),
            "total_sent_mb": round(self._total_sent / 1024 / 1024, 2),
            "total_received_mb": round(self._total_received / 1024 / 1024, 2),
            "pending_messages": sum(len(q) for q in self._queues.values()),
            "active_peers": len(self._bandwidth_usage),
        }


class TopologyQoSEngine:
    """拓扑优化与QoS引擎（整合）"""

    def __init__(self, node_id: str, max_bandwidth_kbps: float = 10000.0):
        self.node_id = node_id
        self.topology = TopologyOptimizer(node_id)
        self.traffic = TrafficController(max_bandwidth_kbps)

    def update_link(self, peer_node_id: str, latency_ms: float,
                     bandwidth_kbps: float = 0.0, packet_loss: float = 0.0):
        self.topology.update_link_metrics(peer_node_id, latency_ms,
                                            bandwidth_kbps, packet_loss)

    def enqueue_message(self, message: Dict, priority: int = 2):
        self.traffic.enqueue(message, priority)

    def dequeue_messages(self, max_count: int = 10) -> List[Dict]:
        return self.traffic.dequeue(max_count)

    def get_best_peer(self) -> Optional[str]:
        return self.topology.get_best_peer()

    def get_stats(self) -> Dict:
        return {
            "topology": self.topology.get_topology_stats(),
            "traffic": self.traffic.get_stats(),
        }
