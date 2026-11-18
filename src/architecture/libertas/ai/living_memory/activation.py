"""活的记忆系统职责：activation。"""

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
from .models import MemoryStatus

class ActivationEngine:
    """激活与遗忘引擎"""

    def __init__(self, decay_rate: float = 0.0001,
                 forget_threshold: float = 0.1,
                 dormant_threshold: float = 0.3,
                 boost_on_access: float = 0.15,
                 importance_weight: float = 0.4):
        self.decay_rate = decay_rate
        self.forget_threshold = forget_threshold
        self.dormant_threshold = dormant_threshold
        self.boost_on_access = boost_on_access
        self.importance_weight = importance_weight
        self.forgotten_count = 0
        self.dormant_count = 0
        self.activated_count = 0
        self._lock = threading.RLock()

    def decay_all(self, memories: Dict[str, MemoryEntry]) -> Dict[str, int]:
        """对所有记忆执行时间衰减"""
        stats = {"decayed": 0, "became_dormant": 0, "forgotten": 0}
        with self._lock:
            for mem in memories.values():
                if mem.status == MemoryStatus.PINNED.value:
                    continue
                old_activation = mem.activation
                mem.decay(self.decay_rate)
                if old_activation > self.dormant_threshold >= mem.activation:
                    mem.status = MemoryStatus.DORMANT.value
                    stats["became_dormant"] += 1
                    self.dormant_count += 1
                if mem.activation < self.forget_threshold and mem.status != MemoryStatus.ARCHIVED.value:
                    mem.status = MemoryStatus.FORGOTTEN.value
                    stats["forgotten"] += 1
                    self.forgotten_count += 1
                stats["decayed"] += 1
        return stats

    def activate(self, memory: MemoryEntry, boost: float = 0.0) -> float:
        """激活记忆"""
        with self._lock:
            actual_boost = boost or self.boost_on_access
            memory.activation = min(1.0, memory.activation + actual_boost)
            memory.last_accessed = time.time()
            memory.access_count += 1
            if memory.status == MemoryStatus.DORMANT.value:
                memory.status = MemoryStatus.ACTIVE.value
                self.activated_count += 1
            if memory.status == MemoryStatus.FORGOTTEN.value:
                memory.status = MemoryStatus.ACTIVE.value
            return memory.activation

    def compute_activation_score(self, memory: MemoryEntry,
                                  query_relevance: float = 0.0,
                                  recency_weight: float = 0.3,
                                  frequency_weight: float = 0.2,
                                  relevance_weight: float = 0.3) -> float:
        """计算综合激活分数"""
        # 时间新近度
        recency = 1.0 / (1.0 + (time.time() - memory.last_accessed) / 3600.0)
        # 访问频率（对数归一化）
        frequency = min(1.0, math.log1p(memory.access_count) / math.log1p(100))
        # 重要性
        importance = memory.importance
        # 综合
        score = (
            recency * recency_weight +
            frequency * frequency_weight +
            query_relevance * relevance_weight +
            importance * self.importance_weight
        )
        return min(1.0, max(0.0, score))

    def should_forget(self, memory: MemoryEntry) -> bool:
        """判断是否应该遗忘"""
        if memory.status == MemoryStatus.PINNED.value:
            return False
        if memory.importance > 0.8:
            return False  # 高重要性不遗忘
        return memory.activation < self.forget_threshold

    def pin(self, memory: MemoryEntry):
        """固定记忆（不被遗忘）"""
        memory.status = MemoryStatus.PINNED.value

    def unpin(self, memory: MemoryEntry):
        """取消固定"""
        memory.status = MemoryStatus.ACTIVE.value

    def get_forgotten_memories(self, memories: Dict[str, MemoryEntry]) -> List[MemoryEntry]:
        return [m for m in memories.values() if m.status == MemoryStatus.FORGOTTEN.value]

    def get_dormant_memories(self, memories: Dict[str, MemoryEntry]) -> List[MemoryEntry]:
        return [m for m in memories.values() if m.status == MemoryStatus.DORMANT.value]

    def cleanup_forgotten(self, memories: Dict[str, MemoryEntry],
                           archive: bool = True) -> int:
        """清理已遗忘的记忆"""
        to_remove = []
        for mid, mem in memories.items():
            if mem.status == MemoryStatus.FORGOTTEN.value:
                if archive:
                    mem.status = MemoryStatus.ARCHIVED.value
                else:
                    to_remove.append(mid)
        for mid in to_remove:
            del memories[mid]
        return len(to_remove)

    def get_stats(self) -> Dict[str, Any]:
        return {
            "decay_rate": self.decay_rate,
            "forget_threshold": self.forget_threshold,
            "dormant_threshold": self.dormant_threshold,
            "boost_on_access": self.boost_on_access,
            "forgotten_count": self.forgotten_count,
            "dormant_count": self.dormant_count,
            "activated_count": self.activated_count,
        }
