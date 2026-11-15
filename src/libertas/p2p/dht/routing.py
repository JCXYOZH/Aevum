"""职责模块：routing。"""

from __future__ import annotations

from typing import Optional, Dict, List, Tuple, Set, Callable, Any
from collections import OrderedDict
import asyncio
import time

from .models import DHTNodeInfo
from .constants import K
from .constants import KEY_SIZE
from .functions import distance_bucket
from .functions import xor_distance

class KBucket:
    """单个K桶"""

    def __init__(self, bucket_index: int):
        self.bucket_index = bucket_index
        self.nodes: "OrderedDict[str, DHTNodeInfo]" = OrderedDict()
        self.last_updated = time.time()

    def add_node(self, node: DHTNodeInfo) -> Tuple[bool, Optional[DHTNodeInfo]]:
        """
        添加节点到K桶

        Returns:
            (是否添加成功, 需要被替换的最旧节点（如果桶满了）)
        """
        if node.node_id in self.nodes:
            # 已存在，移到末尾（最近使用）
            self.nodes.move_to_end(node.node_id)
            self.nodes[node.node_id].last_seen = time.time()
            self.last_updated = time.time()
            return True, None

        if len(self.nodes) < K:
            # 桶未满，直接添加
            self.nodes[node.node_id] = node
            self.last_updated = time.time()
            return True, None

        # 桶满了，返回最旧节点（需要检查是否存活）
        oldest_id = next(iter(self.nodes))
        oldest_node = self.nodes[oldest_id]
        return False, oldest_node

    def remove_node(self, node_id: str):
        """移除节点"""
        if node_id in self.nodes:
            del self.nodes[node_id]
            self.last_updated = time.time()

    def get_nodes(self, count: int = K) -> List[DHTNodeInfo]:
        """获取桶中节点（按最近使用排序）"""
        return list(self.nodes.values())[-count:]

    def get_closest_nodes(self, target_id: str, count: int = K) -> List[DHTNodeInfo]:
        """获取桶中距离目标最近的节点"""
        nodes = list(self.nodes.values())
        nodes.sort(key=lambda n: xor_distance(n.node_id, target_id))
        return nodes[:count]

    def is_full(self) -> bool:
        return len(self.nodes) >= K

    def __len__(self) -> int:
        return len(self.nodes)

    def __contains__(self, node_id: str) -> bool:
        return node_id in self.nodes

class RoutingTable:
    """
    Kademlia路由表
    由160个K桶组成（对应160位ID的每个bit位置）
    """

    def __init__(self, own_node_id: str):
        self.own_node_id = own_node_id
        self.buckets: List[KBucket] = [KBucket(i) for i in range(KEY_SIZE)]
        self._lock = asyncio.Lock()

    def _get_bucket_index(self, node_id: str) -> int:
        """获取节点属于哪个K桶"""
        distance = xor_distance(self.own_node_id, node_id)
        return distance_bucket(distance)

    async def add_node(self, node: DHTNodeInfo) -> Tuple[bool, Optional[DHTNodeInfo]]:
        """添加节点到路由表"""
        if node.node_id == self.own_node_id:
            return False, None

        bucket_index = self._get_bucket_index(node.node_id)
        async with self._lock:
            bucket = self.buckets[bucket_index]
            return bucket.add_node(node)

    async def remove_node(self, node_id: str):
        """从路由表移除节点"""
        bucket_index = self._get_bucket_index(node_id)
        async with self._lock:
            self.buckets[bucket_index].remove_node(node_id)

    async def get_closest_nodes(self, target_id: str, count: int = K) -> List[DHTNodeInfo]:
        """获取距离目标最近的K个节点"""
        all_nodes = []
        async with self._lock:
            for bucket in self.buckets:
                all_nodes.extend(bucket.get_nodes())

        all_nodes.sort(key=lambda n: xor_distance(n.node_id, target_id))
        return all_nodes[:count]

    async def get_all_nodes(self) -> List[DHTNodeInfo]:
        """获取所有已知节点"""
        nodes = []
        async with self._lock:
            for bucket in self.buckets:
                nodes.extend(bucket.get_nodes())
        return nodes

    async def get_node_count(self) -> int:
        """获取已知节点总数"""
        async with self._lock:
            return sum(len(b) for b in self.buckets)

    async def get_bucket_stats(self) -> List[Dict]:
        """获取K桶统计"""
        stats = []
        async with self._lock:
            for i, bucket in enumerate(self.buckets):
                if len(bucket) > 0:
                    stats.append({
                        "bucket": i,
                        "node_count": len(bucket),
                        "last_updated": bucket.last_updated,
                    })
        return stats

    async def refresh_bucket(self, bucket_index: int):
        """刷新K桶（标记需要更新）"""
        async with self._lock:
            self.buckets[bucket_index].last_updated = time.time()
