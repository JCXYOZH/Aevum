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


class MemoryNetworkMixin:
    """记忆关系网络查看、关联维护与相关记忆检索。"""

    def _obtain_view_memory_network(self, memory_tag: str) -> Dict[str, Any]:
        """获取记忆网络视图（吸收0.1.5，完整实现）"""
        memory_data = self.read_memory(memory_tag)
        if not memory_data:
            return {"错误": "记忆不存在"}
        return {
            "记忆详情": {
                "内容": memory_data.get("content", memory_data.get("content")),
                "时间": memory_data.get("created_at", memory_data.get("created_time")),
                "情感色彩": memory_data.get("emotional_color", memory_data.get("emotional_color")),
                "主题标签": memory_data.get("tags", memory_data.get("tags", [])),
                "情境描述": memory_data.get("context_description", memory_data.get("context")),
            },
            "直接关联": self._get_directly_associated_memories(memory_tag),
            "主题关联": self._retrieve_theme_related_memories(
                memory_data.get("tags", memory_data.get("tags", []))
            ),
            "时间关联": self._retrieve_time_related_memories(
                memory_data.get("created_at", memory_data.get("created_time"))
            ),
            "网络位置": self._analyze_location_in_memory_networks(memory_tag),
            # 同时保留英文键（兼容旧代码）
            "memory_id": memory_tag,
            "content": memory_data.get("content", memory_data.get("content", ""))[:100],
            "tags": memory_data.get("tags", memory_data.get("tags", [])),
            "related_count": len(self._get_directly_associated_memories(memory_tag)),
        }

    def _analyze_location_in_memory_networks(self, tag: str) -> Dict[str, Any]:
        """分析记忆在网络中的位置（吸收0.1.5，完整实现）"""
        try:
            direct_count = len(self._get_directly_associated_memories(tag))
            memory_data = self.read_memory(tag, silent=True)
            theme_list = memory_data.get("tags", []) if memory_data else []
            theme_count = len(self._retrieve_theme_related_memories(theme_list))
            total = direct_count + theme_count
            if total == 0:
                location = "孤立节点"
            elif total < 5:
                location = "连接节点"
            elif total < 15:
                location = "枢纽节点"
            else:
                location = "核心节点"
            return {"网络位置": location, "关联强度": total}
        except Exception:
            return {"网络位置": "未知节点", "关联强度": 0}

    def _get_directly_associated_memories(self, tag: str) -> List[str]:
        """获取直接关联记忆"""
        mem = self.get_memory(tag)
        if not mem:
            return []
        associated = set(mem.related_memories)
        # 通过标签关联
        for t in mem.tags:
            for related_id in self._tag_index.get(t, []):
                if related_id != tag:
                    associated.add(related_id)
        return list(associated)

    def _update_associated_memory_references(self, removed_tag: str):
        """更新关联记忆引用（吸收0.1.5）"""
        with self._lock:
            updated_count = 0
            for mem_id, mem in self._long_term.items():
                if removed_tag in mem.related_memories:
                    mem.related_memories.remove(removed_tag)
                    updated_count += 1
            if updated_count > 0:
                self._save()
            logger.debug(f"Updated associated memory references for {removed_tag}: {updated_count} memories")

    def _remove_network_of_relationships(self, tag: str):
        """移除关系网络（吸收0.1.5）"""
        with self._lock:
            # 1. 获取直接关联记忆
            associated = self._get_directly_associated_memories(tag)
            # 2. 从关联记忆中移除引用
            self._update_associated_memory_references(tag)
            # 3. 从索引中移除
            self._remove_from_index(tag, silent=True)
            self._remove_from_scan_index(tag, silent=True)
            # 4. 从向量索引移除
            if tag in self.scan_vectors:
                del self.scan_vectors[tag]
            # 5. 从记忆河流删除文件
            river_file = os.path.join(self.MemoryRiverDirectory, f"{tag}.json")
            if os.path.exists(river_file):
                try:
                    os.remove(river_file)
                except Exception:
                    pass
            # 6. 从扫描记忆删除文件
            scan_file = os.path.join(self.ScanMemoryDirectory, f"{tag}.json")
            if os.path.exists(scan_file):
                try:
                    os.remove(scan_file)
                except Exception:
                    pass
            logger.debug(f"Removed network of relationships for {tag}: {len(associated)} associated")

    def _save_memory_update(self, tag: str, memory_data: Dict[str, Any]):
        """保存记忆更新（吸收0.1.5）"""
        with self._lock:
            # 窗口期内对已存在记忆的更新：登记给重建做增量合并（见 _merge_window_writes）
            self._mark_index_window_write(tag)
            # 1. 更新长期记忆
            if tag in self._long_term:
                mem = self._long_term[tag]
                for key, value in memory_data.items():
                    if hasattr(mem, key):
                        setattr(mem, key, value)
                mem.updated_at = time.time()
                mem.compute_hash(self.LibertasHashManager)
            # 2. 更新记忆河流文件
            river_file = os.path.join(self.MemoryRiverDirectory, f"{tag}.json")
            if os.path.exists(river_file):
                try:
                    with open(river_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    data.update(memory_data)
                    data["updated_at"] = time.time()
                    with open(river_file, 'w', encoding='utf-8') as f:
                        json.dump(data, f, ensure_ascii=False, indent=2)
                except Exception:
                    pass
            # 3. 更新缓存
            if tag in self.MemoryCache:
                self.MemoryCache[tag].update(memory_data)
            # 4. 保存
            self._save()

    def _retrieve_theme_related_memories(self, theme_list: List[str]) -> List[str]:
        """检索主题相关记忆"""
        related = set()
        for theme in theme_list:
            for mem_id in self._tag_index.get(theme, []):
                related.add(mem_id)
        return list(related)

    def _retrieve_time_related_memories(self, time_str: str) -> List[str]:
        """检索时间相关记忆"""
        related = []
        try:
            target_time = datetime.strptime(time_str, "%Y-%m-%d").timestamp()
            for mem in self._long_term.values():
                if abs(mem.created_at - target_time) < 86400 * 7:
                    related.append(mem.memory_id)
        except Exception:
            pass
        return related

    def _retrieve_relevant_memories(self, query: str, limit: int = 3) -> Dict[str, Any]:
        """检索相关记忆（吸收0.1.5，兼容两种返回格式）"""
        try:
            relevant = []
            # 1. 使用0.1.5版本的方式：遍历所有记忆标签，查找包含查询的记忆
            all_tags = self.get_all_memory_tags()
            for tag in all_tags[:20]:
                memory_data = self.read_memory(tag, silent=True)
                if memory_data and query in memory_data.get("content", memory_data.get("content", "")):
                    relevant.append({
                        "内容": memory_data.get("content", memory_data.get("content")),
                        "情感色彩": memory_data.get("emotional_color", memory_data.get("emotional_color", "平静")),
                        "时间": memory_data.get("created_at", memory_data.get("created_time"))
                    })
                if len(relevant) >= limit:
                    break
            # 2. 如果没有找到，使用增强版检索
            if not relevant:
                results = self.retrieve(query, limit=limit)
                for mem in results:
                    relevant.append({
                        "内容": mem.get("content", ""),
                        "情感色彩": mem.get("emotional_color", "平静"),
                        "时间": mem.get("created_time", "")
                    })
            # 3. 返回两种格式（兼容0.1.5和增强版）
            return {
                "相关记忆": relevant,
                "query": query,
                "count": len(relevant),
                "memories": relevant,
            }
        except Exception as e:
            print(f"[WARN] 检索相关记忆失败: {e}")
            return {"相关记忆": [], "query": query, "count": 0, "memories": []}
