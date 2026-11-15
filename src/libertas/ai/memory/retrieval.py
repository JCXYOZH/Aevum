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


class MemoryRetrievalMixin:
    """通用检索、密度检索、混合检索与按日期检索。"""

    def retrieve(self, query: str, memory_type: str = "",
                 limit: int = 10, min_strength: float = 0.0) -> List[Dict[str, Any]]:
        """基础检索"""
        results = []
        query_lower = query.lower()
    
        # 搜索长期记忆
        for mem in self._long_term.values():
            if memory_type and mem.memory_type != memory_type:
                continue
            if mem.strength < min_strength:
                continue
            score = 0
            if query_lower in mem.content.lower():
                score += 10
            if query_lower in mem.context.lower():
                score += 5
            for tag in mem.tags:
                if query_lower in tag.lower():
                    score += 3
            if score > 0:
                results.append({**mem.to_dict(), "score": score})
    
        # 搜索短期记忆
        for mem in self._short_term:
            if memory_type and mem.memory_type != memory_type:
                continue
            score = 0
            if query_lower in mem.content.lower():
                score += 8
            for tag in mem.tags:
                if query_lower in tag.lower():
                    score += 2
            if score > 0:
                results.append({**mem.to_dict(), "score": score})
    
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]

    def search_by_date(self, start_date: str, end_date: str,
                       keyword: str = None, limit: int = 20) -> List[Dict]:
        """按日期搜索（吸收0.1.5）"""
        results = []
        try:
            start_ts = datetime.strptime(start_date, "%Y-%m-%d").timestamp()
            end_ts = datetime.strptime(end_date, "%Y-%m-%d").timestamp() + 86400
        except Exception:
            return []
    
        for mem in self._long_term.values():
            if start_ts <= mem.created_at <= end_ts:
                if keyword and keyword.lower() not in mem.content.lower():
                    continue
                results.append(mem.to_dict())
    
        results.sort(key=lambda x: x["created_at"], reverse=True)
        return results[:limit]

    def retrieve_by_density(self, query, user_id=None, top_k=5, min_energy=0.1) -> List[Dict]:
        """按密度检索（吸收0.1.5，基于记忆能量和关联密度）"""
        with self._lock:
            candidates = []
            query_lower = query.lower() if query else ""
    
            # 1. 收集候选记忆
            for mem_id, mem in self._long_term.items():
                energy = mem.strength * mem.importance * (1 + 0.1 * math.log1p(mem.access_count))
                if energy < min_energy:
                    continue
                # 相关性计算
                relevance = 0
                if query_lower and query_lower in mem.content.lower():
                    relevance += 5
                if query_lower and query_lower in mem.context.lower():
                    relevance += 3
                for tag in mem.tags:
                    if query_lower and query_lower in tag.lower():
                        relevance += 2
                # 密度 = 能量 * (1 + 相关性) * (1 + 关联记忆数 * 0.1)
                density = energy * (1 + relevance) * (1 + len(mem.related_memories) * 0.1)
                candidates.append({
                    "memory_id": mem_id,
                    "memory": mem.to_dict(),
                    "energy": round(energy, 4),
                    "density": round(density, 4),
                    "relevance": relevance,
                })
    
            # 2. 按密度排序
            candidates.sort(key=lambda x: x["density"], reverse=True)
    
            # 3. 如果有用户ID和动态吸附引擎，应用权重
            if user_id and hasattr(self, 'affinity_engine') and self.affinity_engine:
                try:
                    effect = self.affinity_engine.get_interaction_effect(user_id)
                    weight = effect.get('weight_multiplier', 1.0)
                    if weight != 1.0:
                        for item in candidates:
                            item['density'] = item['density'] * weight
                        candidates.sort(key=lambda x: x["density"], reverse=True)
                except Exception:
                    pass
    
            return candidates[:top_k]

    def retrieve_mixed(self, query: str, quantity: int = 5) -> List[Dict[str, Any]]:
        """
        混合检索（吸收0.1.5，完整实现）
        同时使用关键词（主题标签）和全文内容匹配。
        数据源：私密记忆（主）+ 全局记忆（补充）+ 扫描记忆（增强）
        """
        with self._lock:
            # 1. 分词提取关键词
            stopwords = {'的','了','在','是','我','有','和','就','不','人','都','一','一个','上','也','很','到','说','要','去','你','会','着','没有','看','好','自己','这','那','什么','怎么','为什么','如何','可以','应该','因为','所以','但是','如果','那么','嗯','啊','呢','吧','哦','哈','嘿','哎','喂','嗨'}
            if HAS_JIEBA:
                words = jieba.lcut(query)
            else:
                words = list(query)
            keywords = [w for w in words if w not in stopwords and len(w) > 1]
            if not keywords:
                keywords = [query]
    
            # 2. 主题标签检索（仅私密索引）
            tag_results = {}
            for kw in keywords[:5]:
                for index_key in list(self.MemoryIndex.keys()):
                    if index_key.startswith("主题:") and kw in index_key:
                        for tag in list(self.MemoryIndex[index_key]):
                            if tag not in tag_results:
                                mem = self.read_memory(tag)
                                if mem:
                                    tag_results[tag] = mem
                                else:
                                    # 索引中的标签对应文件不存在，清理索引
                                    self.MemoryIndex[index_key].remove(tag)
                                    if not self.MemoryIndex[index_key]:
                                        del self.MemoryIndex[index_key]
    
            # 3. 全文检索（私密 + 全局 + 扫描）
            full_results = {}
    
            # 3a. 私密记忆全文检索
            all_tags = self.get_all_memory_tags()
            for tag in all_tags:
                mem = self.read_memory(tag)
                if not mem:
                    continue
                content = mem.get("content", "")
                if any(kw in content for kw in keywords):
                    full_results[tag] = mem
    
            # 3b. 全局记忆全文检索
            global_tags = self._get_global_memory_tags()
            for tag in global_tags:
                if tag in full_results or tag in tag_results:
                    continue
                mem = self._read_global_memory(tag)
                if not mem:
                    continue
                content = mem.get("content", "")
                if any(kw in content for kw in keywords):
                    full_results[tag] = mem
    
            # 3c. 扫描记忆全文检索（增强版）
            if os.path.exists(self.ScanMemoryDirectory):
                scan_tags = [f for f in os.listdir(self.ScanMemoryDirectory)
                              if f.endswith('.json') and f != '_index.json']
                for tag in scan_tags:
                    if tag in full_results or tag in tag_results:
                        continue
                    mem = self._read_scan_memory(tag.replace('.json', ''))
                    if not mem:
                        continue
                    content = mem.get("content", "")
                    context = mem.get("context", {})
                    target = context.get("target", "") if isinstance(context, dict) else ""
                    scan_type = context.get("scan_type", "") if isinstance(context, dict) else ""
    
                    # 检查内容、目标、扫描类型是否匹配任何关键词
                    matched = False
                    for kw in keywords:
                        if kw in content or kw in target or kw in scan_type:
                            matched = True
                            break
                    if matched:
                        full_results[tag] = mem
    
            # 4. 合并结果（主题优先）
            merged = {}
            for tag, mem in tag_results.items():
                merged[tag] = mem
            for tag, mem in full_results.items():
                if tag not in merged:
                    merged[tag] = mem
    
            private_tags = set(self.get_all_memory_tags())
    
            # 5. 计算相关性分数
            results = []
            for tag, mem in merged.items():
                relevance = 0
    
                # 内容长度得分
                content_len = len(mem.get("content", ""))
                if content_len > 200:
                    relevance += 2
                elif content_len > 100:
                    relevance += 1
    
                # 主题标签数量
                topic_count = len(mem.get("tags", []))
                relevance += min(topic_count, 3)
    
                # 关联记忆数量
                rel_count = len(mem.get("related_memories", []))
                relevance += min(rel_count, 2)
    
                # 网络位置（仅私密记忆）
                if tag in private_tags:
                    net_pos = self._analyze_location_in_memory_networks(tag)["网络位置"]
                    if net_pos == "核心节点":
                        relevance += 3
                    elif net_pos == "枢纽节点":
                        relevance += 2
                    elif net_pos == "连接节点":
                        relevance += 1
                else:
                    # 全局或扫描记忆给予基础加分
                    relevance += 1
    
                # 关键词出现次数加分
                content = mem.get("content", "")
                kw_count = sum(content.count(kw) for kw in keywords)
                relevance += min(kw_count, 3)
    
                # 扫描记忆额外加分
                mem_type = mem.get("memory_type", "")
                if mem_type == "安全扫描" or "scan" in str(tag).lower():
                    context = mem.get("context", {})
                    target = context.get("target", "") if isinstance(context, dict) else ""
                    scan_type = context.get("scan_type", "") if isinstance(context, dict) else ""
                    # 如果目标或扫描类型匹配关键词，加分
                    for kw in keywords:
                        if kw in target or kw in scan_type:
                            relevance += 3
                            break
                    # 如果是工具名直接匹配 scan_type，再加分
                    if any(kw.lower() in scan_type.lower() for kw in keywords):
                        relevance += 5
    
                mem['相关性分数'] = relevance
                mem['source_type'] = 'private' if tag in private_tags else ('scan' if 'scan' in str(tag).lower() else 'global')
                results.append(mem)
    
            # 6. 排序并返回
            results.sort(key=lambda x: x.get('相关性分数', 0), reverse=True)
            return results[:quantity]
