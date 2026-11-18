"""活的记忆系统职责：models。"""

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


class MemoryType(Enum):
    WORKING = "working"        # 短期工作记忆
    EPISODIC = "episodic"      # 中期情景记忆
    SEMANTIC = "semantic"      # 长期语义记忆
    EXPERIENCE = "experience"

class MemoryStatus(Enum):
    ACTIVE = "active"           # 活跃
    DORMANT = "dormant"         # 休眠（低激活度）
    ARCHIVED = "archived"       # 已归档
    FORGOTTEN = "forgotten"     # 已遗忘
    PINNED = "pinned"

class AssociationType(Enum):
    SIMILAR = "similar"          # 相似
    CAUSAL = "causal"            # 因果
    TEMPORAL = "temporal"        # 时序
    REFERENCE = "reference"      # 引用
    CONTRADICTION = "contradiction"  # 矛盾
    SUPPLEMENT = "supplement"

class MemoryEntry:
    """记忆条目"""

    def __init__(self, content: str = "", memory_type: str = "semantic",
                 importance: float = 0.5, tags: Optional[List[str]] = None,
                 source: str = "", metadata: Optional[Dict[str, Any]] = None):
        self.memory_id = f"mem_{uuid.uuid4().hex[:10]}"
        self.content = content
        self.content_hash = hashlib.md5(content.encode()).hexdigest()
        self.memory_type = memory_type
        self.importance = max(0.0, min(1.0, importance))
        self.tags = tags or []
        self.source = source
        self.metadata = metadata or {}

        # 激活相关
        self.activation = importance  # 当前激活度
        self.base_activation = importance
        self.access_count = 0
        self.created_at = time.time()
        self.last_accessed = time.time()
        self.last_decayed = time.time()

        # 状态
        self.status = MemoryStatus.ACTIVE.value

        # 向量表示（简化：用关键词权重向量代替真实embedding）
        self.embedding: List[float] = []
        self.keyword_weights: Dict[str, float] = {}

        # 关联
        self.associations: Dict[str, Dict[str, Any]] = {}  # target_id -> {type, strength, created_at}

        # 统计
        self.retrieval_count = 0
        self.hit_count = 0  # 被检索后实际使用的次数

        self._init_keyword_weights()

    def _init_keyword_weights(self):
        """初始化关键词权重（简化版TF）"""
        if not self.content:
            return
        # 简单分词：按非字母数字分割
        words = re.findall(r'[\u4e00-\u9fff]|[a-zA-Z0-9]+', self.content.lower())
        if not words:
            return
        word_counts = Counter(words)
        total = len(words)
        for word, count in word_counts.items():
            if len(word) == 1 and not '\u4e00' <= word <= '\u9fff':
                continue
            self.keyword_weights[word] = count / total

    def compute_embedding(self, dimension: int = 128) -> List[float]:
        """计算简化向量表示（基于关键词哈希）"""
        if self.embedding and len(self.embedding) == dimension:
            return self.embedding
        vec = [0.0] * dimension
        for word, weight in self.keyword_weights.items():
            idx = int(hashlib.md5(word.encode()).hexdigest(), 16) % dimension
            vec[idx] += weight
        # 归一化
        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 0:
            vec = [v / norm for v in vec]
        self.embedding = vec
        return vec

    def access(self, decay_rate: float = 0.001) -> float:
        """访问记忆，更新激活度"""
        self.access_count += 1
        self.last_accessed = time.time()
        # 访问提升激活度
        boost = 0.1 * (1.0 - self.activation)
        self.activation = min(1.0, self.activation + boost)
        return self.activation

    def decay(self, decay_rate: float = 0.0001) -> float:
        """时间衰减"""
        now = time.time()
        elapsed = now - self.last_decayed
        self.last_decayed = now
        # 指数衰减
        decay_factor = math.exp(-decay_rate * elapsed)
        self.activation = self.base_activation + (self.activation - self.base_activation) * decay_factor
        self.activation = max(0.0, min(1.0, self.activation))
        return self.activation

    def add_association(self, target_id: str, assoc_type: str = "similar",
                        strength: float = 0.5):
        """添加关联"""
        if target_id == self.memory_id:
            return
        if target_id in self.associations:
            # 增强现有关联
            existing = self.associations[target_id]
            existing["strength"] = min(1.0, existing["strength"] + strength * 0.1)
            existing["co_occurrence"] = existing.get("co_occurrence", 1) + 1
        else:
            self.associations[target_id] = {
                "type": assoc_type,
                "strength": max(0.0, min(1.0, strength)),
                "created_at": time.time(),
                "co_occurrence": 1,
            }

    def remove_association(self, target_id: str) -> bool:
        if target_id in self.associations:
            del self.associations[target_id]
            return True
        return False

    def get_related_memories(self, min_strength: float = 0.3,
                              limit: int = 10) -> List[Tuple[str, float, str]]:
        """获取相关记忆"""
        related = []
        for target_id, assoc in self.associations.items():
            if assoc["strength"] >= min_strength:
                related.append((target_id, assoc["strength"], assoc["type"]))
        related.sort(key=lambda x: x[1], reverse=True)
        return related[:limit]

    def keyword_similarity(self, other: "MemoryEntry") -> float:
        """计算关键词相似度（余弦）"""
        if not self.keyword_weights or not other.keyword_weights:
            return 0.0
        common = set(self.keyword_weights.keys()) & set(other.keyword_weights.keys())
        if not common:
            return 0.0
        dot = sum(self.keyword_weights[w] * other.keyword_weights[w] for w in common)
        norm1 = math.sqrt(sum(v * v for v in self.keyword_weights.values()))
        norm2 = math.sqrt(sum(v * v for v in other.keyword_weights.values()))
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return dot / (norm1 * norm2)

    def content_similarity(self, text: str) -> float:
        """计算与文本的相似度"""
        if not text or not self.content:
            return 0.0
        # 简化：用Jaccard相似度
        words1 = set(re.findall(r'[\u4e00-\u9fff]|[a-zA-Z0-9]+', self.content.lower()))
        words2 = set(re.findall(r'[\u4e00-\u9fff]|[a-zA-Z0-9]+', text.lower()))
        if not words1 or not words2:
            return 0.0
        intersection = words1 & words2
        union = words1 | words2
        return len(intersection) / len(union)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "memory_id": self.memory_id,
            "content": self.content[:500],
            "content_hash": self.content_hash,
            "memory_type": self.memory_type,
            "importance": round(self.importance, 4),
            "activation": round(self.activation, 4),
            "base_activation": round(self.base_activation, 4),
            "access_count": self.access_count,
            "retrieval_count": self.retrieval_count,
            "hit_count": self.hit_count,
            "status": self.status,
            "tags": self.tags,
            "source": self.source,
            "created_at": self.created_at,
            "last_accessed": self.last_accessed,
            "keyword_count": len(self.keyword_weights),
            "association_count": len(self.associations),
            "metadata_keys": list(self.metadata.keys()),
        }

    def __repr__(self) -> str:
        return (f"MemoryEntry(id={self.memory_id}, type={self.memory_type}, "
                f"activation={self.activation:.3f}, content={self.content[:50]}...)")
