"""活的记忆系统职责：association。"""

from __future__ import annotations

import hashlib
import json
import math
import os
import pickle
import re
import threading
import time
import uuid
from collections import Counter, defaultdict, deque
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from libertas.foundation.terminal import terminal

from .models import MemoryEntry

class AssociationNetwork:
    """记忆关联网络"""

    def __init__(self, co_occurrence_threshold: int = 2,
                 similarity_threshold: float = 0.3,
                 max_associations_per_node: int = 50):
        self.co_occurrence_threshold = co_occurrence_threshold
        self.similarity_threshold = similarity_threshold
        self.max_associations_per_node = max_associations_per_node
        self.edges: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(dict)
        self.co_occurrence: Dict[str, Counter] = defaultdict(Counter)
        self._lock = threading.RLock()

    def add_edge(self, source_id: str, target_id: str,
                 edge_type: str = "similar", strength: float = 0.5):
        """添加关联边"""
        if source_id == target_id:
            return
        with self._lock:
            if target_id not in self.edges[source_id]:
                self.edges[source_id][target_id] = {
                    "type": edge_type,
                    "strength": strength,
                    "created_at": time.time(),
                    "co_occurrence": 1,
                }
            else:
                edge = self.edges[source_id][target_id]
                edge["strength"] = min(1.0, edge["strength"] + strength * 0.1)
                edge["co_occurrence"] += 1

    def remove_edge(self, source_id: str, target_id: str) -> bool:
        with self._lock:
            if target_id in self.edges[source_id]:
                del self.edges[source_id][target_id]
                return True
        return False

    def record_co_occurrence(self, memory_ids: List[str]):
        """记录记忆共现（在同一上下文中被检索到）"""
        with self._lock:
            for i, mid1 in enumerate(memory_ids):
                for mid2 in memory_ids[i + 1:]:
                    self.co_occurrence[mid1][mid2] += 1
                    self.co_occurrence[mid2][mid1] += 1
                    # 超过阈值自动建边
                    count = self.co_occurrence[mid1][mid2]
                    if count >= self.co_occurrence_threshold:
                        strength = min(1.0, count / 10.0)
                        self.add_edge(mid1, mid2, "co_occurrence", strength)

    def get_neighbors(self, memory_id: str,
                      min_strength: float = 0.2,
                      limit: int = 20) -> List[Tuple[str, float, str]]:
        """获取邻居节点"""
        with self._lock:
            edges = self.edges.get(memory_id, {})
            neighbors = []
            for target_id, edge in edges.items():
                if edge["strength"] >= min_strength:
                    neighbors.append((target_id, edge["strength"], edge["type"]))
            neighbors.sort(key=lambda x: x[1], reverse=True)
            return neighbors[:limit]

    def expand(self, memory_ids: List[str], hops: int = 2,
               min_strength: float = 0.2,
               limit: int = 30) -> List[Tuple[str, float, int]]:
        """从种子节点扩展关联网络"""
        visited = set(memory_ids)
        result = []
        current_frontier = [(mid, 1.0, 0) for mid in memory_ids]

        for hop in range(hops):
            next_frontier = []
            for mid, base_strength, _ in current_frontier:
                neighbors = self.get_neighbors(mid, min_strength, limit)
                for neighbor_id, edge_strength, edge_type in neighbors:
                    if neighbor_id not in visited:
                        visited.add(neighbor_id)
                        propagated_strength = base_strength * edge_strength * 0.8
                        result.append((neighbor_id, propagated_strength, hop + 1))
                        next_frontier.append((neighbor_id, propagated_strength, hop + 1))
            current_frontier = next_frontier
            if not current_frontier:
                break

        result.sort(key=lambda x: x[1], reverse=True)
        return result[:limit]

    def find_clusters(self, memory_ids: Optional[List[str]] = None,
                      min_cluster_size: int = 3) -> List[List[str]]:
        """发现记忆簇（简单连通分量）"""
        if memory_ids is None:
            memory_ids = list(self.edges.keys())
        visited = set()
        clusters = []
        for start_id in memory_ids:
            if start_id in visited:
                continue
            cluster = []
            stack = [start_id]
            while stack:
                current = stack.pop()
                if current in visited:
                    continue
                visited.add(current)
                cluster.append(current)
                for neighbor_id in self.edges.get(current, {}):
                    if neighbor_id not in visited:
                        stack.append(neighbor_id)
            if len(cluster) >= min_cluster_size:
                clusters.append(cluster)
        return clusters

    def compute_similarity_edges(self, memories: Dict[str, MemoryEntry]):
        """基于内容相似度自动建立关联边"""
        mem_list = list(memories.values())
        for i, mem1 in enumerate(mem_list):
            for mem2 in mem_list[i + 1:]:
                sim = mem1.keyword_similarity(mem2)
                if sim >= self.similarity_threshold:
                    self.add_edge(mem1.memory_id, mem2.memory_id, "similar", sim)

    def get_node_degree(self, memory_id: str) -> int:
        return len(self.edges.get(memory_id, {}))

    def get_stats(self) -> Dict[str, Any]:
        total_nodes = len(self.edges)
        total_edges = sum(len(edges) for edges in self.edges.values())
        avg_degree = total_edges / max(total_nodes, 1)
        return {
            "total_nodes": total_nodes,
            "total_edges": total_edges,
            "avg_degree": round(avg_degree, 2),
            "co_occurrence_threshold": self.co_occurrence_threshold,
            "similarity_threshold": self.similarity_threshold,
            "max_associations_per_node": self.max_associations_per_node,
        }
