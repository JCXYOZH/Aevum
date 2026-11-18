"""
core/memory.py - 记忆系统（优化版）

融合两个版本的优点：
- 保留当前版本的Memory类（遗忘曲线+强度计算+6种记忆类型）
- 吸收0.1.5版本的丰富功能（哈希管理+向量索引+扫描记忆+混合检索+记忆网络+完整性验证+自动提取+系统管理）
- 短期记忆（对话上下文）、长期记忆（事实/偏好/经历）、记忆检索、遗忘曲线、记忆整合
"""
import os
import re
import json
import time
import uuid
import math
import hashlib
import shutil
import threading
from typing import Any, Dict, List, Optional, Tuple
from collections import Counter, defaultdict, deque
from datetime import datetime, timedelta
from enum import Enum
from libertas.foundation.config import get_data_dir

# 可选依赖
try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    import jieba
    HAS_JIEBA = True
except ImportError:
    HAS_JIEBA = False

# 日志记录器
import logging
logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s'))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

from .models import HAS_JIEBA, HAS_NUMPY, LibertasHashManager, Memory, MemoryType, SimpleVectorizer, _coerce_timestamp


class MemoryBasicMixin:
    """短期/长期记忆增删改查、整合与遗忘。"""

    def add_short_term(self, content: str, context: str = "",
                       importance: float = 0.5, tags: Optional[List[str]] = None) -> Memory:
        """添加短期记忆"""
        with self._lock:
            mem = Memory(content=content, memory_type="short_term",
                         importance=importance, tags=tags or [], context=context)
            # 自动提取标签
            if self.Rule.get("auto_extract_tags", True) and not mem.tags:
                mem.tags = self._automatically_extract_topic_tags(content)
            # 自动评估重要性（兼容字典和浮点数返回值）
            if self.Rule.get("auto_assess_importance", True):
                result = self._assess_narrative_importance(content, context)
                if isinstance(result, dict):
                    mem.importance = result.get("score", 0.5)
                    mem.importance_level = result.get("level", "日常片段")
                    mem.importance_features = result.get("features", [])
                else:
                    mem.importance = result if isinstance(result, float) else 0.5
            mem.compute_hash(self.LibertasHashManager)
            self._short_term.append(mem)
            if len(self._short_term) > self._max_short_term:
                self._short_term = self._short_term[-self._max_short_term:]
            self._save()
            return mem

    def add_long_term(self, content: str, memory_type: str = "long_term",
                      importance: float = 0.5, tags: Optional[List[str]] = None,
                      source: str = "", context: str = "") -> Memory:
        """添加长期记忆"""
        with self._lock:
            mem = Memory(content=content, memory_type=memory_type,
                         importance=importance, tags=tags or [],
                         source=source, context=context)
            # 自动提取标签
            if self.Rule.get("auto_extract_tags", True) and not mem.tags:
                mem.tags = self._automatically_extract_topic_tags(content)
            # 自动评估重要性（兼容字典和浮点数返回值）
            if self.Rule.get("auto_assess_importance", True):
                result = self._assess_narrative_importance(content, context)
                if isinstance(result, dict):
                    mem.importance = result.get("score", 0.5)
                    mem.importance_level = result.get("level", "日常片段")
                    mem.importance_features = result.get("features", [])
                else:
                    mem.importance = result if isinstance(result, float) else 0.5
            mem.compute_hash(self.LibertasHashManager)
            mem.consolidated = True
            self._long_term[mem.memory_id] = mem
            for tag in mem.tags:
                self._tag_index[tag].append(mem.memory_id)
            self._index_memory(mem.memory_id, mem.to_dict())
            self._save()
            return mem

    def consolidate(self):
        """巩固短期记忆到长期记忆"""
        with self._lock:
            consolidated = []
            to_remove = []
            for mem in self._short_term:
                mem.compute_strength(self._decay_rate)
                if mem.strength >= self._consolidation_threshold or mem.importance >= 0.7:
                    long_mem = Memory(content=mem.content, memory_type="long_term",
                                     importance=mem.importance, tags=mem.tags,
                                     source=mem.source, context=mem.context)
                    long_mem.memory_id = mem.memory_id
                    long_mem.created_at = mem.created_at
                    long_mem.access_count = mem.access_count
                    long_mem.content_hash = mem.content_hash
                    long_mem.consolidated = True
                    self._long_term[long_mem.memory_id] = long_mem
                    for tag in long_mem.tags:
                        if long_mem.memory_id not in self._tag_index[tag]:
                            self._tag_index[tag].append(long_mem.memory_id)
                    self._index_memory(long_mem.memory_id, long_mem.to_dict())
                    consolidated.append(long_mem.memory_id)
                    to_remove.append(mem)
            for mem in to_remove:
                self._short_term.remove(mem)
            self.SystemState["last_consolidation"] = time.time()
            self._save_system_state()
            self._save()
            return consolidated

    def decay_all(self):
        """衰减所有记忆"""
        with self._lock:
            for mem in self._short_term:
                mem.compute_strength(self._decay_rate)
            for mem in self._long_term.values():
                mem.compute_strength(self._decay_rate)
            self.SystemState["last_decay"] = time.time()
            self._save_system_state()
            self._save()

    def get_memory(self, memory_id: str) -> Optional[Memory]:
        """获取记忆"""
        mem = self._long_term.get(memory_id)
        if mem:
            mem.access()
            return mem
        for mem in self._short_term:
            if mem.memory_id == memory_id:
                mem.access()
                return mem
        return None

    def get_short_term(self, limit: int = 20) -> List[Memory]:
        """获取短期记忆"""
        return self._short_term[-limit:]

    def get_by_tag(self, tag: str) -> List[Memory]:
        """按标签获取记忆"""
        memory_ids = self._tag_index.get(tag, [])
        return [self._long_term[mid] for mid in memory_ids if mid in self._long_term]

    def list_tags(self, limit: int = 30) -> List[Tuple[str, int]]:
        """列出标签"""
        tag_counts = [(tag, len(mids)) for tag, mids in self._tag_index.items()]
        tag_counts.sort(key=lambda x: x[1], reverse=True)
        return tag_counts[:limit]

    def update_memory(self, memory_id: str, **kwargs) -> bool:
        """更新记忆"""
        mem = self._long_term.get(memory_id)
        if not mem:
            for m in self._short_term:
                if m.memory_id == memory_id:
                    mem = m
                    break
        if not mem:
            return False
        for key, value in kwargs.items():
            if hasattr(mem, key):
                setattr(mem, key, value)
        mem.updated_at = time.time()
        mem.compute_hash(self.LibertasHashManager)
        self._save()
        return True

    def delete_memory(self, memory_id: str) -> bool:
        """删除记忆"""
        with self._lock:
            if memory_id in self._long_term:
                mem = self._long_term[memory_id]
                for tag in mem.tags:
                    if memory_id in self._tag_index[tag]:
                        self._tag_index[tag].remove(memory_id)
                del self._long_term[memory_id]
                self._remove_from_index(memory_id)
                self._save()
                return True
            for i, mem in enumerate(self._short_term):
                if mem.memory_id == memory_id:
                    del self._short_term[i]
                    self._save()
                    return True
        return False

    def clear_short_term(self):
        """清除短期记忆"""
        self._short_term = []
        self._save()

    def get_episodic_memories(self, limit: int = 20) -> List[Memory]:
        """获取经历记忆"""
        return [m for m in self._long_term.values() if m.memory_type == "episodic"][:limit]

    def get_semantic_memories(self, limit: int = 20) -> List[Memory]:
        """获取事实记忆"""
        return [m for m in self._long_term.values() if m.memory_type == "semantic"][:limit]
