"""活的记忆系统职责：core。"""

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
from .retrieval import ContextAssembler
from .stores import EpisodicMemory
from .distiller import ExperienceDistiller
from .retrieval import HybridRetriever
from .models import MemoryEntry
from .stores import SemanticMemory
from .stores import WorkingMemory

class LivingMemory:
    """活的记忆系统 - 整合三层记忆、激活遗忘、关联网络、混合检索、上下文组装、经验沉淀"""

    def __init__(self, storage_dir: str = "data/memory",
                 max_working_tokens: int = 4000,
                 max_context_tokens: int = 8000,
                 auto_save: bool = True,
                 auto_save_interval: float = 300.0,
                 auto_load: bool = True):
        self.storage_dir = storage_dir
        self.auto_save = auto_save
        self.auto_save_interval = auto_save_interval
        self.last_save = time.time()

        # 三层记忆
        self.working = WorkingMemory(max_tokens=max_working_tokens)
        self.episodic = EpisodicMemory(max_entries=500, retention_hours=72.0)
        self.semantic = SemanticMemory(storage_dir=os.path.join(storage_dir, "semantic"))

        # 核心引擎
        self.activation = ActivationEngine()
        self.associations = AssociationNetwork()
        self.retriever = HybridRetriever()
        self.assembler = ContextAssembler(max_tokens=max_context_tokens)
        self.distiller = ExperienceDistiller()

        self._lock = threading.RLock()
        self._decay_thread: Optional[threading.Thread] = None
        self._running = False

        os.makedirs(storage_dir, exist_ok=True)
        terminal.info("活的记忆系统已初始化", "living_memory")

    def start(self):
        """启动后台维护线程"""
        if self._running:
            return
        self._running = True

        def maintenance_loop():
            while self._running:
                try:
                    # 衰减所有记忆
                    self.activation.decay_all(self.semantic.memories)
                    # 清理过期情景记忆
                    self.episodic.cleanup_expired()
                    # 自动保存
                    if self.auto_save and time.time() - self.last_save > self.auto_save_interval:
                        self.save()
                except Exception as e:
                    terminal.warn(f"记忆维护线程错误: {e}", "living_memory")
                time.sleep(60)

        self._decay_thread = threading.Thread(target=maintenance_loop, daemon=True)
        self._decay_thread.start()
        terminal.info("活的记忆系统后台维护已启动", "living_memory")

    def stop(self):
        """停止后台维护"""
        self._running = False
        if self._decay_thread:
            self._decay_thread.join(timeout=5)
        self.save()

    def add_working(self, role: str, content: str,
                    metadata: Optional[Dict] = None) -> str:
        """添加工作记忆"""
        return self.working.add(role, content, metadata)

    def add_episode(self, role: str, content: str,
                    summary: str = "", tags: Optional[List[str]] = None,
                    metadata: Optional[Dict] = None) -> str:
        """添加情景记忆"""
        return self.episodic.add_episode(role, content, summary, tags, metadata)

    def remember(self, content: str, importance: float = 0.5,
                 tags: Optional[List[str]] = None, source: str = "",
                 memory_type: str = "semantic",
                 metadata: Optional[Dict] = None) -> str:
        """添加长期记忆"""
        memory_id = self.semantic.add(content, importance, tags, source, memory_type, metadata)
        # 自动建立关联
        self._auto_associate(memory_id)
        return memory_id

    def _auto_associate(self, new_memory_id: str):
        """自动为新记忆建立关联"""
        new_mem = self.semantic.get(new_memory_id)
        if not new_mem:
            return
        # 与现有记忆计算相似度
        for mem in self.semantic.get_all():
            if mem.memory_id == new_memory_id:
                continue
            sim = new_mem.keyword_similarity(mem)
            if sim >= self.associations.similarity_threshold:
                self.associations.add_edge(new_memory_id, mem.memory_id, "similar", sim)

    def retrieve(self, query: str, top_k: int = 10,
                 memory_type: str = "") -> List[Tuple[MemoryEntry, float, Dict]]:
        """混合检索"""
        return self.retriever.retrieve(
            query, self.semantic.memories,
            self.associations, self.activation,
            top_k, memory_type
        )

    def build_context(self, query: str, system_prompt: str = "",
                      top_k: int = 10) -> Dict[str, Any]:
        """构建完整上下文"""
        # 1. 检索相关记忆
        retrieved = self.retrieve(query, top_k)
        # 2. 检索相关经验
        experiences = self.retrieve(query, top_k=5, memory_type="experience")
        exp_entries = [mem for mem, _, _ in experiences]
        # 3. 组装上下文
        return self.assembler.assemble(
            query, self.working, retrieved,
            exp_entries, system_prompt
        )

    def record_task_and_distill(self, task: str, steps: List[Dict],
                                 result: str, success: bool,
                                 tools_used: Optional[List[str]] = None,
                                 duration_ms: float = 0.0,
                                 metadata: Optional[Dict] = None) -> Optional[str]:
        """记录任务并自动沉淀经验"""
        task_id = self.distiller.record_task(
            task, steps, result, success, tools_used, duration_ms, metadata
        )
        experience = self.distiller.distill(task_id)
        if experience:
            # 将经验存入长期记忆
            memory_id = self.remember(
                content=experience["content"],
                importance=experience["importance"],
                tags=experience["tags"],
                source="experience_distiller",
                memory_type="experience",
                metadata={
                    "experience_id": experience["experience_id"],
                    "source_task_id": task_id,
                    "key_steps": experience["key_steps"],
                    "tool_patterns": experience["tool_patterns"],
                    "lessons": experience["lessons"],
                }
            )
            return memory_id
        return None

    def forget(self, memory_id: str) -> bool:
        """主动遗忘记忆"""
        return self.semantic.remove(memory_id)

    def pin(self, memory_id: str) -> bool:
        """固定记忆"""
        mem = self.semantic.get(memory_id)
        if mem:
            self.activation.pin(mem)
            return True
        return False

    def unpin(self, memory_id: str) -> bool:
        """取消固定"""
        mem = self.semantic.get(memory_id)
        if mem:
            self.activation.unpin(mem)
            return True
        return False

    def get_memory(self, memory_id: str) -> Optional[MemoryEntry]:
        return self.semantic.get(memory_id)

    def get_related(self, memory_id: str,
                    min_strength: float = 0.3,
                    limit: int = 10) -> List[Tuple[str, float, str]]:
        """获取相关记忆"""
        mem = self.semantic.get(memory_id)
        if mem:
            return mem.get_related_memories(min_strength, limit)
        return self.associations.get_neighbors(memory_id, min_strength, limit)

    def search_episodes(self, query: str, limit: int = 20) -> List[Dict]:
        """搜索情景记忆"""
        return self.episodic.search(query, limit)

    def get_working_context(self, max_tokens: int = 3000) -> List[Dict]:
        return self.working.get_context(max_tokens)

    def clear_working(self):
        self.working.clear()

    def get_stats(self) -> Dict[str, Any]:
        """获取完整统计"""
        return {
            "working_memory": {
                "entries": self.working.size(),
                "tokens": self.working.current_tokens,
                "max_tokens": self.working.max_tokens,
            },
            "episodic_memory": {
                "entries": self.episodic.size(),
                "max_entries": self.episodic.max_entries,
                "retention_hours": self.episodic.retention_hours,
            },
            "semantic_memory": self.semantic.get_stats(),
            "activation_engine": self.activation.get_stats(),
            "association_network": self.associations.get_stats(),
            "hybrid_retriever": self.retriever.get_stats(),
            "context_assembler": self.assembler.get_stats(),
            "experience_distiller": self.distiller.get_stats(),
            "running": self._running,
            "last_save": self.last_save,
            "storage_dir": self.storage_dir,
        }

    def save(self, filepath: str = ""):
        """持久化保存"""
        if not filepath:
            filepath = os.path.join(self.storage_dir, "living_memory_state.json")
        self.semantic.save()
        state = {
            "saved_at": time.time(),
            "semantic_count": self.semantic.size(),
            "episodic_count": self.episodic.size(),
            "working_count": self.working.size(),
            "association_edges": sum(len(e) for e in self.associations.edges.values()),
        }
        try:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2, ensure_ascii=False)
            self.last_save = time.time()
        except Exception as e:
            terminal.warn(f"记忆状态保存失败: {e}", "living_memory")

    def load(self, filepath: str = "") -> bool:
        """加载持久化数据"""
        self.semantic.load()
        return True
