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


class MemoryType(Enum):
    SHORT_TERM = "short_term"
    LONG_TERM = "long_term"
    EPISODIC = "episodic"
    SEMANTIC = "semantic"
    PROCEDURAL = "procedural"
    EMOTIONAL = "emotional"

def _coerce_timestamp(value, default: float = 0.0) -> float:
    """把任意形态的时间戳统一成 float 秒。

    记忆河流里的 created_at 既有应用自己写出的数字时间戳，也有 ISO 字符串
    （_index_memory 两种都兼容）。to_dict() 之前直接 datetime.fromtimestamp(value)，
    遇到字符串就抛 TypeError，会让整段记忆索引重建失败。
    """
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str) and value.strip():
        text = value.strip().replace('Z', '+00:00')
        try:
            return float(text)
        except ValueError:
            pass
        try:
            return datetime.fromisoformat(text).timestamp()
        except Exception:
            return default
    return default

class Memory:
    """记忆条目"""

    def __init__(self, content: str = "", memory_type: str = "long_term",
                 importance: float = 0.5, tags: Optional[List[str]] = None,
                 source: str = "", context: str = ""):
        self.memory_id = f"mem_{uuid.uuid4().hex[:8]}"
        self.content = content
        self.memory_type = memory_type
        self.importance = importance
        self.tags = tags or []
        self.source = source
        self.context = context
        self.created_at = time.time()
        self.updated_at = time.time()
        self.last_accessed = 0.0
        self.access_count = 0
        self.strength = 1.0
        self.embedding: List[float] = []
        self.related_memories: List[str] = []
        self.emotional_valence = 0.0
        self.confidence = 1.0
        self.version = 1
        self.consolidated = False
        self.content_hash = ""

    def compute_strength(self, decay_rate: float = 0.05) -> float:
        """根据遗忘曲线计算记忆强度"""
        if self.access_count == 0:
            elapsed = time.time() - self.created_at
        else:
            elapsed = time.time() - self.last_accessed
        base_strength = math.exp(-decay_rate * elapsed / 86400)
        practice_bonus = 1.0 + 0.1 * math.log1p(self.access_count)
        importance_bonus = 0.5 + self.importance * 0.5
        self.strength = min(1.0, base_strength * practice_bonus * importance_bonus)
        return self.strength

    def access(self):
        self.access_count += 1
        self.last_accessed = time.time()
        self.compute_strength()

    def compute_hash(self, hash_manager=None) -> str:
        """计算内容哈希"""
        if hash_manager:
            self.content_hash = hash_manager.calculate_version_hash(self.content)
        else:
            self.content_hash = hashlib.sha256(self.content.encode('utf-8')).hexdigest()
        return self.content_hash

    def to_dict(self) -> Dict[str, Any]:
        return {
            "memory_id": self.memory_id,
            "content": self.content[:300],
            "full_content": self.content,
            "memory_type": self.memory_type,
            "importance": self.importance,
            "tags": self.tags,
            "source": self.source,
            "context": self.context,
            "created_at": self.created_at,
            "created_time": datetime.fromtimestamp(
                _coerce_timestamp(self.created_at, time.time())
            ).strftime("%Y-%m-%d %H:%M:%S"),
            "updated_at": self.updated_at,
            "last_accessed": self.last_accessed,
            "access_count": self.access_count,
            "strength": round(self.strength, 3),
            "emotional_valence": self.emotional_valence,
            "confidence": self.confidence,
            "version": self.version,
            "consolidated": self.consolidated,
            "related_memories": self.related_memories,
            "content_hash": self.content_hash,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Memory':
        """从字典创建Memory对象"""
        mem = cls(
            content=data.get("full_content", data.get("content", "")),
            memory_type=data.get("memory_type", "long_term"),
            importance=data.get("importance", 0.5),
            tags=data.get("tags", []),
            source=data.get("source", ""),
            context=data.get("context", "")
        )
        mem.memory_id = data.get("memory_id", mem.memory_id)
        mem.created_at = data.get("created_at", time.time())
        mem.updated_at = data.get("updated_at", time.time())
        mem.last_accessed = data.get("last_accessed", 0.0)
        mem.access_count = data.get("access_count", 0)
        mem.strength = data.get("strength", 1.0)
        mem.embedding = data.get("embedding", [])
        mem.related_memories = data.get("related_memories", [])
        mem.emotional_valence = data.get("emotional_valence", 0.0)
        mem.confidence = data.get("confidence", 1.0)
        mem.version = data.get("version", 1)
        mem.consolidated = data.get("consolidated", False)
        mem.content_hash = data.get("content_hash", "")
        return mem

class LibertasHashManager:
    """管理不同版本的哈希算法，确保向后兼容性和数据完整性"""

    def __init__(self):
        self.LibertasHashVersions = {
            "v1": {
                "算法": "md5",
                "盐值": "json_v1_salt_2025",
                "描述": "初始版本MD5",
                "弃用": True
            },
            "v2": {
                "算法": "sha256",
                "盐值": "json_v2_salt_2026",
                "描述": "改进版本SHA256",
                "弃用": False
            },
            "v3": {
                "算法": "blake2b",
                "盐值": "json_v3_salt_2026",
                "描述": "稳定版本BLAKE2B",
                "弃用": False
            }
        }
        self.CurrentVersion = "v3"

    def calculate_version_hash(self, data: str, version: str = None) -> str:
        """根据指定版本计算数据的哈希值"""
        if version is None:
            version = self.CurrentVersion
        if version not in self.LibertasHashVersions:
            raise ValueError(f"未知的哈希版本: {version}")
        hash_info = self.LibertasHashVersions[version]
        algorithm = hash_info["算法"]
        salt = hash_info["盐值"]
        if algorithm == "md5":
            hasher = hashlib.md5()
        elif algorithm == "sha256":
            hasher = hashlib.sha256()
        elif algorithm == "blake2b":
            hasher = hashlib.blake2b()
        else:
            raise ValueError(f"不支持的哈希算法: {algorithm}")
        hasher.update((salt + data).encode('utf-8'))
        return hasher.hexdigest()

    def detecting_hash_version(self, hash_value: str, data: str) -> Optional[str]:
        """检测给定哈希值对应的版本（包含已弃用版本，确保向后兼容）"""
        for version, info in self.LibertasHashVersions.items():
            expected_hash = self.calculate_version_hash(data, version)
            if expected_hash == hash_value:
                return version
        return None

    def get_current_version_information(self) -> Dict[str, Any]:
        """获取当前版本的信息"""
        version_info = self.LibertasHashVersions.get(self.CurrentVersion)
        return version_info.copy() if version_info else {}

    def get_all_versions(self) -> List[str]:
        """获取所有可用的哈希版本"""
        return list(self.LibertasHashVersions.keys())

    def migrate_hash(self, data: str, old_hash: str) -> Tuple[str, str]:
        """迁移旧哈希到当前版本，返回(新哈希, 旧版本)"""
        old_version = self.detecting_hash_version(old_hash, data)
        new_hash = self.calculate_version_hash(data)
        return new_hash, old_version or "unknown"

class SimpleVectorizer:
    """简单TF-IDF向量化器（降级方案）"""

    def __init__(self):
        self.vocabulary: Dict[str, int] = {}
        self.idf: Dict[str, float] = {}
        self.doc_count = 0

    def _tokenize(self, text: str) -> List[str]:
        """简单分词"""
        if HAS_JIEBA:
            return list(jieba.cut(text.lower()))
        # 简单分词：按非字母数字分割，保留中文单字
        tokens = re.findall(r'[\u4e00-\u9fa5]|[a-zA-Z0-9]+', text.lower())
        return tokens

    def fit(self, documents: List[str]):
        """训练词汇表和IDF"""
        self.doc_count = len(documents)
        word_doc_freq = defaultdict(int)
        for doc in documents:
            tokens = set(self._tokenize(doc))
            for token in tokens:
                word_doc_freq[token] += 1
        self.vocabulary = {word: idx for idx, word in enumerate(word_doc_freq.keys())}
        self.idf = {
            word: math.log((self.doc_count + 1) / (freq + 1)) + 1
            for word, freq in word_doc_freq.items()
        }

    def transform(self, text: str) -> List[float]:
        """转换文本为向量"""
        if not self.vocabulary:
            return []
        vector = [0.0] * len(self.vocabulary)
        tokens = self._tokenize(text)
        token_freq = Counter(tokens)
        for token, freq in token_freq.items():
            if token in self.vocabulary:
                idx = self.vocabulary[token]
                tf = freq / len(tokens) if tokens else 0
                idf = self.idf.get(token, 1.0)
                vector[idx] = tf * idf
        return vector

    @staticmethod
    def cosine_similarity(v1: List[float], v2: List[float]) -> float:
        """计算余弦相似度"""
        if not v1 or not v2 or len(v1) != len(v2):
            return 0.0
        if HAS_NUMPY:
            a = np.array(v1)
            b = np.array(v2)
            norm_a = np.linalg.norm(a)
            norm_b = np.linalg.norm(b)
            if norm_a == 0 or norm_b == 0:
                return 0.0
            return float(np.dot(a, b) / (norm_a * norm_b))
        dot = sum(a * b for a, b in zip(v1, v2))
        norm_a = math.sqrt(sum(a * a for a in v1))
        norm_b = math.sqrt(sum(b * b for b in v2))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)
