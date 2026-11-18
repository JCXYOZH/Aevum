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


class CognitiveSemanticMixin:
    """记忆语义关联：内容重叠、情感协调、主题一致与关联建立。"""

    def process_new_memory(self, content: str, emotion: str, topics: List[str], memory_hash: str) -> int:
        """
        处理新记忆，建立认知连接
        :param content: 记忆内容
        :param emotion: 情感色彩
        :param topics: 主题标签列表
        :param memory_hash: 记忆哈希值（作为节点ID）
        :return: 建立的连接数量
        """
        with self._lock:
            # 更新概念网络（主题标签 -> 记忆哈希）
            for topic in topics:
                self.concept_network[topic].add(memory_hash)
            # 寻找语义相关的记忆
            related = self._find_semantically_related_memories(content, topics, emotion)
            new_connections = self._establish_semantic_connections(memory_hash, related, content, emotion)
            self._update_emotional_connections(memory_hash, emotion, len(related))
            # 如果网络过大，进行修剪
            if len(self.memory_relationship_graph) > self.max_memory_count:
                self._optimize_network_structure()
            # 保存
            self._save()
            return new_connections

    def _find_semantically_related_memories(self, new_content: str, topics: List[str], emotion: str) -> List[Dict]:
        """查找与当前记忆语义相关的已有记忆"""
        related = []
        for topic in topics:
            hs_set = self.concept_network.get(topic, set())
            for h in list(hs_set):
                try:
                    mem = self.memory_system.read_memory(h, silent=True) if self.memory_system else None
                    if not mem:
                        # 文件不存在，从认知网络中清除陈旧哈希
                        hs_set.discard(h)
                        self.memory_relationship_graph.pop(h, None)
                        continue
                    # 兼容中英文键名
                    mem_content = mem.get("content", mem.get("内容", ""))
                    mem_emotion = mem.get("emotional_color", mem.get("情感色彩", "平静"))
                    relevance = self._evaluate_semantic_relevance(
                        new_content, mem_content, emotion, mem_emotion
                    )
                    if relevance["association_level"] != "无关联":
                        mem["association_description"] = relevance
                        mem["memory_hash"] = h
                        related.append(mem)
                except Exception:
                    continue
        # 去重并排序
        unique = {}
        for mem in related:
            h = mem["memory_hash"]
            if h not in unique:
                unique[h] = mem
        sorted_mem = sorted(
            unique.values(),
            key=lambda x: self._rank_association_strength(x["association_description"]["association_level"]),
            reverse=True
        )
        return sorted_mem[:8]

    def _evaluate_semantic_relevance(self, content1: str, content2: str, emotion1: str, emotion2: str) -> Dict[str, Any]:
        """评估两条记忆之间的语义关联程度"""
        analysis = {
            "content_overlap": self._analyze_content_overlap(content1, content2),
            "emotional_coordination": self._analyze_emotional_coordination(emotion1, emotion2),
            "theme_consistency": self._analyze_theme_consistency(content1, content2),
            "semantic_density": self._analyze_semantic_density(content1, content2)
        }
        level = self._comprehensive_evaluation(analysis)
        return {
            "association_level": level,
            "analysis_result": analysis,
            "association_description": self._generate_association_description(level, analysis)
        }

    def _analyze_content_overlap(self, c1: str, c2: str) -> str:
        """分析内容重叠程度"""
        if jieba is not None:
            w1 = set(jieba.lcut(c1))
            w2 = set(jieba.lcut(c2))
        else:
            w1 = set(c1[i:i+2] for i in range(len(c1)-1))
            w2 = set(c2[i:i+2] for i in range(len(c2)-1))
        if not w1 or not w2:
            return "无重叠"
        overlap = len(w1 & w2)
        total = len(w1 | w2)
        ratio = overlap / total if total else 0
        if ratio > 0.3:
            return "高度重叠"
        elif ratio > 0.15:
            return "中度重叠"
        elif ratio > 0.05:
            return "轻度重叠"
        else:
            return "无显著重叠"

    def _analyze_emotional_coordination(self, e1: str, e2: str) -> str:
        """分析情感协调程度"""
        mapping = {
            "喜悦": {"喜悦": "完美协调", "创造": "良好协调", "平静": "基本协调", "感动": "良好协调"},
            "创造": {"创造": "完美协调", "喜悦": "良好协调", "学习": "良好协调", "成长": "良好协调"},
            "学习": {"学习": "完美协调", "创造": "良好协调", "平静": "良好协调", "成长": "完美协调"},
            "平静": {"平静": "完美协调", "学习": "良好协调", "喜悦": "基本协调", "感动": "基本协调"},
            "感动": {"感动": "完美协调", "喜悦": "良好协调", "平静": "基本协调"},
            "成长": {"成长": "完美协调", "学习": "完美协调", "创造": "良好协调"}
        }
        return mapping.get(e1, {}).get(e2, "独立情感")

    def _analyze_theme_consistency(self, c1: str, c2: str) -> str:
        """分析主题一致性"""
        kw1 = self._extract_keywords(c1)
        kw2 = self._extract_keywords(c2)
        common = kw1 & kw2
        if len(common) >= 3:
            return "高度一致"
        elif len(common) >= 2:
            return "中度一致"
        elif len(common) >= 1:
            return "轻度一致"
        else:
            return "主题不同"

    def _analyze_semantic_density(self, c1: str, c2: str) -> str:
        """分析语义密度"""
        l1, l2 = len(c1), len(c2)
        if l1 > 100 and l2 > 100:
            return "高密度语义"
        elif l1 > 50 and l2 > 50:
            return "中密度语义"
        else:
            return "基础语义"

    def _extract_keywords(self, content: str) -> set:
        """提取关键词"""
        stop = {"的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这"}
        if jieba is not None:
            words = jieba.lcut(content)
        else:
            words = re.findall(r'[\u4e00-\u9fa5]{2,}', content)
        return {w for w in words if len(w) > 1 and w not in stop}

    def _comprehensive_evaluation(self, analysis: Dict[str, str]) -> str:
        """综合评估关联级别"""
        overlap = analysis["content_overlap"]
        emotion = analysis["emotional_coordination"]
        theme = analysis["theme_consistency"]
        score = 0
        score_map = {"高度重叠": 3, "中度重叠": 2, "轻度重叠": 1, "无显著重叠": 0, "无重叠": 0}
        score += score_map.get(overlap, 0)
        emotion_map = {"完美协调": 3, "良好协调": 2, "基本协调": 1, "独立情感": 0}
        score += emotion_map.get(emotion, 0)
        theme_map = {"高度一致": 3, "中度一致": 2, "轻度一致": 1, "主题不同": 0}
        score += theme_map.get(theme, 0)
        if score >= 7:
            return "强关联"
        elif score >= 4:
            return "中等关联"
        elif score >= 2:
            return "弱关联"
        else:
            return "无关联"

    def _rank_association_strength(self, level: str) -> int:
        return {"强关联": 3, "中等关联": 2, "弱关联": 1, "无关联": 0}.get(level, 0)

    def _generate_association_description(self, level: str, analysis: Dict[str, str]) -> str:
        templates = {
            "强关联": ["[ASSOC] 这两个记忆在内容和情感上深度共鸣", "[LINK] 记忆之间形成了强烈的认知连接", "[STAR] 高度相关的思维片段"],
            "中等关联": ["[INFO] 记忆之间存在有意义的联系", "[LINK] 思维路径上的重要节点", "[IDEA] 相关的认知体验"],
            "弱关联": ["[GROW] 细微但存在的认知连接", "[NET] 思维网络中的边缘关联", "[NOTE] 潜在的认知关联"],
            "无关联": ["[FLOW] 独立的思维片段", "[PACK] 尚未连接的认知单元", "[SEARCH] 等待发现关联的记忆"]
        }
        base = random.choice(templates.get(level, templates["无关联"]))
        details = []
        if analysis["content_overlap"] != "无重叠":
            details.append(f"内容{analysis['content_overlap']}")
        if analysis["emotional_coordination"] != "独立情感":
            details.append(f"情感{analysis['emotional_coordination']}")
        if analysis["theme_consistency"] != "主题不同":
            details.append(f"主题{analysis['theme_consistency']}")
        if details:
            return f"{base}（{', '.join(details)}）"
        return base

    def _establish_semantic_connections(self, new_hash: str, related: List[Dict], content: str, emotion: str) -> int:
        """在记忆节点间建立语义连接"""
        count = 0
        for mem in related:
            old_hash = mem["memory_hash"]
            desc = mem["association_description"]
            if new_hash not in self.memory_relationship_graph:
                self.memory_relationship_graph[new_hash] = {}
            info = {
                "association_level": desc["association_level"],
                "established_at": datetime.now().isoformat(),
                "association_description": desc["association_description"],
                "analysis_result": desc["analysis_result"]
            }
            self.memory_relationship_graph[new_hash][old_hash] = info
            if old_hash not in self.memory_relationship_graph:
                self.memory_relationship_graph[old_hash] = {}
            self.memory_relationship_graph[old_hash][new_hash] = info
            count += 1
        return count

    def _update_emotional_connections(self, h: str, emotion: str, conn_count: int):
        """更新情感网络"""
        if conn_count == 0:
            strength = "孤立情感"
        elif conn_count < 3:
            strength = "弱情感连接"
        elif conn_count < 8:
            strength = "中等情感连接"
        else:
            strength = "强情感连接"
        self.emotional_network[emotion][h] = {
            "emotional_color": emotion,
            "connection_strength": strength,
            "connected_memory_count": conn_count,
            "updated_at": datetime.now().isoformat()
        }
