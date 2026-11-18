"""能力增强职责：memory。"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
import time
import uuid
from collections import OrderedDict, defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from libertas.foundation.byte_stream import safe_decode

from .models import EnhancedMemory
from .models import MemoryImportance

class MemoryEnhancer:
    """活的记忆增强器

    - 遗忘曲线管理（艾宾浩斯）
    - 记忆重要性自动评分
    - 记忆关联网络
    - 记忆压缩与去重
    - 记忆检索增强
    """

    def __init__(self):
        self.memories: Dict[str, EnhancedMemory] = {}
        self.association_graph: Dict[str, List[str]] = defaultdict(list)

    def add_memory(self, content: str, importance: str = "medium",
                   source: str = "user", tags: List[str] = None) -> EnhancedMemory:
        """添加增强记忆"""
        # 去重检查
        content_hash = hashlib.md5(content.encode()).hexdigest()
        for mem in self.memories.values():
            if mem.content_hash == content_hash:
                mem.access_count += 1
                mem.last_accessed = time.time()
                return mem

        mem = EnhancedMemory(
            content=content,
            importance=importance,
            source=source,
            tags=tags or [],
        )
        self.memories[mem.memory_id] = mem
        return mem

    def score_importance(self, content: str, context: Dict = None) -> str:
        """自动评分记忆重要性"""
        score = 0
        context = context or {}

        # 关键词评分
        critical_keywords = ["password", "secret", "key", "token", "api_key",
                             "凭证", "密码", "密钥", "令牌", "紧急", "critical"]
        high_keywords = ["important", "preference", "config", "setting",
                         "重要", "偏好", "配置", "设置", "决定"]

        lower = content.lower()
        for kw in critical_keywords:
            if kw in lower:
                score += 3
        for kw in high_keywords:
            if kw in lower:
                score += 2

        # 长度评分（越长越可能重要）
        if len(content) > 500:
            score += 1
        if len(content) > 2000:
            score += 1

        # 上下文评分
        if context.get("is_user_preference"):
            score += 3
        if context.get("is_decision"):
            score += 2
        if context.get("is_temporary"):
            score -= 5

        if score >= 6:
            return MemoryImportance.CRITICAL.value
        elif score >= 4:
            return MemoryImportance.HIGH.value
        elif score >= 2:
            return MemoryImportance.MEDIUM.value
        elif score >= 0:
            return MemoryImportance.LOW.value
        else:
            return MemoryImportance.TRANSIENT.value

    def associate(self, mem_id1: str, mem_id2: str):
        """建立记忆关联"""
        if mem_id1 in self.memories and mem_id2 in self.memories:
            if mem_id2 not in self.memories[mem_id1].associations:
                self.memories[mem_id1].associations.append(mem_id2)
            if mem_id1 not in self.memories[mem_id2].associations:
                self.memories[mem_id2].associations.append(mem_id1)
            self.association_graph[mem_id1].append(mem_id2)
            self.association_graph[mem_id2].append(mem_id1)

    def retrieve(self, query: str, limit: int = 10,
                 min_strength: float = 0.1) -> List[EnhancedMemory]:
        """增强检索（关键词+关联+强度）"""
        query_lower = query.lower()
        scored = []

        for mem in self.memories.values():
            if mem.current_strength < min_strength:
                continue

            score = 0
            # 关键词匹配
            content_lower = mem.content.lower()
            for word in query_lower.split():
                if word in content_lower:
                    score += 2
                if word in mem.tags:
                    score += 3

            # 关联增强
            for assoc_id in mem.associations:
                assoc = self.memories.get(assoc_id)
                if assoc and any(w in assoc.content.lower() for w in query_lower.split()):
                    score += 1

            # 强度加权
            score *= mem.current_strength

            if score > 0:
                scored.append((score, mem))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [mem for _, mem in scored[:limit]]

    def decay_and_cleanup(self, threshold: float = 0.05) -> Dict:
        """执行遗忘衰减和清理"""
        current_time = time.time()
        forgotten = []
        kept = []

        for mem_id, mem in list(self.memories.items()):
            strength = mem.calculate_strength(current_time)
            if mem.should_forget(threshold) and mem.importance != "critical":
                forgotten.append(mem.to_dict())
                del self.memories[mem_id]
            else:
                kept.append(mem)

        return {
            "total_before": len(forgotten) + len(kept),
            "forgotten": len(forgotten),
            "kept": len(kept),
            "forgotten_memories": forgotten[:20],
        }

    def compress_memory(self, mem_id: str) -> Optional[EnhancedMemory]:
        """压缩记忆（保留关键信息）"""
        mem = self.memories.get(mem_id)
        if not mem or mem.compressed:
            return mem

        # 简单压缩：提取关键句子
        sentences = re.split(r'[。.!?！？]', mem.content)
        key_sentences = [s.strip() for s in sentences if len(s.strip()) > 20]
        if len(key_sentences) > 3:
            compressed = "。".join(key_sentences[:3]) + "。"
            mem.content = compressed
            mem.compressed = True

        return mem

    def get_statistics(self) -> Dict:
        """获取记忆统计"""
        by_importance = defaultdict(int)
        total_strength = 0
        for mem in self.memories.values():
            by_importance[mem.importance] += 1
            total_strength += mem.current_strength

        return {
            "total": len(self.memories),
            "by_importance": dict(by_importance),
            "avg_strength": round(total_strength / len(self.memories), 4) if self.memories else 0,
            "associations": sum(len(m.associations) for m in self.memories.values()),
            "compressed": sum(1 for m in self.memories.values() if m.compressed),
        }
