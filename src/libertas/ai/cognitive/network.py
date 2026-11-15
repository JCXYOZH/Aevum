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
from .semantic import CognitiveSemanticMixin
from .thinking import CognitiveThinkingMixin
from .topology import CognitiveTopologyMixin


class CognitiveNetwork(CognitiveSemanticMixin, CognitiveTopologyMixin, CognitiveThinkingMixin):
    """认知网络系统：加载、保存、初始化与统计。"""

    def __init__(self, data_dir: str = "", memory_system=None, max_memory_count: int = 10000):
        # 智能识别：如果第一个参数是 MemorySystem 对象，则调整参数映射
        if not isinstance(data_dir, str) and data_dir is not None:
            memory_system = data_dir
            data_dir = ""
        self.data_dir = data_dir or os.path.join(get_data_dir(), "cognitive")
        self.memory_system = memory_system
        self.max_memory_count = max_memory_count
        os.makedirs(self.data_dir, exist_ok=True)
    
        # ===== 通用概念网络（现在版本架构）=====
        self._nodes: Dict[str, ConceptNode] = {}
        self._edges: List[ConceptEdge] = []
        self._adjacency: Dict[str, List[Tuple[str, ConceptEdge]]] = defaultdict(list)
    
        # ===== 记忆关联网络（0.1.5版本架构，英文字段名）=====
        self.memory_relationship_graph: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self.concept_network: Dict[str, Set[str]] = defaultdict(set)  # 主题标签 -> 记忆哈希集合
        self.emotional_network: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(dict)
    
        # 锁和配置
        self._lock = threading.RLock()
        self._decay_rate = 0.02
        self._spreading_depth = 3
        self._network_warned = False
    
        # 加载持久化数据
        self._load()
    
        # 如果提供了 memory_system，初始化记忆关联网络
        if self.memory_system:
            self._initialize_memory_network()
    
        terminal.info("[AI] 融合版认知网络系统初始化完成", "cognitive")

    def _load(self):
        """加载认知网络数据（概念网络 + 记忆关联网络）"""
        network_file = os.path.join(self.data_dir, "network.json")
        try:
            if os.path.exists(network_file):
                with open(network_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                # 加载通用概念网络
                for n_data in data.get("nodes", []):
                    node = ConceptNode(name=n_data.get("name", ""),
                                      node_type=n_data.get("node_type", "concept"),
                                      description=n_data.get("description", ""))
                    node.node_id = n_data.get("node_id", node.node_id)
                    node.activation = n_data.get("activation", 0)
                    node.tags = n_data.get("tags", [])
                    node.access_count = n_data.get("access_count", 0)
                    self._nodes[node.node_id] = node
                for e_data in data.get("edges", []):
                    edge = ConceptEdge(source=e_data.get("source", ""),
                                      target=e_data.get("target", ""),
                                      relation=e_data.get("relation", "related"),
                                      weight=e_data.get("weight", 0.5))
                    self._edges.append(edge)
                    self._adjacency[edge.source].append((edge.target, edge))
                # 加载记忆关联网络
                self.memory_relationship_graph = data.get("memory_relationships", {})
                self.concept_network = defaultdict(set, {k: set(v) for k, v in data.get("concepts", {}).items()})
                self.emotional_network = defaultdict(dict, data.get("emotional", {}))
        except Exception as e:
            terminal.warn(f"加载认知网络失败: {e}", "cognitive")

    def _save(self):
        """保存认知网络数据（概念网络 + 记忆关联网络）"""
        network_file = os.path.join(self.data_dir, "network.json")
        try:
            data = {
                "version": "2.0", "updated_at": time.time(),
                "nodes": [n.to_dict() for n in self._nodes.values()],
                "edges": [e.to_dict() for e in self._edges],
                "memory_relationships": self.memory_relationship_graph,
                "concepts": {k: list(v) for k, v in self.concept_network.items()},
                "emotional": dict(self.emotional_network),
            }
            with open(network_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def _initialize_memory_network(self):
        """从记忆系统重建记忆关联网络"""
        terminal.info("[LINK] 构建记忆认知网络关系...", "cognitive")
        try:
            all_tags = self.memory_system.get_all_memory_tags()
            # 限制处理数量，防止启动过慢
            if len(all_tags) > 200:
                all_tags = all_tags[-200:]
            nodes = 0
            connections = 0
            for tag in all_tags:
                memory_data = self.memory_system.read_memory(tag, silent=True)
                if memory_data:
                    # 兼容中英文键名
                    h = memory_data.get("content_hash", memory_data.get("哈希值", tag))
                    content = memory_data.get("content", memory_data.get("内容", ""))
                    emotion = memory_data.get("emotional_color", memory_data.get("情感色彩", "平静"))
                    topics = memory_data.get("tags", memory_data.get("主题标签", []))
                    if content:
                        conn = self.process_new_memory(content, emotion, topics, h)
                        connections += conn
                        nodes += 1
            terminal.info(f"[OK] 记忆认知网络构建完成: {nodes}个记忆节点, {connections}个认知连接", "cognitive")
        except Exception as e:
            terminal.warn(f"初始化记忆网络失败: {e}", "cognitive")

    def get_stats(self) -> Dict[str, Any]:
        """获取完整统计数据（通用概念网络 + 记忆关联网络）"""
        by_type = {}
        for node in self._nodes.values():
            by_type[node.node_type] = by_type.get(node.node_type, 0) + 1
        by_relation = {}
        for edge in self._edges:
            by_relation[edge.relation] = by_relation.get(edge.relation, 0) + 1
        total_degree = sum(len(self._adjacency.get(nid, [])) for nid in self._nodes)
        # 记忆关联网络统计
        memory_nodes = len(self.memory_relationship_graph)
        memory_edges = sum(len(n) for n in self.memory_relationship_graph.values()) // 2
        return {
            # 通用概念网络
            "total_nodes": len(self._nodes),
            "total_edges": len(self._edges),
            "by_type": by_type,
            "by_relation": by_relation,
            "avg_degree": total_degree / max(len(self._nodes), 1),
            "clusters": len(self.cluster_nodes()),
            "density": len(self._edges) / max(len(self._nodes) * (len(self._nodes) - 1), 1),
            # 记忆关联网络
            "memory_node_count": memory_nodes,
            "memory_connection_count": memory_edges,
            "concept_dimensions": len(self.concept_network),
            "emotional_nodes": sum(len(m) for m in self.emotional_network.values()),
        }
