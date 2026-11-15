"""活的记忆系统职责：stores。"""

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

class WorkingMemory:
    """短期工作记忆 - 当前对话上下文"""

    def __init__(self, max_entries: int = 50, max_tokens: int = 4000):
        self.max_entries = max_entries
        self.max_tokens = max_tokens
        self.entries: deque = deque(maxlen=max_entries)
        self.current_tokens = 0
        self._lock = threading.RLock()

    def add(self, role: str, content: str, metadata: Optional[Dict] = None) -> str:
        """添加工作记忆条目"""
        entry = {
            "id": f"wm_{uuid.uuid4().hex[:8]}",
            "role": role,
            "content": content,
            "tokens": self._estimate_tokens(content),
            "timestamp": time.time(),
            "metadata": metadata or {},
        }
        with self._lock:
            self.entries.append(entry)
            self.current_tokens += entry["tokens"]
            # 超出token预算时，移除最旧的
            while self.current_tokens > self.max_tokens and len(self.entries) > 1:
                removed = self.entries.popleft()
                self.current_tokens -= removed["tokens"]
        return entry["id"]

    def get_recent(self, n: int = 10) -> List[Dict]:
        """获取最近N条"""
        with self._lock:
            return list(self.entries)[-n:]

    def get_context(self, max_tokens: int = 3000) -> List[Dict]:
        """获取上下文（按token预算）"""
        with self._lock:
            result = []
            tokens = 0
            for entry in reversed(self.entries):
                if tokens + entry["tokens"] > max_tokens:
                    break
                result.insert(0, entry)
                tokens += entry["tokens"]
            return result

    def clear(self):
        with self._lock:
            self.entries.clear()
            self.current_tokens = 0

    def size(self) -> int:
        return len(self.entries)

    def get_all(self) -> List[Dict]:
        with self._lock:
            return list(self.entries)

    def _estimate_tokens(self, text: str) -> int:
        """估算token数（中文1字≈1.5token，英文1词≈1.3token）"""
        if not text:
            return 0
        chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
        english_words = len(re.findall(r'[a-zA-Z0-9]+', text))
        return int(chinese_chars * 1.5 + english_words * 1.3 + 1)

    def to_chat_format(self) -> List[Dict[str, str]]:
        """转换为聊天格式"""
        return [{"role": e["role"], "content": e["content"]} for e in self.get_all()]

class EpisodicMemory:
    """中期情景记忆 - 最近交互记录"""

    def __init__(self, max_entries: int = 500, retention_hours: float = 72.0):
        self.max_entries = max_entries
        self.retention_hours = retention_hours
        self.episodes: deque = deque(maxlen=max_entries)
        self._lock = threading.RLock()

    def add_episode(self, role: str, content: str,
                    summary: str = "", tags: Optional[List[str]] = None,
                    metadata: Optional[Dict] = None) -> str:
        """添加情景记忆"""
        episode = {
            "id": f"ep_{uuid.uuid4().hex[:8]}",
            "role": role,
            "content": content,
            "summary": summary or content[:100],
            "tags": tags or [],
            "timestamp": time.time(),
            "metadata": metadata or {},
            "access_count": 0,
            "last_accessed": time.time(),
        }
        with self._lock:
            self.episodes.append(episode)
        return episode["id"]

    def get_recent(self, hours: float = 24.0, limit: int = 50) -> List[Dict]:
        """获取最近N小时的情景"""
        cutoff = time.time() - hours * 3600
        with self._lock:
            recent = [e for e in self.episodes if e["timestamp"] >= cutoff]
        recent.sort(key=lambda e: e["timestamp"], reverse=True)
        return recent[:limit]

    def search(self, query: str, limit: int = 20) -> List[Dict]:
        """搜索情景记忆"""
        query_lower = query.lower()
        results = []
        with self._lock:
            for episode in self.episodes:
                score = 0
                if query_lower in episode["content"].lower():
                    score += 10
                if query_lower in episode["summary"].lower():
                    score += 8
                if any(query_lower in tag.lower() for tag in episode["tags"]):
                    score += 6
                # 关键词匹配
                query_words = set(re.findall(r'[\u4e00-\u9fff]|[a-zA-Z0-9]+', query_lower))
                content_words = set(re.findall(r'[\u4e00-\u9fff]|[a-zA-Z0-9]+', episode["content"].lower()))
                overlap = len(query_words & content_words)
                score += overlap * 2
                if score > 0:
                    results.append((episode, score))
        results.sort(key=lambda x: x[1], reverse=True)
        return [r[0] for r in results[:limit]]

    def cleanup_expired(self) -> int:
        """清理过期情景"""
        cutoff = time.time() - self.retention_hours * 3600
        before = len(self.episodes)
        with self._lock:
            self.episodes = deque(
                [e for e in self.episodes if e["timestamp"] >= cutoff],
                maxlen=self.max_entries
            )
        return before - len(self.episodes)

    def size(self) -> int:
        return len(self.episodes)

    def get_all(self) -> List[Dict]:
        with self._lock:
            return list(self.episodes)

    def get_by_date(self, date_str: str) -> List[Dict]:
        """按日期获取"""
        with self._lock:
            return [e for e in self.episodes
                    if time.strftime("%Y-%m-%d", time.localtime(e["timestamp"])) == date_str]

class SemanticMemory:
    """长期语义记忆 - 知识与经验持久化"""

    def __init__(self, storage_dir: str = "data/memory/semantic"):
        self.storage_dir = storage_dir
        self.memories: Dict[str, MemoryEntry] = {}
        self.tag_index: Dict[str, List[str]] = defaultdict(list)
        self.keyword_index: Dict[str, List[str]] = defaultdict(list)
        self._lock = threading.RLock()
        os.makedirs(storage_dir, exist_ok=True)

    def add(self, content: str, importance: float = 0.5,
            tags: Optional[List[str]] = None, source: str = "",
            memory_type: str = "semantic",
            metadata: Optional[Dict] = None) -> str:
        """添加语义记忆"""
        # 去重检查
        content_hash = hashlib.md5(content.encode()).hexdigest()
        with self._lock:
            for mem in self.memories.values():
                if mem.content_hash == content_hash:
                    # 已存在，提升重要性
                    mem.importance = max(mem.importance, importance)
                    mem.activation = max(mem.activation, importance)
                    mem.access()
                    return mem.memory_id

        entry = MemoryEntry(content, memory_type, importance, tags, source, metadata)
        entry.compute_embedding()
        with self._lock:
            self.memories[entry.memory_id] = entry
            for tag in entry.tags:
                self.tag_index[tag].append(entry.memory_id)
            for keyword in entry.keyword_weights:
                self.keyword_index[keyword].append(entry.memory_id)
        return entry.memory_id

    def get(self, memory_id: str) -> Optional[MemoryEntry]:
        with self._lock:
            mem = self.memories.get(memory_id)
            if mem:
                mem.access()
            return mem

    def remove(self, memory_id: str) -> bool:
        with self._lock:
            mem = self.memories.pop(memory_id, None)
            if mem:
                for tag in mem.tags:
                    if tag in self.tag_index:
                        self.tag_index[tag] = [
                            mid for mid in self.tag_index[tag] if mid != memory_id
                        ]
                for keyword in mem.keyword_weights:
                    if keyword in self.keyword_index:
                        self.keyword_index[keyword] = [
                            mid for mid in self.keyword_index[keyword] if mid != memory_id
                        ]
                return True
        return False

    def get_by_tag(self, tag: str) -> List[MemoryEntry]:
        with self._lock:
            ids = self.tag_index.get(tag, [])
            return [self.memories[mid] for mid in ids if mid in self.memories]

    def get_by_importance(self, min_importance: float = 0.7) -> List[MemoryEntry]:
        with self._lock:
            return [m for m in self.memories.values() if m.importance >= min_importance]

    def get_all(self) -> List[MemoryEntry]:
        with self._lock:
            return list(self.memories.values())

    def size(self) -> int:
        return len(self.memories)

    def save(self, filepath: str = ""):
        """持久化保存"""
        if not filepath:
            filepath = os.path.join(self.storage_dir, "semantic_memory.pkl")
        with self._lock:
            data = {
                "memories": {mid: mem for mid, mem in self.memories.items()},
                "tag_index": dict(self.tag_index),
                "keyword_index": dict(self.keyword_index),
            }
        try:
            with open(filepath, "wb") as f:
                pickle.dump(data, f)
        except Exception as e:
            terminal.warn(f"语义记忆保存失败: {e}", "semantic_memory")

    def load(self, filepath: str = "") -> bool:
        """加载持久化数据"""
        if not filepath:
            filepath = os.path.join(self.storage_dir, "semantic_memory.pkl")
        if not os.path.exists(filepath):
            return False
        try:
            with open(filepath, "rb") as f:
                data = pickle.load(f)
            with self._lock:
                self.memories = data.get("memories", {})
                self.tag_index = defaultdict(list, data.get("tag_index", {}))
                self.keyword_index = defaultdict(list, data.get("keyword_index", {}))
            return True
        except Exception as e:
            terminal.warn(f"语义记忆加载失败: {e}", "semantic_memory")
            return False

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            total = len(self.memories)
            by_type = Counter(m.memory_type for m in self.memories.values())
            avg_importance = (
                sum(m.importance for m in self.memories.values()) / max(total, 1)
            )
            avg_activation = (
                sum(m.activation for m in self.memories.values()) / max(total, 1)
            )
            return {
                "total": total,
                "by_type": dict(by_type),
                "tags": len(self.tag_index),
                "keywords": len(self.keyword_index),
                "avg_importance": round(avg_importance, 4),
                "avg_activation": round(avg_activation, 4),
                "total_accesses": sum(m.access_count for m in self.memories.values()),
            }
