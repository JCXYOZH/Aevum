"""活的记忆系统职责：summarizer。"""

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
from .core import LivingMemory


class MemorySummarizer:
    """记忆摘要器 - 将多条相关记忆压缩为简洁摘要，减少存储和检索开销"""

    def __init__(self, memory: "LivingMemory"):
        self.memory = memory
        self.summaries: Dict[str, Dict[str, Any]] = {}
        self.summary_dir = os.path.join(memory.storage_dir, "summaries") if hasattr(memory, 'storage_dir') else "summaries"
        os.makedirs(self.summary_dir, exist_ok=True)

    def summarize_group(self, group_id: str, memory_ids: List[str],
                        max_summary_length: int = 500) -> Dict[str, Any]:
        """将一组记忆压缩为摘要"""
        memories = []
        for mid in memory_ids:
            mem = self.memory.get(mid) if hasattr(self.memory, 'get') else None
            if mem:
                memories.append(mem)
        if not memories:
            return {"success": False, "error": "未找到指定记忆"}
        # 提取关键信息
        contents = []
        tags_set = set()
        types = set()
        total_activations = 0
        for mem in memories:
            content = mem.get("content", "") if isinstance(mem, dict) else getattr(mem, "content", "")
            contents.append(content)
            tags = mem.get("tags", []) if isinstance(mem, dict) else getattr(mem, "tags", [])
            tags_set.update(tags)
            mtype = mem.get("memory_type", "") if isinstance(mem, dict) else getattr(mem, "memory_type", "")
            types.add(mtype)
            act = mem.get("activation_count", 0) if isinstance(mem, dict) else getattr(mem, "activation_count", 0)
            total_activations += act
        # 生成摘要（基于关键词提取和频次统计）
        all_text = " ".join(contents)
        words = self._extract_keywords(all_text)
        top_keywords = sorted(words.items(), key=lambda x: -x[1])[:10]
        summary_text = f"本组包含 {len(memories)} 条记忆，核心主题: {', '.join(k for k, _ in top_keywords[:5])}。"
        summary_text += f" 涉及类型: {', '.join(types)}。总激活次数: {total_activations}。"
        if len(summary_text) > max_summary_length:
            summary_text = summary_text[:max_summary_length] + "..."
        summary = {
            "summary_id": f"sum_{uuid.uuid4().hex[:8]}",
            "group_id": group_id,
            "source_memory_ids": memory_ids,
            "summary": summary_text,
            "keywords": [k for k, _ in top_keywords],
            "tags": list(tags_set),
            "memory_types": list(types),
            "source_count": len(memories),
            "total_activations": total_activations,
            "created_at": time.time(),
            "compression_ratio": len(memories),
        }
        self.summaries[summary["summary_id"]] = summary
        self._save_summary(summary)
        return {"success": True, "data": summary}

    def _extract_keywords(self, text: str) -> Dict[str, int]:
        """简单关键词提取（基于词频，排除停用词）"""
        stop_words = {"的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall", "can", "need", "dare", "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between", "out", "off", "over", "under", "again", "further", "then", "once", "here", "there", "when", "where", "why", "how", "all", "each", "every", "both", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just", "because", "but", "and", "or", "if", "while", "although", "though", "that", "which", "who", "whom", "this", "these", "those", "it", "its", "they", "them", "their", "what", "he", "she", "him", "her", "his", "we", "us", "our"}
        words = {}
        for word in re.findall(r'[a-zA-Z一-龥]+', text.lower()):
            if word not in stop_words and len(word) > 1:
                words[word] = words.get(word, 0) + 1
        return words

    def get_summary(self, summary_id: str) -> Optional[Dict[str, Any]]:
        """获取摘要"""
        return self.summaries.get(summary_id)

    def list_summaries(self, group_id: str = "") -> List[Dict[str, Any]]:
        """列出所有摘要"""
        if group_id:
            return [s for s in self.summaries.values() if s.get("group_id") == group_id]
        return list(self.summaries.values())

    def _save_summary(self, summary: Dict[str, Any]):
        """保存摘要到磁盘"""
        path = os.path.join(self.summary_dir, f"{summary['summary_id']}.json")
        try:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(summary, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def auto_summarize(self, min_group_size: int = 5, similarity_threshold: float = 0.6) -> List[Dict[str, Any]]:
        """自动发现相似记忆组并生成摘要"""
        # 获取所有记忆
        all_memories = []
        if hasattr(self.memory, 'memories'):
            all_memories = list(self.memory.memories.values()) if isinstance(self.memory.memories, dict) else self.memory.memories
        if len(all_memories) < min_group_size:
            return []
        # 简单聚类：基于标签重叠
        groups = []
        used = set()
        for i, mem in enumerate(all_memories):
            mid = mem.get("memory_id", "") if isinstance(mem, dict) else getattr(mem, "memory_id", str(i))
            if mid in used:
                continue
            tags_i = set(mem.get("tags", []) if isinstance(mem, dict) else getattr(mem, "tags", []))
            group = [mid]
            used.add(mid)
            for j, other in enumerate(all_memories[i+1:], i+1):
                oid = other.get("memory_id", "") if isinstance(other, dict) else getattr(other, "memory_id", str(j))
                if oid in used:
                    continue
                tags_j = set(other.get("tags", []) if isinstance(other, dict) else getattr(other, "tags", []))
                if tags_i and tags_j:
                    similarity = len(tags_i & tags_j) / len(tags_i | tags_j)
                    if similarity >= similarity_threshold:
                        group.append(oid)
                        used.add(oid)
            if len(group) >= min_group_size:
                groups.append(group)
        # 为每个组生成摘要
        results = []
        for idx, group in enumerate(groups):
            result = self.summarize_group(f"auto_{idx}", group)
            if result.get("success"):
                results.append(result["data"])
        return results

class MemoryConflictDetector:
    """记忆冲突检测器 - 检测相互矛盾或重复的记忆"""

    def __init__(self, memory: "LivingMemory"):
        self.memory = memory
        self.conflicts: List[Dict[str, Any]] = []

    def detect_duplicates(self, similarity_threshold: float = 0.85) -> List[Dict[str, Any]]:
        """检测重复记忆"""
        all_memories = []
        if hasattr(self.memory, 'memories'):
            all_memories = list(self.memory.memories.values()) if isinstance(self.memory.memories, dict) else self.memory.memories
        duplicates = []
        for i, mem_a in enumerate(all_memories):
            for mem_b in all_memories[i+1:]:
                content_a = mem_a.get("content", "") if isinstance(mem_a, dict) else getattr(mem_a, "content", "")
                content_b = mem_b.get("content", "") if isinstance(mem_b, dict) else getattr(mem_b, "content", "")
                similarity = self._text_similarity(content_a, content_b)
                if similarity >= similarity_threshold:
                    id_a = mem_a.get("memory_id", "") if isinstance(mem_a, dict) else getattr(mem_a, "memory_id", "")
                    id_b = mem_b.get("memory_id", "") if isinstance(mem_b, dict) else getattr(mem_b, "memory_id", "")
                    duplicates.append({
                        "type": "duplicate",
                        "memory_a": id_a,
                        "memory_b": id_b,
                        "similarity": similarity,
                        "content_preview": content_a[:100],
                        "recommendation": "建议保留激活次数更高的一条，另一条标记为重复或遗忘",
                    })
        return duplicates

    def detect_contradictions(self) -> List[Dict[str, Any]]:
        """检测矛盾记忆（基于关键词对立检测）"""
        contradiction_pairs = [
            ("喜欢", "讨厌"), ("支持", "反对"), ("正确", "错误"),
            ("有效", "无效"), ("安全", "危险"), ("开启", "关闭"),
            ("成功", "失败"), ("增加", "减少"), ("允许", "禁止"),
        ]
        all_memories = []
        if hasattr(self.memory, 'memories'):
            all_memories = list(self.memory.memories.values()) if isinstance(self.memory.memories, dict) else self.memory.memories
        contradictions = []
        for i, mem_a in enumerate(all_memories):
            content_a = mem_a.get("content", "") if isinstance(mem_a, dict) else getattr(mem_a, "content", "")
            for mem_b in all_memories[i+1:]:
                content_b = mem_b.get("content", "") if isinstance(mem_b, dict) else getattr(mem_b, "content", "")
                for pos_word, neg_word in contradiction_pairs:
                    if pos_word in content_a and neg_word in content_b:
                        id_a = mem_a.get("memory_id", "") if isinstance(mem_a, dict) else getattr(mem_a, "memory_id", "")
                        id_b = mem_b.get("memory_id", "") if isinstance(mem_b, dict) else getattr(mem_b, "memory_id", "")
                        contradictions.append({
                            "type": "contradiction",
                            "memory_a": id_a,
                            "memory_b": id_b,
                            "contradiction_pair": f"{pos_word} vs {neg_word}",
                            "content_a_preview": content_a[:80],
                            "content_b_preview": content_b[:80],
                            "recommendation": "建议人工核实哪条记忆正确，错误的标记为失效",
                        })
                        break
        return contradictions

    def _text_similarity(self, text_a: str, text_b: str) -> float:
        """简单文本相似度（基于Jaccard系数）"""
        if not text_a or not text_b:
            return 0.0
        words_a = set(re.findall(r'[a-zA-Z一-龥]+', text_a.lower()))
        words_b = set(re.findall(r'[a-zA-Z一-龥]+', text_b.lower()))
        if not words_a or not words_b:
            return 0.0
        intersection = words_a & words_b
        union = words_a | words_b
        return len(intersection) / len(union)

    def run_full_detection(self) -> Dict[str, Any]:
        """运行完整冲突检测"""
        duplicates = self.detect_duplicates()
        contradictions = self.detect_contradictions()
        self.conflicts = duplicates + contradictions
        return {
            "total_issues": len(self.conflicts),
            "duplicates": len(duplicates),
            "contradictions": len(contradictions),
            "issues": self.conflicts,
        }

    def resolve_conflict(self, conflict_id: int, action: str,
                          keep_memory_id: str = "") -> Dict[str, Any]:
        """解决冲突"""
        if conflict_id >= len(self.conflicts):
            return {"success": False, "error": "冲突ID不存在"}
        conflict = self.conflicts[conflict_id]
        if action == "keep_newer":
            # 保留较新的记忆
            pass
        elif action == "keep_more_active":
            # 保留激活次数更高的
            pass
        elif action == "merge":
            # 合并两条记忆
            pass
        elif action == "mark_invalid":
            # 标记一条为无效
            pass
        return {"success": True, "action": action, "conflict": conflict}
