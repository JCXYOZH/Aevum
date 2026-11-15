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


class CognitiveThinkingMixin:
    """深度思考与网络状态：概念簇、情感模式、网络位置与健康度。"""

    def trigger_deep_thinking(self, trigger_hash: str) -> List[str]:
        """基于指定记忆触发深度思考（认知洞察）"""
        if trigger_hash not in self.memory_relationship_graph:
            return ["[SEARCH] 这个记忆还在认知网络中寻找连接..."]
        direct = self.memory_relationship_graph[trigger_hash]
        thoughts = []
        # 找出最强的关联记忆
        if direct:
            best_hash = None
            best_level = "无关联"
            for nh, info in direct.items():
                if self._rank_association_strength(info["association_level"]) > self._rank_association_strength(best_level):
                    best_level = info["association_level"]
                    best_hash = nh
            if best_hash and self.memory_system:
                try:
                    tm = self.memory_system.read_memory(trigger_hash, silent=True)
                    nm = self.memory_system.read_memory(best_hash, silent=True)
                    if tm and nm:
                        tm_content = tm.get("content", tm.get("内容", ""))[:20]
                        nm_content = nm.get("content", nm.get("内容", ""))[:20]
                        thoughts.append(f"[IDEA] 发现{best_level}: '{tm_content}...' 与 '{nm_content}...' 形成认知共振")
                except Exception:
                    pass
        # 概念分析
        conceptual = self._analyze_concept_clusters(trigger_hash)
        if conceptual:
            thoughts.append(conceptual)
        # 情感分析
        emotional = self._analyze_emotional_patterns(trigger_hash)
        if emotional:
            thoughts.append(emotional)
        # 网络位置分析
        network = self._analyze_network_position(trigger_hash)
        if network:
            thoughts.append(network)
        return thoughts if thoughts else ["[NOTE] 这个记忆正在认知网络中沉淀，等待更多的连接..."]

    def _analyze_concept_clusters(self, h: str) -> str:
        """分析记忆所属的概念簇"""
        try:
            if self.memory_system is None:
                return ""
            mem = self.memory_system.read_memory(h, silent=True)
            if not mem:
                return ""
            topics = mem.get("tags", mem.get("主题标签", []))
            if len(topics) >= 3:
                return f"[LINK] 这个记忆连接了多个认知维度: {'、'.join(topics[:3])}"
            elif topics:
                return f"[TARGET] 记忆聚焦于: {topics[0]} 这一认知领域"
        except Exception:
            pass
        return ""

    def _analyze_emotional_patterns(self, h: str) -> str:
        """分析记忆的情感模式"""
        for emotion, mems in self.emotional_network.items():
            if h in mems:
                info = mems[h]
                emotion_color = info["emotional_color"]
                strength = info["connection_strength"]
                count = info["connected_memory_count"]
                desc_map = {
                    "强情感连接": "强烈的情感共鸣",
                    "中等情感连接": "明显的情感联系",
                    "弱情感连接": "细腻的情感连接",
                    "孤立情感": "独立的情感体验"
                }
                return f"[ASSOC] 这个记忆带有{emotion_color}的色彩，在认知网络中形成{desc_map.get(strength, '情感连接')}, {count} 个连接"
        return ""

    def _analyze_network_position(self, h: str) -> str:
        """分析记忆在网络中的位置"""
        if h not in self.memory_relationship_graph:
            return ""
        count = len(self.memory_relationship_graph[h])
        if count >= 10:
            return "[NET] 这个记忆处于认知网络的核心位置，连接众多思维路径"
        elif count >= 5:
            return "[NET] 记忆在认知网络中扮演连接节点的角色"
        elif count >= 1:
            return "[NOTE] 记忆在认知网络中有基础连接"
        else:
            return "[FLOW] 记忆正在寻找认知网络中的位置"

    def get_network_status(self) -> Dict[str, Any]:
        """获取网络状态统计数据"""
        nodes = len(self.memory_relationship_graph)
        edges = sum(len(n) for n in self.memory_relationship_graph.values()) // 2
        concepts = len(self.concept_network)
        emotion_nodes = sum(len(m) for m in self.emotional_network.values())
        density = self._calculate_network_density(nodes, edges)
        health = self._evaluate_network_health(nodes, edges)
        return {
            "cognitive_node_count": nodes,
            "cognitive_connection_count": edges,
            "network_density": density,
            "concept_dimensions": concepts,
            "emotional_nodes": emotion_nodes,
            "network_status": health,
            "network_description": self._generate_network_description(nodes, edges, health),
            # 通用概念网络统计
            "concept_node_count": len(self._nodes),
            "concept_edge_count": len(self._edges),
        }

    def _calculate_network_density(self, nodes: int, edges: int) -> str:
        if nodes <= 1:
            return "初始网络"
        max_possible = nodes * (nodes - 1) // 2
        if max_possible == 0:
            return "稀疏网络"
        ratio = edges / max_possible
        if ratio > 0.3:
            return "密集网络"
        elif ratio > 0.1:
            return "中等密度"
        else:
            return "稀疏网络"

    def _evaluate_network_health(self, nodes: int, edges: int) -> str:
        if nodes == 0:
            return "初始化中"
        avg = edges / nodes if nodes > 0 else 0
        if avg >= 5:
            return "健康活跃"
        elif avg >= 2:
            return "稳定发展"
        elif avg >= 1:
            return "基础构建"
        else:
            return "需要丰富"

    def _generate_network_description(self, nodes: int, edges: int, health: str) -> str:
        desc_map = {
            "健康活跃": "认知网络充满活力，思维连接丰富而深入",
            "稳定发展": "认知网络稳定成长，思维路径逐渐清晰",
            "基础构建": "认知网络正在建立基础连接，思维框架初现",
            "需要丰富": "认知网络需要更多的思维连接来丰富结构",
            "初始化中": "认知网络刚刚开始构建"
        }
        return f"[AI] {desc_map.get(health, '认知网络运行中')}，包含{nodes}个记忆节点和{edges}个认知连接"
