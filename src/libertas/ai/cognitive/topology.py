"""
融合版认知网络系统

融合0.1.5版本的记忆关联功能和现在版本的通用概念网络架构：
- 概念节点、关联边、传播激活、路径推理、聚类分析（通用概念网络）
- 记忆关系图、情感网络、语义关联查找、深度思考触发（记忆关联）
"""
import os
import re
import json
import time
import uuid
import math
import random
import threading
from typing import Any, Dict, List, Optional, Set, Tuple
from collections import defaultdict, deque
from datetime import datetime
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

# 可选依赖
try:
    import jieba
except ImportError:
    jieba = None

from .models import ConceptEdge, ConceptNode


class CognitiveTopologyMixin:
    """概念网络拓扑：节点、边、激活、路径、聚类与结构优化。"""

    def _optimize_network_structure(self):
        """修剪网络中过于孤立的节点"""
        if len(self.memory_relationship_graph) > self.max_memory_count:
            terminal.info("[CLEAN] 认知网络优化: 清理孤立节点...", "cognitive")
            degree = [(h, len(conn)) for h, conn in self.memory_relationship_graph.items()]
            degree.sort(key=lambda x: x[1])
            remove_num = len(degree) // 10
            for h, _ in degree[:remove_num]:
                self._remove_memory_node(h)
            terminal.info(f"[OK] 网络优化完成: 移除了{remove_num}个孤立节点", "cognitive")

    def _remove_memory_node(self, h: str):
        """从网络中移除指定记忆节点"""
        with self._lock:
            if h in self.memory_relationship_graph:
                for other in self.memory_relationship_graph[h]:
                    if other in self.memory_relationship_graph and h in self.memory_relationship_graph[other]:
                        del self.memory_relationship_graph[other][h]
                del self.memory_relationship_graph[h]
            for topic, hs in self.concept_network.items():
                if h in hs:
                    hs.discard(h)
            for emotion in self.emotional_network:
                if h in self.emotional_network[emotion]:
                    del self.emotional_network[emotion][h]

    def add_node(self, name: str, node_type: str = "concept",
                 description: str = "") -> ConceptNode:
        # 检查是否已存在
        for node in self._nodes.values():
            if node.name == name and node.node_type == node_type:
                return node
        node = ConceptNode(name, node_type, description)
        with self._lock:
            self._nodes[node.node_id] = node
            self._save()
        return node

    def remove_node(self, node_id: str) -> bool:
        with self._lock:
            if node_id in self._nodes:
                del self._nodes[node_id]
                self._edges = [e for e in self._edges if e.source != node_id and e.target != node_id]
                self._adjacency.pop(node_id, None)
                for adj in self._adjacency.values():
                    adj[:] = [(t, e) for t, e in adj if e.source != node_id and e.target != node_id]
                self._save()
                return True
            return False

    def get_node(self, node_id: str) -> Optional[ConceptNode]:
        return self._nodes.get(node_id)

    def get_node_by_name(self, name: str) -> Optional[ConceptNode]:
        for node in self._nodes.values():
            if node.name == name:
                return node
        return None

    def add_edge(self, source_name: str, target_name: str,
                 relation: str = "related", weight: float = 0.5) -> Optional[ConceptEdge]:
        source = self.get_node_by_name(source_name) or self.add_node(source_name)
        target = self.get_node_by_name(target_name) or self.add_node(target_name)
        # 检查是否已存在
        for edge in self._edges:
            if edge.source == source.node_id and edge.target == target.node_id and edge.relation == relation:
                edge.weight = (edge.weight + weight) / 2
                edge.updated_at = time.time()
                self._save()
                return edge
        edge = ConceptEdge(source.node_id, target.node_id, relation, weight)
        with self._lock:
            self._edges.append(edge)
            self._adjacency[source.node_id].append((target.node_id, edge))
            self._save()
        return edge

    def remove_edge(self, edge_id: str) -> bool:
        with self._lock:
            for i, edge in enumerate(self._edges):
                if edge.edge_id == edge_id:
                    self._edges.pop(i)
                    if edge.source in self._adjacency:
                        self._adjacency[edge.source] = [(t, e) for t, e in self._adjacency[edge.source] if e.edge_id != edge_id]
                    self._save()
                    return True
        return False

    def get_neighbors(self, node_id: str, relation: str = "") -> List[Tuple[ConceptNode, ConceptEdge]]:
        """获取邻居节点"""
        neighbors = []
        for target_id, edge in self._adjacency.get(node_id, []):
            if relation and edge.relation != relation:
                continue
            target_node = self._nodes.get(target_id)
            if target_node:
                neighbors.append((target_node, edge))
        return neighbors

    def spreading_activation(self, start_node_id: str,
                            initial_activation: float = 1.0,
                            decay: float = 0.5,
                            max_depth: int = 3) -> Dict[str, float]:
        """传播激活"""
        activations = {start_node_id: initial_activation}
        visited = {start_node_id}
        queue = deque([(start_node_id, initial_activation, 0)])
    
        while queue:
            node_id, act, depth = queue.popleft()
            if depth >= max_depth:
                continue
            for target_id, edge in self._adjacency.get(node_id, []):
                if target_id in visited:
                    continue
                new_act = act * edge.weight * decay
                if new_act > 0.01:
                    activations[target_id] = activations.get(target_id, 0) + new_act
                    visited.add(target_id)
                    queue.append((target_id, new_act, depth + 1))
    
        # 更新节点激活值
        for nid, act in activations.items():
            node = self._nodes.get(nid)
            if node:
                node.activate(act)
    
        return activations

    def find_path(self, start_name: str, end_name: str,
                  max_depth: int = 5) -> List[Dict[str, Any]]:
        """查找概念间路径"""
        start = self.get_node_by_name(start_name)
        end = self.get_node_by_name(end_name)
        if not start or not end:
            return []
        # BFS
        queue = deque([(start.node_id, [start.node_id])])
        visited = {start.node_id}
        while queue:
            current, path = queue.popleft()
            if len(path) > max_depth:
                continue
            if current == end.node_id:
                return [{"node_id": nid, "name": self._nodes[nid].name} for nid in path]
            for target_id, _ in self._adjacency.get(current, []):
                if target_id not in visited:
                    visited.add(target_id)
                    queue.append((target_id, path + [target_id]))
        return []

    def get_related_concepts(self, concept_name: str,
                             limit: int = 10,
                             min_weight: float = 0.3) -> List[Dict[str, Any]]:
        """获取相关概念"""
        node = self.get_node_by_name(concept_name)
        if not node:
            return []
        # 传播激活
        activations = self.spreading_activation(node.node_id, max_depth=2)
        results = []
        for nid, act in activations.items():
            if nid == node.node_id:
                continue
            related_node = self._nodes.get(nid)
            if related_node and act >= min_weight:
                results.append({
                    "name": related_node.name,
                    "type": related_node.node_type,
                    "activation": act,
                    "description": related_node.description,
                })
        results.sort(key=lambda x: x["activation"], reverse=True)
        return results[:limit]

    def cluster_nodes(self, min_size: int = 2) -> List[List[str]]:
        """简单聚类（基于连通分量）"""
        visited = set()
        clusters = []
        for node_id in self._nodes:
            if node_id in visited:
                continue
            cluster = []
            queue = deque([node_id])
            visited.add(node_id)
            while queue:
                nid = queue.popleft()
                node = self._nodes.get(nid)
                if node:
                    cluster.append(node.name)
                for target_id, _ in self._adjacency.get(nid, []):
                    if target_id not in visited:
                        visited.add(target_id)
                        queue.append(target_id)
            if len(cluster) >= min_size:
                clusters.append(cluster)
        return clusters

    def decay_all(self):
        """所有节点衰减"""
        for node in self._nodes.values():
            node.decay(self._decay_rate)

    def list_nodes(self, node_type: str = "", limit: int = 100) -> List[ConceptNode]:
        nodes = list(self._nodes.values())
        if node_type:
            nodes = [n for n in nodes if n.node_type == node_type]
        nodes.sort(key=lambda n: n.access_count, reverse=True)
        return nodes[:limit]

    def reset(self):
        """重置认知网络：清空所有节点、边、记忆关联网络"""
        with self._lock:
            self._nodes.clear()
            self._edges.clear()
            self._adjacency.clear()
            self.memory_relationship_graph.clear()
            self.concept_network.clear()
            self.emotional_network.clear()
            self._save()

    def _initialize_cognitive_network(self):
        """初始化/重建认知网络（切换用户/记忆目录时调用）
        清空旧数据后，如果memory_system存在，则从记忆系统重建记忆关联网络。
        """
        try:
            with self._lock:
                self._nodes.clear()
                self._edges.clear()
                self._adjacency.clear()
                self.memory_relationship_graph.clear()
                self.concept_network.clear()
                self.emotional_network.clear()
                self._save()
            # 如果memory_system存在，从记忆系统重建记忆关联网络
            if self.memory_system:
                self._initialize_memory_network()
        except Exception as e:
            terminal.warn(f"初始化认知网络失败: {e}", "cognitive")
