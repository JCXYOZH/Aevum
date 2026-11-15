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


class MemoryRecordMixin:
    """通用记忆写入、内容哈希与情感值。"""

    def record_memory(self, content: str, memory_type: str = "对话",
                      emotional_color: str = "平静",
                      associated_memories: List[str] = None,
                      context: Dict[str, Any] = None,
                      context_description: str = "",
                      importance: float = None) -> str:
        """
        记录一条新记忆（吸收0.1.5，完整实现）
        自动提取主题标签，并自动查找关联记忆（利用认知网络）
        """
        with self._lock:
            if not content or len(content.strip()) == 0:
                raise ValueError("记忆内容不能为空")
    
            # 1. 计算内容哈希
            hash_value = self._calculate_content_hash(content)
    
            # 2. 自动提取主题标签
            auto_topics = self._automatically_extract_topic_tags(content)
    
            # 3. 自动查找关联记忆（利用认知网络，吸收0.1.5）
            final_associated = associated_memories or []
            if not final_associated and hasattr(self, '_cognitive_network') and self._cognitive_network is not None:
                try:
                    # 尝试通过认知网络查找关联记忆（吸收0.1.5的方式）
                    if hasattr(self._cognitive_network, '_find_semantically_related_memories'):
                        related = self._cognitive_network._find_semantically_related_memories(
                            new_content=content,
                            topics=auto_topics,
                            emotion=emotional_color
                        )
                        # 取前 10 个最相关的记忆哈希
                        for mem in related[:10]:
                            if mem.get("memory_hash"):
                                final_associated.append(mem["memory_hash"])
                    elif hasattr(self._cognitive_network, 'find_related'):
                        related = self._cognitive_network.find_related(content, limit=3)
                        final_associated = [r.get('memory_id', '') for r in related if r.get('memory_id')]
                except Exception as e:
                    # 查找失败不影响主流程，只打印日志
                    print(f"[WARN] 自动查找关联记忆失败: {e}")
    
            # 如果认知网络没有找到，通过标签查找关联记忆
            if not final_associated:
                for topic in auto_topics[:3]:
                    related_ids = self._tag_index.get(topic, [])
                    for rid in related_ids[:2]:
                        # 统一去掉 .json 后缀（兼容旧数据中带后缀的情况）
                        clean_id = rid[:-5] if rid.endswith('.json') else rid
                        if clean_id not in final_associated:
                            final_associated.append(clean_id)
    
            # 4. 自动评估重要性（适配返回字典的版本）
            if importance is None:
                importance_result = self._assess_narrative_importance(content, context_description)
                if isinstance(importance_result, dict):
                    importance_level = importance_result.get("level", "日常片段")
                    importance_score = importance_result.get("score", 0.5)
                else:
                    importance_level = importance_result if isinstance(importance_result, str) else "日常片段"
                    importance_score = importance_result if isinstance(importance_result, float) else 0.5
            else:
                importance_level = "自定义"
                importance_score = importance
    
            # 5. 构建上下文
            context_str = context_description
            if context:
                try:
                    context_str = json.dumps(context, ensure_ascii=False)
                except Exception:
                    context_str = str(context)
    
            # 6. 生成记忆ID（不带 .json 后缀，保存文件时再加，兼容0.1.5的关联记忆格式）
            tag = f"{hash_value}_{int(time.time())}_{uuid.uuid4().hex[:4]}"
    
            # 7. 构建记忆单元（全部使用英文字段）
            memory_unit = {
                "memory_id": tag,
                "content": content,
                "memory_type": memory_type,
                "emotional_color": emotional_color,
                "emotional_valence": self._calculate_emotional_valence(emotional_color),
                "context_description": context_description,
                "context": context or {},
                "context_str": context_str,
                "related_memories": final_associated,
                "tags": auto_topics,
                "importance": importance_score,
                "importance_level": importance_level,
                "content_hash": hash_value,
                "version": 2,
                "created_at": time.time(),
                "created_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "timestamp": datetime.now().isoformat(),
            }
    
            # 8. 保存到记忆河流文件（文件名加 .json 后缀，memory_id 不带后缀）
            file_path = os.path.join(self.MemoryRiverDirectory, f"{tag}.json")
            try:
                with open(file_path, 'w', encoding='utf-8') as f:
                    json.dump(memory_unit, f, ensure_ascii=False, indent=2)
            except Exception as e:
                print(f"[FAIL] 保存记忆失败: {e}")
                return ""
    
            # 9. 同时添加到长期记忆（兼容我的设计）
            from libertas.ai.memory import Memory
            mem = Memory(
                content=content,
                memory_type=memory_type,
                importance=importance_score,
                tags=auto_topics,
                source="record_memory",
                context=context_str
            )
            # 手动设置 memory_id（Memory 类不接受 memory_id 参数）
            mem.memory_id = tag
            mem.emotional_valence = self._calculate_emotional_valence(emotional_color)
            mem.related_memories = final_associated
            mem.content_hash = hash_value
            mem.version = 2
            self._long_term[tag] = mem
    
            # 10. 更新关联记忆的反向引用（兼容带 .json 后缀的旧数据）
            for assoc_id in final_associated:
                # 尝试直接查找，找不到则尝试加 .json 后缀查找
                assoc_mem = self._long_term.get(assoc_id)
                if not assoc_mem:
                    assoc_mem = self._long_term.get(f"{assoc_id}.json")
                if assoc_mem and tag not in assoc_mem.related_memories and f"{tag}.json" not in assoc_mem.related_memories:
                    assoc_mem.related_memories.append(tag)
    
            # 11. 更新缓存和索引（吸收0.1.5）
            self.MemoryCache[tag] = memory_unit
            self._index_memory(tag, memory_unit)
            self.SystemState["记忆总量"] = len(self._long_term)
            self.SystemState["最后思考"] = datetime.now().isoformat()
            # 更新记忆网络统计（吸收0.1.5）
            if "记忆网络统计" not in self.SystemState:
                self.SystemState["记忆网络统计"] = {
                    "核心节点": 0, "枢纽节点": 0, "连接节点": 0, "孤立节点": 0
                }
            network_pos = self._analyze_location_in_memory_networks(tag)["网络位置"]
            if network_pos in self.SystemState["记忆网络统计"]:
                self.SystemState["记忆网络统计"][network_pos] += 1
            self._save_system_state()
    
            # 12. 将新节点注册到认知网络（让网络也能找到它，吸收0.1.5）
            if hasattr(self, '_cognitive_network') and self._cognitive_network is not None:
                try:
                    if hasattr(self._cognitive_network, 'process_new_memory'):
                        self._cognitive_network.process_new_memory(
                            content=content,
                            emotion=emotional_color,
                            topics=auto_topics,
                            memory_hash=hash_value
                        )
                except Exception as e:
                    print(f"[WARN] 注册到认知网络失败: {e}")
    
            return tag

    def _calculate_content_hash(self, content: str) -> str:
        """计算内容哈希（吸收0.1.5）"""
        fixed_salt = "libertas"
        return hashlib.sha256(f"{content}{fixed_salt}".encode()).hexdigest()[:32]

    def _calculate_emotional_valence(self, emotional_color: str) -> float:
        """计算情感效价值（-1到1之间）"""
        emotional_color = emotional_color or "平静"
        # 积极情感
        positive_emotions = ["开心", "快乐", "幸福", "感动", "惊喜", "兴奋", "满足", "感激", "希望", "爱"]
        # 消极情感
        negative_emotions = ["悲伤", "痛苦", "愤怒", "恐惧", "失望", "焦虑", "抑郁", "嫉妒", "羞耻", "内疚"]
    
        for emo in positive_emotions:
            if emo in emotional_color:
                return 0.8
        for emo in negative_emotions:
            if emo in emotional_color:
                return -0.8
        # 中性情感
        return 0.0
