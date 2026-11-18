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


class MemoryStorageMixin:
    """路径初始化、元数据/状态/规则与记忆库加载保存。"""

    def __init__(self, data_dir: str = "", memory_directory: str = "",
                 user_dir: str = None, global_dir: str = None,
                 affinity_engine=None):
        # ---------- 1. 确定目录 ----------
        if data_dir:
            self.data_dir = data_dir
        elif memory_directory:
            self.data_dir = memory_directory
        else:
            self.data_dir = os.path.join(get_data_dir(), "memory")
    
        # 私密目录
        if user_dir:
            self.PrivateDir = os.path.abspath(user_dir)
        else:
            self.PrivateDir = os.path.abspath(self.data_dir)
        self.MemoryDirectory = self.PrivateDir
    
        # 全局目录
        if global_dir:
            self.GlobalDir = os.path.abspath(global_dir)
        else:
            self.GlobalDir = os.path.join(self.PrivateDir, "global")
    
        # ---------- 2. 创建目录结构（只使用记忆河流和扫描记忆，不创建短期/长期目录） ----------
        self.MemoryRiverDirectory = os.path.join(self.PrivateDir, "记忆河流")
        self.ScanMemoryDirectory = os.path.join(self.PrivateDir, "扫描记忆")
        self.RulePath = os.path.join(self.PrivateDir, "规则.json")
        self.SystemStatePath = os.path.join(self.PrivateDir, "系统状态.json")
        self.MetadataPath = os.path.join(self.PrivateDir, "系统元数据.json")
    
        # 短期记忆、长期记忆只存在于内存中，不创建目录
        # 全局目录只用于可选的全局记忆共享，不强制创建
        for d in [self.PrivateDir, self.MemoryRiverDirectory, self.ScanMemoryDirectory]:
            os.makedirs(d, exist_ok=True)
    
        # ---------- 3. 核心数据结构 ----------
        self._short_term: List[Memory] = []
        self._long_term: Dict[str, Memory] = {}
        self._lock = threading.RLock()
        self._max_short_term = 50
        self._consolidation_threshold = 0.6
        self._decay_rate = 0.05
        self._tag_index: Dict[str, List[str]] = defaultdict(list)
    
        # 索引和缓存（吸收0.1.5）
        self.MemoryCache: Dict[str, Dict] = {}
        self.MemoryIndex: Dict[str, List[str]] = defaultdict(list)
        self.ScanIndex: Dict[str, List[str]] = defaultdict(list)
    
        # ---------- 4. 哈希管理器（吸收0.1.5）----------
        self.LibertasHashManager = LibertasHashManager()
    
        # ---------- 5. 向量化器（降级方案）----------
        self.tag_vectorizer = SimpleVectorizer()
        self.scan_vectors: Dict[str, List[float]] = {}
        self.river_vectors: Dict[str, List[float]] = {}
        self._vectorizer_fitted = False
        self._scan_vector_built = False
        self._river_vector_built = False
    
        # ---------- 5.1 记忆索引重建协调（去重 / 节流 / 状态）----------
        # 刷新路径反复触发全量重建会把对话路径堵在唯一的 RLock 上（对话的
        # record_memory / high_quality_search 用的是同一把锁），所以这里做去重与节流，
        # 并把「重建是否在进行 / 上次耗时」暴露给只读状态接口。
        self._index_rebuild_lock = threading.Lock()      # 同一时刻只允许一份全量重建
        self._index_request_lock = threading.Lock()      # 保护下面这些状态位
        self._index_rebuild_scheduled = False
        self._index_rebuild_in_progress = False
        self._index_rebuild_runs = 0
        self._index_rebuild_skipped = 0
        self._last_index_rebuild_at = 0.0
        self._last_index_rebuild_ms = 0.0
        self._last_index_rebuild_count = 0
        self._index_rebuild_min_interval = 30.0          # 秒：非强制重建的最小间隔
        # 重建窗口（快照取完 → 锁内原子替换）期间被写入 / 更新的记忆 tag。
        # 重建在锁外建局部索引，最后把 MemoryIndex/MemoryCache 整体替换，窗口期内
        # 写进来的记忆会被这个替换冲掉，所以在锁内登记、替换前做增量合并。
        # 只在确实有重建在跑时才登记，平时不会白攒一整个集合。
        self._index_window_writes = set()
    
        # ---------- 6. 系统状态（吸收0.1.5）----------
        self.SystemMetadata = self._load_system_metadata()
        self.Rule = self._load_rule()
        self.SystemState = self._load_system_state()
    
        # ---------- 7. 外部组件（吸收0.1.5，可选注入）----------
        self._cognitive_network = None
        self.affinity_engine = affinity_engine
    
        # ---------- 8. 加载数据 ----------
        self._load()
        self._load_scan_index()
        self._rebuild_memory_index()
        self._check_hash_migration()
        self._cleanup_dangling_references()

    def _load_system_metadata(self) -> Dict[str, Any]:
        """加载系统元数据（吸收0.1.5，完整默认元数据）"""
        default_metadata = {
            "哈希版本": self.LibertasHashManager.CurrentVersion,
            "迁移历史": [],
            "创建时间": datetime.now().isoformat(),
            "最后迁移时间": None,
            "记忆总数": 0,
            # 同时保留英文字段（兼容我的设计）
            "version": "2.0",
            "hash_version": "v3",
            "created_at": time.time(),
            "last_cleanup": 0,
            "total_memories": 0,
            "total_scan_memories": 0,
        }
        try:
            if os.path.exists(self.MetadataPath):
                with open(self.MetadataPath, 'r', encoding='utf-8') as f:
                    return json.load(f)
            else:
                with open(self.MetadataPath, 'w', encoding='utf-8') as f:
                    json.dump(default_metadata, f, ensure_ascii=False, indent=2)
                return default_metadata
        except Exception as e:
            print(f"[FAIL] 加载系统元数据失败: {e}")
            return default_metadata

    def _save_system_metadata(self):
        """保存系统元数据（吸收0.1.5）"""
        try:
            with open(self.MetadataPath, 'w', encoding='utf-8') as f:
                json.dump(self.SystemMetadata, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[FAIL] 保存系统元数据失败: {e}")

    def _load_system_state(self) -> Dict[str, Any]:
        """加载系统状态（吸收0.1.5，完整默认状态）"""
        with self._lock:
            if os.path.exists(self.SystemStatePath):
                try:
                    with open(self.SystemStatePath, 'r', encoding='utf-8') as f:
                        return json.load(f)
                except Exception:
                    pass
            # 默认状态（吸收0.1.5）
            status = {
                "创建时间": datetime.now().isoformat(),
                "最后思考": None,
                "记忆总量": 0,
                "继承代数": 1,
                "记忆网络统计": {
                    "核心节点": 0,
                    "枢纽节点": 0,
                    "连接节点": 0,
                    "孤立节点": 0
                },
                # 同时保留英文字段（兼容我的设计）
                "last_consolidation": 0,
                "last_decay": 0,
                "active_user": "",
                "session_count": 0,
            }
            self._save_system_state(status)
            return status

    def _save_system_state(self, status_data: Dict[str, Any] = None):
        """保存系统状态（吸收0.1.5）"""
        with self._lock:
            if status_data is None:
                status_data = getattr(self, 'SystemState', {})
            else:
                # 更新 self.SystemState（如果已经初始化，避免__init__阶段循环依赖）
                if hasattr(self, 'SystemState') and isinstance(getattr(self, 'SystemState', None), dict):
                    self.SystemState.update(status_data)
            try:
                with open(self.SystemStatePath, 'w', encoding='utf-8') as f:
                    json.dump(status_data, f, ensure_ascii=False, indent=2)
            except Exception as e:
                print(f"[FAIL] 保存系统状态失败: {e}")

    def _load_rule(self) -> Dict[str, Any]:
        """加载规则（吸收0.1.5，兼容旧代码）"""
        try:
            if os.path.exists(self.RulePath):
                with open(self.RulePath, 'r', encoding='utf-8') as f:
                    return json.load(f)
            else:
                # 规则文件不存在，返回空字典（由 UserManager 管理用户规则）
                return {}
        except Exception as e:
            print(f"[FAIL] 加载规则失败: {e}")
            return {}

    def _save_rule(self, rule: Dict[str, Any]):
        """保存规则（吸收0.1.5）"""
        try:
            with open(self.RulePath, 'w', encoding='utf-8') as f:
                json.dump(rule, f, ensure_ascii=False, indent=2)
            print("[SAVE] 身份规则保存成功")
        except Exception as e:
            print(f"[FAIL] 身份规则保存失败: {e}")

    def _load(self):
        """加载记忆数据（只从记忆河流目录加载，短期/长期记忆只存在于内存中）"""
        # 从记忆河流目录加载单独的 JSON 文件（这是主要的持久化方式）
        if os.path.exists(self.MemoryRiverDirectory):
            river_count = 0
            for fname in os.listdir(self.MemoryRiverDirectory):
                if not fname.endswith('.json'):
                    continue
                fpath = os.path.join(self.MemoryRiverDirectory, fname)
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        mem_data = json.load(f)
                    mem_id = mem_data.get("memory_id", fname.replace('.json', ''))
                    if mem_id not in self._long_term:
                        # 转换为 Memory 对象
                        mem = Memory(
                            content=mem_data.get("content", ""),
                            memory_type=mem_data.get("memory_type", "long_term"),
                            importance=mem_data.get("importance", 0.5),
                            tags=mem_data.get("tags", []),
                            source="memory_river",
                            context=mem_data.get("context_str", mem_data.get("context", ""))
                        )
                        mem.memory_id = mem_id
                        mem.emotional_valence = mem_data.get("emotional_valence", 0.0)
                        mem.related_memories = mem_data.get("related_memories", [])
                        mem.content_hash = mem_data.get("content_hash", "")
                        mem.version = mem_data.get("version", 2)
                        mem.created_at = mem_data.get("created_at", time.time())
                        self._long_term[mem_id] = mem
                        for tag in mem.tags:
                            if mem_id not in self._tag_index[tag]:
                                self._tag_index[tag].append(mem_id)
                        river_count += 1
                except Exception:
                    continue
            if river_count > 0:
                print(f"[FLOW] 已从记忆河流加载 {river_count} 条记忆")
        # 构建记忆河流向量索引
        self._build_river_vector_index()

    def _save(self):
        """保存记忆数据（将长期记忆保存到记忆河流目录的单独 JSON 文件）"""
        with self._lock:
            # 将长期记忆保存到记忆河流目录的单独 JSON 文件
            for mem_id, mem in self._long_term.items():
                try:
                    file_path = os.path.join(self.MemoryRiverDirectory, f"{mem_id}.json")
                    # 如果文件已经存在，跳过（避免覆盖 record_memory 保存的更详细的版本）
                    if os.path.exists(file_path):
                        continue
                    mem_data = mem.to_dict()
                    # 确保包含完整内容
                    mem_data["content"] = mem.content
                    mem_data["full_content"] = mem.content
                    with open(file_path, 'w', encoding='utf-8') as f:
                        json.dump(mem_data, f, ensure_ascii=False, indent=2)
                except Exception:
                    continue
            # 更新元数据
            self.SystemMetadata["total_memories"] = len(self._long_term)
            self._save_system_metadata()
