"""
core/knowledge.py - 自主知识重组系统

知识条目管理、自动分类、关联发现、知识图谱、增量学习、知识融合。
"""
import os
import json
import time
import uuid
import re
import math
import threading
from typing import Any, Dict, List, Optional, Tuple
from collections import Counter, defaultdict
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


# ================================================================
# 知识条目
# ================================================================
class KnowledgeEntry:
    """知识条目"""

    def __init__(self, title: str = "", content: str = "",
                 source: str = "", category: str = "general",
                 tags: Optional[List[str]] = None):
        self.entry_id = f"know_{uuid.uuid4().hex[:8]}"
        self.title = title
        self.content = content
        self.source = source
        self.category = category
        self.tags = tags or []
        self.created_at = time.time()
        self.updated_at = time.time()
        self.access_count = 0
        self.last_accessed = 0.0
        self.importance = 0.0
        self.related_entries: List[str] = []
        self.keywords: List[str] = []
        self.summary = ""
        self.confidence = 1.0
        self.version = 1
        self.reviews: List[Dict[str, Any]] = []
        self.verified = False

    def extract_keywords(self, top_n: int = 10) -> List[str]:
        """提取关键词"""
        words = re.findall(r'[\u4e00-\u9fff]{2,}|[a-zA-Z]{3,}', self.content.lower())
        stop_words = set("的了是在我有和就不人都一上也很到说要去你会着没有看好自己这那她它我们你们他们什么怎么如何哪些哪个哪里什么时候多少可以能够应该需要必须请谢谢不是吗呢吧啊嗯哦".split())
        words = [w for w in words if w not in stop_words and len(w) > 1]
        counter = Counter(words)
        self.keywords = [w for w, _ in counter.most_common(top_n)]
        return self.keywords

    def generate_summary(self, max_length: int = 100) -> str:
        """生成摘要"""
        sentences = re.split(r'[。！？.!?]', self.content)
        sentences = [s.strip() for s in sentences if s.strip()]
        if not sentences:
            self.summary = self.content[:max_length]
            return self.summary
        # 简单摘要：取前几句
        summary = ""
        for sent in sentences:
            if len(summary) + len(sent) > max_length:
                break
            summary += sent + "。"
        self.summary = summary or sentences[0][:max_length]
        return self.summary

    def compute_importance(self) -> float:
        """计算重要度"""
        score = 0.0
        score += min(self.access_count * 0.1, 2.0)
        score += len(self.tags) * 0.2
        score += len(self.related_entries) * 0.15
        score += 1.0 if self.verified else 0.0
        score += min(len(self.content) / 1000, 1.0)
        self.importance = min(score, 5.0)
        return self.importance

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entry_id": self.entry_id,
            "title": self.title,
            "content": self.content[:500],
            "source": self.source,
            "category": self.category,
            "tags": self.tags,
            "created_at": self.created_at,
            "access_count": self.access_count,
            "importance": self.importance,
            "keywords": self.keywords,
            "summary": self.summary,
            "verified": self.verified,
            "version": self.version,
        }


# ================================================================
# 知识重组引擎
# ================================================================
class KnowledgeEngine:
    """自主知识重组系统"""

    def __init__(self, data_dir: str = "", memory_system=None):
        # 智能识别：如果第一个参数是 MemorySystem 对象，则调整参数映射
        if not isinstance(data_dir, str) and data_dir is not None:
            memory_system = data_dir
            data_dir = ""
        self.data_dir = data_dir or os.path.join(get_data_dir(), "knowledge")
        os.makedirs(self.data_dir, exist_ok=True)
        self._entries: Dict[str, KnowledgeEntry] = {}
        self._categories: Dict[str, List[str]] = defaultdict(list)
        self._tag_index: Dict[str, List[str]] = defaultdict(list)
        self._keyword_index: Dict[str, List[str]] = defaultdict(list)
        self._lock = threading.RLock()
        self._auto_reorganize = True
        self._reorganize_interval = 3600
        self._last_reorganize = 0.0
        self._load()

    def _load(self):
        kb_file = os.path.join(self.data_dir, "knowledge_base.json")
        try:
            if os.path.exists(kb_file):
                with open(kb_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for e_data in data.get("entries", []):
                    entry = KnowledgeEntry(
                        title=e_data.get("title", ""),
                        content=e_data.get("content", ""),
                        source=e_data.get("source", ""),
                        category=e_data.get("category", "general"),
                        tags=e_data.get("tags", []),
                    )
                    entry.entry_id = e_data.get("entry_id", entry.entry_id)
                    entry.access_count = e_data.get("access_count", 0)
                    entry.importance = e_data.get("importance", 0)
                    entry.keywords = e_data.get("keywords", [])
                    entry.summary = e_data.get("summary", "")
                    entry.verified = e_data.get("verified", False)
                    entry.version = e_data.get("version", 1)
                    self._entries[entry.entry_id] = entry
                    self._categories[entry.category].append(entry.entry_id)
                    for tag in entry.tags:
                        self._tag_index[tag].append(entry.entry_id)
        except Exception as e:
            terminal.warn(f"加载知识库失败: {e}", "knowledge")

    def _save(self):
        kb_file = os.path.join(self.data_dir, "knowledge_base.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                "entries": [e.to_dict() for e in self._entries.values()],
                "categories": dict(self._categories),
                "tag_count": len(self._tag_index),
            }
            with open(kb_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def add_entry(self, title: str, content: str, source: str = "",
                  category: str = "general", tags: Optional[List[str]] = None) -> KnowledgeEntry:
        entry = KnowledgeEntry(title, content, source, category, tags)
        entry.extract_keywords()
        entry.generate_summary()
        entry.compute_importance()

        with self._lock:
            self._entries[entry.entry_id] = entry
            self._categories[category].append(entry.entry_id)
            for tag in entry.tags:
                self._tag_index[tag].append(entry.entry_id)
            for kw in entry.keywords:
                self._keyword_index[kw].append(entry.entry_id)
            self._save()

        terminal.info(f"添加知识: {title} ({category})", "knowledge")
        return entry

    def process_new_memory(self, new_content: str = "", emotion: str = "平静",
                           topics: Optional[List[str]] = None, **kwargs) -> Optional[str]:
        """处理新记忆，提取知识并自动重组。
        兼容 main.py 调用：process_new_memory(new_content=..., emotion=..., topics=...)
        """
        try:
            if not new_content or not new_content.strip():
                return None
            content_text = new_content.strip()
            # 从内容中提取关键词作为标题（取前30个字符）
            title = content_text[:30] + ("..." if len(content_text) > 30 else "")
            # 从主题标签中提取分类
            category = "general"
            tags = list(topics) if topics else []
            if tags:
                category = tags[0]
            # 添加到知识库
            entry = self.add_entry(
                title=title,
                content=content_text,
                source="memory",
                category=category,
                tags=tags
            )
            # 触发自动重组（如果达到间隔）
            insights = None
            now = time.time()
            if self._auto_reorganize and (now - self._last_reorganize) > self._reorganize_interval:
                try:
                    self._last_reorganize = now
                    # 简单的知识洞察：返回最新添加的知识摘要
                    if entry.summary:
                        insights = f"新知识: {entry.summary}"
                    else:
                        insights = f"新知识已添加: {title}"
                except Exception:
                    pass
            return insights
        except Exception as e:
            terminal.warn(f"process_new_memory 失败: {e}", "knowledge")
            return None

    def get_entry(self, entry_id: str) -> Optional[KnowledgeEntry]:
        entry = self._entries.get(entry_id)
        if entry:
            entry.access_count += 1
            entry.last_accessed = time.time()
            entry.compute_importance()
        return entry

    def update_entry(self, entry_id: str, **kwargs) -> bool:
        entry = self._entries.get(entry_id)
        if not entry:
            return False
        old_category = entry.category
        for k, v in kwargs.items():
            if hasattr(entry, k):
                setattr(entry, k, v)
        entry.version += 1
        entry.updated_at = time.time()
        entry.extract_keywords()
        entry.generate_summary()
        entry.compute_importance()

        # 更新索引
        if old_category != entry.category:
            if entry_id in self._categories[old_category]:
                self._categories[old_category].remove(entry_id)
            self._categories[entry.category].append(entry_id)

        self._save()
        return True

    def delete_entry(self, entry_id: str) -> bool:
        with self._lock:
            entry = self._entries.pop(entry_id, None)
            if entry:
                if entry_id in self._categories.get(entry.category, []):
                    self._categories[entry.category].remove(entry_id)
                for tag in entry.tags:
                    if entry_id in self._tag_index.get(tag, []):
                        self._tag_index[tag].remove(entry_id)
                self._save()
                return True
        return False

    def search(self, query: str, category: str = "", tag: str = "",
               limit: int = 20) -> List[Dict[str, Any]]:
        """搜索知识"""
        query_words = set(re.findall(r'[\u4e00-\u9fff]{2,}|[a-zA-Z]{3,}', query.lower()))
        results = []

        for entry in self._entries.values():
            if category and entry.category != category:
                continue
            if tag and tag not in entry.tags:
                continue

            score = 0.0
            # 标题匹配
            if query.lower() in entry.title.lower():
                score += 3.0
            # 关键词匹配
            entry_words = set(entry.keywords)
            overlap = len(query_words & entry_words)
            score += overlap * 0.5
            # 内容匹配
            content_lower = entry.content.lower()
            for word in query_words:
                if word in content_lower:
                    score += 0.3
            # 重要度加成
            score += entry.importance * 0.2

            if score > 0:
                results.append({
                    "entry_id": entry.entry_id,
                    "title": entry.title,
                    "summary": entry.summary,
                    "category": entry.category,
                    "tags": entry.tags,
                    "score": round(score, 3),
                    "access_count": entry.access_count,
                    "importance": entry.importance,
                })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]

    def get_by_category(self, category: str) -> List[KnowledgeEntry]:
        ids = self._categories.get(category, [])
        return [self._entries[aid] for aid in ids if aid in self._entries]

    def get_by_tag(self, tag: str) -> List[KnowledgeEntry]:
        ids = self._tag_index.get(tag, [])
        return [self._entries[aid] for aid in ids if aid in self._entries]

    def list_categories(self) -> Dict[str, int]:
        return {cat: len(ids) for cat, ids in self._categories.items() if ids}

    def list_tags(self, limit: int = 50) -> List[Tuple[str, int]]:
        tag_counts = [(tag, len(ids)) for tag, ids in self._tag_index.items() if ids]
        tag_counts.sort(key=lambda x: x[1], reverse=True)
        return tag_counts[:limit]

    def find_related(self, entry_id: str, limit: int = 5) -> List[Dict[str, Any]]:
        """查找相关知识"""
        entry = self._entries.get(entry_id)
        if not entry:
            return []
        results = []
        entry_keywords = set(entry.keywords)
        entry_tags = set(entry.tags)

        for other in self._entries.values():
            if other.entry_id == entry_id:
                continue
            score = 0.0
            # 关键词重叠
            overlap = len(entry_keywords & set(other.keywords))
            score += overlap * 0.5
            # 标签重叠
            tag_overlap = len(entry_tags & set(other.tags))
            score += tag_overlap * 0.8
            # 同分类
            if other.category == entry.category:
                score += 0.3
            if score > 0:
                results.append({
                    "entry_id": other.entry_id,
                    "title": other.title,
                    "category": other.category,
                    "relevance": round(score, 3),
                })

        results.sort(key=lambda x: x["relevance"], reverse=True)
        return results[:limit]

    def reorganize(self):
        """重组知识库（自动分类、关联发现）"""
        terminal.info("开始知识重组...", "knowledge")
        start = time.time()

        # 1. 重新提取关键词
        for entry in self._entries.values():
            entry.extract_keywords()
            entry.compute_importance()

        # 2. 发现关联
        for entry in self._entries.values():
            related = self.find_related(entry.entry_id, limit=3)
            entry.related_entries = [r["entry_id"] for r in related]

        # 3. 自动分类（基于关键词聚类）
        # 简化版：使用现有分类

        self._last_reorganize = time.time()
        self._save()
        duration = time.time() - start
        terminal.success(f"知识重组完成: {len(self._entries)}条知识, 耗时{duration:.1f}s", "knowledge")

    def maybe_reorganize(self):
        if self._auto_reorganize and time.time() - self._last_reorganize > self._reorganize_interval:
            self.reorganize()

    def merge_entries(self, entry_ids: List[str], new_title: str = "") -> Optional[KnowledgeEntry]:
        """合并多条知识"""
        entries = [self._entries[aid] for aid in entry_ids if aid in self._entries]
        if len(entries) < 2:
            return None

        merged_content = "\n\n".join(e.content for e in entries)
        merged_tags = list(set(t for e in entries for t in e.tags))
        merged_category = entries[0].category
        title = new_title or entries[0].title

        merged = self.add_entry(title, merged_content, "merged", merged_category, merged_tags)
        merged.verified = any(e.verified for e in entries)
        merged.version = max(e.version for e in entries) + 1

        # 删除原条目
        for aid in entry_ids:
            self.delete_entry(aid)

        return merged

    def get_stats(self) -> Dict[str, Any]:
        total = len(self._entries)
        by_category = self.list_categories()
        verified = sum(1 for e in self._entries.values() if e.verified)
        total_access = sum(e.access_count for e in self._entries.values())
        return {
            "total_entries": total,
            "by_category": by_category,
            "total_tags": len(self._tag_index),
            "verified": verified,
            "total_access": total_access,
            "avg_importance": sum(e.importance for e in self._entries.values()) / max(total, 1),
            "last_reorganize": self._last_reorganize,
        }


# 全局知识引擎
_knowledge_engine = KnowledgeEngine()


def get_knowledge_engine() -> KnowledgeEngine:
    return _knowledge_engine


def add_knowledge(title: str, content: str, **kwargs) -> KnowledgeEntry:
    return _knowledge_engine.add_entry(title, content, **kwargs)


# 向后兼容：旧版类名别名
KnowledgeReorganizationSystem = KnowledgeEngine
