"""活的记忆系统职责：retrieval。"""

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

from .activation import ActivationEngine
from .association import AssociationNetwork
from .models import MemoryEntry
from .models import MemoryStatus
from .stores import WorkingMemory

class HybridRetriever:
    """混合检索器：语义向量 + 关键词BM25 + 图谱遍历 + Rerank"""

    def __init__(self, semantic_weight: float = 0.5,
                 keyword_weight: float = 0.3,
                 graph_weight: float = 0.2,
                 activation_weight: float = 0.3,
                 top_k: int = 10,
                 graph_hops: int = 2):
        self.semantic_weight = semantic_weight
        self.keyword_weight = keyword_weight
        self.graph_weight = graph_weight
        self.activation_weight = activation_weight
        self.top_k = top_k
        self.graph_hops = graph_hops
        self.total_queries = 0
        self.total_results = 0
        self._lock = threading.RLock()

    def retrieve(self, query: str,
                 memories: Dict[str, MemoryEntry],
                 association_network: AssociationNetwork,
                 activation_engine: ActivationEngine,
                 top_k: int = 0,
                 memory_type: str = "") -> List[Tuple[MemoryEntry, float, Dict[str, float]]]:
        """执行混合检索"""
        top_k = top_k or self.top_k
        self.total_queries += 1

        # 1. 语义检索
        semantic_results = self._semantic_search(query, memories, memory_type)

        # 2. 关键词检索（BM25简化版）
        keyword_results = self._keyword_search(query, memories, memory_type)

        # 3. 图谱扩展
        seed_ids = list(set(
            [mid for mid, _ in semantic_results[:5]] +
            [mid for mid, _ in keyword_results[:5]]
        ))
        graph_results = self._graph_expansion(seed_ids, association_network)

        # 4. 合并与加权
        merged = self._merge_results(semantic_results, keyword_results, graph_results)

        # 5. 激活度重排序
        reranked = self._rerank(merged, memories, activation_engine, query)

        # 6. 返回top_k
        results = reranked[:top_k]
        self.total_results += len(results)

        # 记录共现
        result_ids = [mem.memory_id for mem, _, _ in results]
        association_network.record_co_occurrence(result_ids)

        return results

    def _semantic_search(self, query: str, memories: Dict[str, MemoryEntry],
                         memory_type: str = "") -> List[Tuple[str, float]]:
        """语义检索（基于向量余弦相似度）"""
        # 构建查询向量
        query_vec = self._text_to_vector(query)
        results = []
        for mid, mem in memories.items():
            if memory_type and mem.memory_type != memory_type:
                continue
            if mem.status == MemoryStatus.FORGOTTEN.value:
                continue
            mem_vec = mem.compute_embedding()
            if not mem_vec:
                continue
            sim = self._cosine_similarity(query_vec, mem_vec)
            if sim > 0:
                results.append((mid, sim))
        results.sort(key=lambda x: x[1], reverse=True)
        return results[:50]

    def _keyword_search(self, query: str, memories: Dict[str, MemoryEntry],
                        memory_type: str = "") -> List[Tuple[str, float]]:
        """关键词检索（BM25简化版）"""
        query_words = set(re.findall(r'[\u4e00-\u9fff]|[a-zA-Z0-9]+', query.lower()))
        if not query_words:
            return []
        # 计算文档频率
        doc_freq = Counter()
        total_docs = 0
        for mem in memories.values():
            if memory_type and mem.memory_type != memory_type:
                continue
            if mem.status == MemoryStatus.FORGOTTEN.value:
                continue
            total_docs += 1
            for word in query_words:
                if word in mem.keyword_weights:
                    doc_freq[word] += 1

        results = []
        for mid, mem in memories.items():
            if memory_type and mem.memory_type != memory_type:
                continue
            if mem.status == MemoryStatus.FORGOTTEN.value:
                continue
            score = 0.0
            for word in query_words:
                if word in mem.keyword_weights:
                    tf = mem.keyword_weights[word]
                    idf = math.log((total_docs + 1) / (doc_freq[word] + 1)) + 1
                    score += tf * idf
            if score > 0:
                results.append((mid, score))

        # 归一化
        if results:
            max_score = max(s for _, s in results)
            results = [(mid, s / max_score) for mid, s in results]
        results.sort(key=lambda x: x[1], reverse=True)
        return results[:50]

    def _graph_expansion(self, seed_ids: List[str],
                          association_network: AssociationNetwork) -> List[Tuple[str, float]]:
        """图谱遍历扩展"""
        expanded = association_network.expand(seed_ids, hops=self.graph_hops, limit=30)
        return [(mid, strength) for mid, strength, _ in expanded]

    def _merge_results(self, semantic: List[Tuple[str, float]],
                       keyword: List[Tuple[str, float]],
                       graph: List[Tuple[str, float]]) -> Dict[str, Dict[str, float]]:
        """合并多路检索结果"""
        merged = defaultdict(lambda: {"semantic": 0.0, "keyword": 0.0, "graph": 0.0})
        for mid, score in semantic:
            merged[mid]["semantic"] = score
        for mid, score in keyword:
            merged[mid]["keyword"] = score
        for mid, score in graph:
            merged[mid]["graph"] = score
        return dict(merged)

    def _rerank(self, merged: Dict[str, Dict[str, float]],
                memories: Dict[str, MemoryEntry],
                activation_engine: ActivationEngine,
                query: str) -> List[Tuple[MemoryEntry, float, Dict[str, float]]]:
        """基于激活度重排序"""
        scored = []
        for mid, scores in merged.items():
            mem = memories.get(mid)
            if not mem:
                continue
            # 综合分数
            combined = (
                scores["semantic"] * self.semantic_weight +
                scores["keyword"] * self.keyword_weight +
                scores["graph"] * self.graph_weight
            )
            # 激活度加成
            query_relevance = mem.content_similarity(query)
            activation_score = activation_engine.compute_activation_score(mem, query_relevance)
            final_score = combined * (1 - self.activation_weight) + activation_score * self.activation_weight
            # 访问记忆
            mem.retrieval_count += 1
            scored.append((mem, final_score, {
                "semantic": round(scores["semantic"], 4),
                "keyword": round(scores["keyword"], 4),
                "graph": round(scores["graph"], 4),
                "activation": round(activation_score, 4),
                "combined": round(combined, 4),
                "final": round(final_score, 4),
            }))
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored

    def _text_to_vector(self, text: str, dimension: int = 128) -> List[float]:
        """文本转向量（简化版）"""
        vec = [0.0] * dimension
        words = re.findall(r'[\u4e00-\u9fff]|[a-zA-Z0-9]+', text.lower())
        for word in words:
            idx = int(hashlib.md5(word.encode()).hexdigest(), 16) % dimension
            vec[idx] += 1.0
        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 0:
            vec = [v / norm for v in vec]
        return vec

    def _cosine_similarity(self, v1: List[float], v2: List[float]) -> float:
        if len(v1) != len(v2) or not v1:
            return 0.0
        dot = sum(a * b for a, b in zip(v1, v2))
        norm1 = math.sqrt(sum(a * a for a in v1))
        norm2 = math.sqrt(sum(b * b for b in v2))
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return dot / (norm1 * norm2)

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_queries": self.total_queries,
            "total_results": self.total_results,
            "avg_results_per_query": round(self.total_results / max(self.total_queries, 1), 2),
            "semantic_weight": self.semantic_weight,
            "keyword_weight": self.keyword_weight,
            "graph_weight": self.graph_weight,
            "activation_weight": self.activation_weight,
            "top_k": self.top_k,
            "graph_hops": self.graph_hops,
        }

class ContextAssembler:
    """上下文组装器 - 按token预算智能组装prompt上下文"""

    def __init__(self, max_tokens: int = 8000,
                 working_memory_ratio: float = 0.3,
                 retrieved_memory_ratio: float = 0.4,
                 experience_ratio: float = 0.2,
                 system_prompt_ratio: float = 0.1):
        self.max_tokens = max_tokens
        self.working_memory_ratio = working_memory_ratio
        self.retrieved_memory_ratio = retrieved_memory_ratio
        self.experience_ratio = experience_ratio
        self.system_prompt_ratio = system_prompt_ratio
        self.total_assemblies = 0
        self._lock = threading.RLock()

    def assemble(self, query: str,
                 working_memory: WorkingMemory,
                 retrieved_memories: List[Tuple[MemoryEntry, float, Dict]],
                 experiences: List[MemoryEntry],
                 system_prompt: str = "") -> Dict[str, Any]:
        """组装上下文"""
        self.total_assemblies += 1

        # 计算各部分token预算
        budgets = self._compute_budgets()

        # 1. 系统提示词
        system_part = self._fit_to_budget(system_prompt, budgets["system"])

        # 2. 工作记忆（最近对话）
        working_entries = working_memory.get_context(budgets["working"])
        working_part = self._format_working_memory(working_entries)

        # 3. 检索到的相关记忆
        retrieved_part = self._format_retrieved_memories(
            retrieved_memories, budgets["retrieved"]
        )

        # 4. 经验记忆
        experience_part = self._format_experiences(
            experiences, budgets["experience"]
        )

        # 5. 当前查询
        query_part = f"\n\n## 当前任务\n{query}"

        # 组装完整上下文
        full_context = self._build_full_context(
            system_part, working_part, retrieved_part,
            experience_part, query_part
        )

        result = {
            "context": full_context,
            "total_tokens": self._estimate_tokens(full_context),
            "budget": budgets,
            "parts": {
                "system_prompt": {"tokens": self._estimate_tokens(system_part), "content": system_part},
                "working_memory": {"tokens": self._estimate_tokens(working_part), "count": len(working_entries)},
                "retrieved_memories": {"tokens": self._estimate_tokens(retrieved_part), "count": len(retrieved_memories)},
                "experiences": {"tokens": self._estimate_tokens(experience_part), "count": len(experiences)},
                "query": {"tokens": self._estimate_tokens(query_part)},
            },
            "query": query,
            "timestamp": time.time(),
        }
        return result

    def _compute_budgets(self) -> Dict[str, int]:
        """计算各部分token预算"""
        return {
            "system": int(self.max_tokens * self.system_prompt_ratio),
            "working": int(self.max_tokens * self.working_memory_ratio),
            "retrieved": int(self.max_tokens * self.retrieved_memory_ratio),
            "experience": int(self.max_tokens * self.experience_ratio),
        }

    def _fit_to_budget(self, text: str, budget: int) -> str:
        """将文本裁剪到预算内"""
        if self._estimate_tokens(text) <= budget:
            return text
        # 按句子裁剪
        sentences = re.split(r'(?<=[。！？.!?])\s*', text)
        result = []
        tokens = 0
        for sentence in sentences:
            sent_tokens = self._estimate_tokens(sentence)
            if tokens + sent_tokens > budget:
                break
            result.append(sentence)
            tokens += sent_tokens
        return "".join(result)

    def _format_working_memory(self, entries: List[Dict]) -> str:
        """格式化工作记忆"""
        if not entries:
            return ""
        lines = ["\n\n## 最近对话"]
        for entry in entries:
            role_label = "用户" if entry["role"] == "user" else "助手"
            content = self._truncate(entry["content"], 500)
            lines.append(f"\n**{role_label}**: {content}")
        return "".join(lines)

    def _format_retrieved_memories(self,
                                     memories: List[Tuple[MemoryEntry, float, Dict]],
                                     budget: int) -> str:
        """格式化检索到的记忆"""
        if not memories:
            return ""
        lines = ["\n\n## 相关记忆"]
        current_tokens = 0
        for i, (mem, score, details) in enumerate(memories, 1):
            content = self._truncate(mem.content, 300)
            entry = f"\n\n### 记忆 {i} (相关度: {score:.3f})\n{content}"
            if mem.tags:
                entry += f"\n标签: {', '.join(mem.tags[:5])}"
            entry_tokens = self._estimate_tokens(entry)
            if current_tokens + entry_tokens > budget:
                break
            lines.append(entry)
            current_tokens += entry_tokens
        return "".join(lines)

    def _format_experiences(self, experiences: List[MemoryEntry],
                            budget: int) -> str:
        """格式化经验记忆"""
        if not experiences:
            return ""
        lines = ["\n\n## 相关经验"]
        current_tokens = 0
        for i, exp in enumerate(experiences, 1):
            content = self._truncate(exp.content, 400)
            entry = f"\n\n### 经验 {i}\n{content}"
            entry_tokens = self._estimate_tokens(entry)
            if current_tokens + entry_tokens > budget:
                break
            lines.append(entry)
            current_tokens += entry_tokens
        return "".join(lines)

    def _build_full_context(self, system: str, working: str,
                            retrieved: str, experience: str,
                            query: str) -> str:
        """构建完整上下文"""
        parts = []
        if system:
            parts.append(system)
        if working:
            parts.append(working)
        if retrieved:
            parts.append(retrieved)
        if experience:
            parts.append(experience)
        parts.append(query)
        return "\n".join(parts)

    def _truncate(self, text: str, max_length: int) -> str:
        if len(text) <= max_length:
            return text
        return text[:max_length] + "..."

    def _estimate_tokens(self, text: str) -> int:
        if not text:
            return 0
        chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
        english_words = len(re.findall(r'[a-zA-Z0-9]+', text))
        return int(chinese_chars * 1.5 + english_words * 1.3 + 1)

    def get_stats(self) -> Dict[str, Any]:
        return {
            "max_tokens": self.max_tokens,
            "total_assemblies": self.total_assemblies,
            "ratios": {
                "working_memory": self.working_memory_ratio,
                "retrieved_memory": self.retrieved_memory_ratio,
                "experience": self.experience_ratio,
                "system_prompt": self.system_prompt_ratio,
            },
        }
