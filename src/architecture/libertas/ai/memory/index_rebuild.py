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


class MemoryIndexRebuildMixin:
    """索引快照、合并写入、重建请求与状态。"""

    def _collect_index_snapshot(self) -> List[tuple]:
        """在全局锁之外收集「tag -> 记忆数据」快照（重建里唯一的重 I/O 部分）。"""
        snapshot = []
        for tag in self._get_all_memory_tags():
            if not os.path.exists(os.path.join(self.MemoryRiverDirectory, tag)):
                # 如果文件已被删除，跳过（不触发 read_memory 的清理流程，减少日志）
                continue
            memory_data = self.read_memory(tag, silent=True)
            if memory_data:
                snapshot.append((tag, memory_data))
        return snapshot

    def _mark_index_window_write(self, tag: str):
        """登记「重建窗口期内被写入 / 更新的记忆」（调用方须持有 self._lock）。
    
        只在确实有全量重建在跑时登记：窗口期内「新增」的记忆由 _long_term 的键集合
        差集兜住，这里主要覆盖「对已存在记忆的就地更新」——它不改变 tag 集合，
        却会让重建在锁外取到的快照变成旧数据。
        """
        if tag and self._index_rebuild_in_progress:
            self._index_window_writes.add(tag)

    def _merge_window_writes(self, new_index: dict, new_cache: dict,
                             snapshot_ids: set) -> int:
        """锁内增量合并：把重建窗口期内写入 / 更新的记忆补进即将生效的新索引。
    
        窗口 = 「长期记忆快照取完 → 锁内原子替换」之间。窗口期内 record_memory /
        _save_memory_update 已经在 self._lock 内把数据写进了 self._long_term，
        但 new_index / new_cache 是在快照上建的，整体替换会把它们冲掉：文件还在、
        read_memory 也读得到，但按索引 / 关键词检索会漏掉它们（要等下次重建才自愈）。
        这里只补差量（通常 0～几条），且与替换同处一个锁临界区，替换对读者仍然原子。
        调用方须持有 self._lock。
        """
        merged = 0
        for tag, mem in list(self._long_term.items()):
            if tag in snapshot_ids and tag not in self._index_window_writes:
                continue
            # 窗口期新增（快照里没有）或窗口期被更新（快照是旧数据）：
            # 用内存中的当前数据重建这条记忆的索引与缓存条目。
            self._index_memory(tag, mem.to_dict(), index=new_index, cache=new_cache)
            merged += 1
        return merged

    def _rebuild_memory_index(self):
        """重建记忆索引（遍历记忆河流 + 长期记忆）。
    
        I/O 阶段在全局锁之外完成，锁内只做「窗口写入合并 + 一次原子替换」，
        避免长时间阻塞对话与检索。
        """
        with self._index_rebuild_lock:            # 同一时刻只允许一份全量重建
            self._index_rebuild_in_progress = True
            started = time.time()
            try:
                print("[TOOL] 重建记忆索引...")
                # 1. 锁外：清缓存（下次读取直接回源）→ 逐个读文件 → 纯内存建新索引
                #    （全程只写局部字典，不碰全局状态；建索引本身含大量成员判断，
                #      放在锁里会让对话请求整轮排队。）
                #    「清缓存 + 窗口登记表清零」放在锁内、且早于取快照：这样窗口期内
                #    写进来的记忆一定会被登记，并与最终替换落在同一把锁里。
                with self._lock:
                    self.MemoryCache.clear()
                    self._index_window_writes.clear()
                snapshot = self._collect_index_snapshot()
                # 长期记忆只存在于内存里，直接取快照（to_dict 已能容忍字符串时间戳）
                long_term_snapshot = [(mid, mem.to_dict())
                                      for mid, mem in list(self._long_term.items())]
                snapshot_ids = {mid for mid, _ in long_term_snapshot}
                new_index = defaultdict(list)
                new_cache = {}
                for tag, memory_data in snapshot:
                    self._index_memory(tag, memory_data, index=new_index, cache=new_cache)
                for mem_id, mem_data in long_term_snapshot:
                    if mem_id not in new_cache:
                        self._index_memory(mem_id, mem_data,
                                           index=new_index, cache=new_cache)
                # 2. 锁内：先把窗口期写入的差量并进新索引，再做一次原子替换
                #    （O(1) 替换，只对差量建索引，不阻塞对话与检索）
                with self._lock:
                    merged = self._merge_window_writes(new_index, new_cache, snapshot_ids)
                    self.MemoryIndex = new_index
                    self.MemoryCache = new_cache
                    self._index_window_writes.clear()
                    count = len(new_cache)
                elapsed = time.time() - started
                self._last_index_rebuild_at = time.time()
                self._last_index_rebuild_ms = elapsed * 1000.0
                self._last_index_rebuild_count = count
                self._index_rebuild_runs += 1
                merged_note = f"，并入窗口期写入 {merged} 条" if merged else ""
                print(f"[OK] 记忆索引重建完成: {count}条记忆（耗时 {elapsed:.2f}s{merged_note}）")
                return count
            finally:
                self._index_rebuild_in_progress = False

    def request_memory_index_rebuild(self, reason: str = "", force: bool = False,
                                     wait: bool = False, min_interval: float = None) -> Dict[str, Any]:
        """请求一次记忆索引重建（刷新路径专用）：并发去重 + 最小间隔节流 + 后台执行。
    
        返回 {"started": bool, "status": "started"/"running"/"throttled"/"done"}。
        请求线程只做判断，重活在后台线程里跑，绝不阻塞对话与其它 API。
        """
        interval = self._index_rebuild_min_interval if min_interval is None else float(min_interval)
        now = time.time()
        with self._index_request_lock:
            if self._index_rebuild_in_progress or self._index_rebuild_scheduled:
                self._index_rebuild_skipped += 1
                return {"started": False, "status": "running", "reason": reason,
                        "skipped_total": self._index_rebuild_skipped}
            if not force and (now - self._last_index_rebuild_at) < interval:
                self._index_rebuild_skipped += 1
                return {"started": False, "status": "throttled", "reason": reason,
                        "min_interval": interval,
                        "skipped_total": self._index_rebuild_skipped}
            self._index_rebuild_scheduled = True
        if wait:
            try:
                self._rebuild_memory_index()
            finally:
                self._index_rebuild_scheduled = False
            return {"started": True, "status": "done", "reason": reason}
        threading.Thread(target=self._rebuild_index_worker, args=(reason,),
                         daemon=True, name="MemoryIndexRebuild").start()
        return {"started": True, "status": "started", "reason": reason}

    def _rebuild_index_worker(self, reason: str = ""):
        """后台重建线程：失败只记录，不把异常带进请求线程。"""
        try:
            self._rebuild_memory_index()
        except Exception as e:
            print(f"[WARN] 记忆索引重建失败（{reason or '未标注'}）: {e}")
        finally:
            self._index_rebuild_scheduled = False

    def get_index_status(self) -> Dict[str, Any]:
        """只读、廉价的索引状态快照：不触发任何重建、不读记忆文件内容。"""
        try:
            river_files = len(self._get_all_memory_tags())
        except Exception:
            river_files = 0
        return {
            "indexed_keywords": len(self.MemoryIndex),
            "cached_memories": len(self.MemoryCache),
            "river_files": river_files,
            "long_term_memories": len(self._long_term),
            "rebuilding": bool(self._index_rebuild_in_progress or self._index_rebuild_scheduled),
            "last_rebuild_at": self._last_index_rebuild_at,
            "last_rebuild_duration_ms": round(self._last_index_rebuild_ms, 1),
            "last_rebuild_count": self._last_index_rebuild_count,
            "rebuild_runs": self._index_rebuild_runs,
            "rebuild_skipped": self._index_rebuild_skipped,
            "min_interval_seconds": self._index_rebuild_min_interval,
            "vectorizer_fitted": bool(self._vectorizer_fitted),
        }
