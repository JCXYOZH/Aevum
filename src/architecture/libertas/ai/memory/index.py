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


class MemoryIndexMixin:
    """扫描索引、向量索引与记忆索引维护。"""

    def _load_scan_index(self):
        """加载扫描索引"""
        scan_index_file = os.path.join(self.ScanMemoryDirectory, "_index.json")
        if os.path.exists(scan_index_file):
            try:
                with open(scan_index_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.ScanIndex = defaultdict(list, data.get("index", {}))
            except Exception:
                pass

    def _save_scan_index(self):
        """保存扫描索引"""
        scan_index_file = os.path.join(self.ScanMemoryDirectory, "_index.json")
        try:
            with open(scan_index_file, 'w', encoding='utf-8') as f:
                json.dump({"index": dict(self.ScanIndex)}, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def _build_scan_vector_index(self):
        """构建扫描向量索引（吸收0.1.5，使用jieba分词+numpy数组）"""
        self.scan_vectors = {}
        self._scan_vector_built = True
        if not os.path.exists(self.ScanMemoryDirectory):
            print(f"[OK] 扫描向量索引构建完成: 0条记忆（扫描记忆目录不存在）")
            return
        count = 0
        for fname in os.listdir(self.ScanMemoryDirectory):
            if not fname.endswith('.json') or fname == '_index.json':
                continue
            fpath = os.path.join(self.ScanMemoryDirectory, fname)
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                content = data.get("content", "")
                if content:
                    self._add_scan_vector(fname, content)
                    count += 1
            except Exception:
                continue
        if count > 0:
            self._vectorizer_fitted = True
        print(f"[OK] 扫描向量索引构建完成: {count}条记忆")

    def _build_river_vector_index(self):
        """构建记忆河流向量索引（使用jieba分词+SimpleVectorizer）"""
        self.river_vectors = {}
        self._river_vector_built = True
        count = 0
        for mem_id, mem in self._long_term.items():
            try:
                if mem.content:
                    self._add_river_vector(mem_id, mem.content)
                    count += 1
            except Exception:
                continue
        if count > 0:
            self._vectorizer_fitted = True
        print(f"[OK] 记忆河流向量索引构建完成: {count}条记忆")

    def _add_river_vector(self, mem_id: str, content: str):
        """将单条记忆河流记忆加入向量索引"""
        try:
            if not content:
                return
            if not self._vectorizer_fitted:
                self.tag_vectorizer.fit([content])
                self._vectorizer_fitted = True
            vec = self.tag_vectorizer.transform(content)
            if vec:
                self.river_vectors[mem_id] = vec
        except Exception:
            pass

    def _add_scan_vector(self, tag: str, content: str):
        """将单条扫描记忆加入向量索引（吸收0.1.5，使用jieba分词+numpy数组）"""
        try:
            if not content:
                return
            if HAS_JIEBA:
                tags = list(jieba.cut(content))
            else:
                tags = list(content)
            if not tags:
                tags = [content[:10]]
            # 先拟合向量器（如果还没有拟合）
            if not self._vectorizer_fitted:
                self.tag_vectorizer.fit([content])
                self._vectorizer_fitted = True
            vec = self.tag_vectorizer.transform(content)
            if vec:
                self.scan_vectors[tag] = vec
        except Exception as e:
            print(f"[WARN] 添加扫描向量索引失败: {e}")

    def _index_memory(self, tag: str, memory_data: Dict[str, Any],
                      index: Dict[str, List[str]] = None, cache: Dict[str, Dict] = None):
        """索引记忆（吸收0.1.5，完整实现：主题标签/情感色彩/时间/类型索引）
    
        index / cache 默认写自身；重建索引时传入局部字典，这样整段重建可以只在
        最后替换索引的那一小段持有全局锁，不会把对话路径堵在锁上。
        """
        if not hasattr(self, "MemoryIndex"):
            self.MemoryIndex = defaultdict(list)
        if index is None:
            index = self.MemoryIndex
        if cache is None:
            cache = self.MemoryCache
        # 1. 主题标签索引
        topic_list = memory_data.get("tags", memory_data.get("tags", []))
        if not topic_list:
            topic_list = self._automatically_extract_topic_tags(memory_data.get("content", memory_data.get("content", "")))
            memory_data["tags"] = topic_list
            memory_data["tags"] = topic_list
        for topic in topic_list:
            index_key = f"主题:{topic}"
            if tag not in index[index_key]:
                index[index_key].append(tag)
            # 同时保留无前缀的索引（兼容旧代码）
            if tag not in index[topic]:
                index[topic].append(tag)
        # 2. 情感色彩索引
        emotion = memory_data.get("emotional_color", memory_data.get("emotional_color"))
        if emotion:
            index_key = f"情感:{emotion}"
            if tag not in index[index_key]:
                index[index_key].append(tag)
        # 3. 时间索引
        time_str = memory_data.get("created_at", memory_data.get("created_time"))
        if time_str:
            try:
                if isinstance(time_str, (int, float)):
                    date = datetime.fromtimestamp(time_str)
                else:
                    date = datetime.fromisoformat(str(time_str).replace('Z', '+00:00'))
                month_key = f"时间:{date.year}年{date.month}月"
                if tag not in index[month_key]:
                    index[month_key].append(tag)
            except Exception:
                pass
        # 4. 类型索引
        memory_type = memory_data.get("memory_type", memory_data.get("memory_type"))
        if memory_type:
            index_key = f"类型:{memory_type}"
            if tag not in index[index_key]:
                index[index_key].append(tag)
        # 5. 缓存
        cache[tag] = memory_data

    def _remove_from_index(self, tag: str, silent: bool = False):
        """从索引移除"""
        for t in list(self.MemoryIndex.keys()):
            if tag in self.MemoryIndex[t]:
                self.MemoryIndex[t].remove(tag)
        if tag in self.MemoryCache:
            del self.MemoryCache[tag]
        if tag in self.scan_vectors:
            del self.scan_vectors[tag]

    def _remove_from_scan_index(self, tag: str, silent: bool = False):
        """从扫描索引移除（吸收0.1.5）"""
        with self._lock:
            removed = False
            for target in list(self.ScanIndex.keys()):
                if tag in self.ScanIndex[target]:
                    self.ScanIndex[target].remove(tag)
                    removed = True
                if not self.ScanIndex[target]:
                    del self.ScanIndex[target]
            if removed:
                self._save_scan_index()
            if not silent and removed:
                logger.debug(f"Removed from scan index: {tag}")
