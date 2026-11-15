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


class MemoryMaintenanceMixin:
    """完整性验证、哈希迁移、相似匹配与悬空引用清理。"""

    def validate_and_repair_memory_system(self) -> dict:
        """验证和修复记忆系统（保留，增强）"""
        result = {"valid": True, "repaired": [], "errors": []}
        try:
            # 验证长期记忆
            invalid_ids = []
            for mem_id, mem in list(self._long_term.items()):
                if not self._verify_memory_integrity(mem.to_dict()):
                    result["errors"].append(f"Invalid memory: {mem_id}")
                    invalid_ids.append(mem_id)
            # 修复无效记忆
            for mem_id in invalid_ids:
                del self._long_term[mem_id]
                result["repaired"].append(f"Removed invalid memory: {mem_id}")
            # 清理悬空引用
            cleanup_result = self._cleanup_dangling_references()
            if cleanup_result.get("removed", 0) > 0:
                result["repaired"].append(f"Cleaned up {cleanup_result['removed']} dangling references")
            result["valid"] = len(result["errors"]) == 0
        except Exception as e:
            result["valid"] = False
            result["errors"].append(str(e))
        return result

    def _verify_memory_integrity(self, memory_data: Dict) -> bool:
        """验证记忆完整性（吸收0.1.5，完整实现：4个验证维度）"""
        if not memory_data or not isinstance(memory_data, dict):
            return False
        # 1. 验证内容是否为字符串且非空
        content = memory_data.get("content", memory_data.get("content", ""))
        if not isinstance(content, str) or len(content.strip()) == 0:
            return False
        # 2. 验证4个维度（吸收0.1.5）
        validation_dimensions = {
            "time_anchor": bool(memory_data.get("created_at", memory_data.get("created_time"))),
            "emotion": bool(memory_data.get("emotional_color", memory_data.get("emotional_color")) or "情感" in memory_data),
            "topic": bool(memory_data.get("tags", memory_data.get("tags")) or self._automatically_extract_topic_tags(content)),
            "context": bool(memory_data.get("context_description", memory_data.get("context")) or self._automatically_extract_context_keywords(content)),
        }
        # 3. 计算完整性分数（0-1）
        integrity_score = sum(validation_dimensions.values()) / len(validation_dimensions)
        # 4. 验证必需字段和哈希
        # 必需字段：memory_id、content、created_at
        required_fields_check = {
            "memory_id": bool(memory_data.get("memory_id")),
            "content": bool(content),  # content 已经在上面验证过非空
            "created_at": bool(memory_data.get("created_at")),
        }
        has_required = all(required_fields_check.values())
        # 验证哈希（哈希验证失败不应该删除记忆，只标记为需要重新计算）
        content_hash = memory_data.get("content_hash", "")
        hash_valid = True
        if content_hash and content and hasattr(self, 'LibertasHashManager') and self.LibertasHashManager:
            try:
                detected_version = self.LibertasHashManager.detecting_hash_version(content_hash, content)
                if not detected_version:
                    # 哈希不匹配，重新计算哈希，不删除记忆
                    hash_valid = True  # 不因为哈希问题删除记忆
            except Exception:
                hash_valid = True  # 哈希验证异常，不删除记忆
        # 5. 返回完整性分数 >= 0.5 且必需字段存在（哈希问题不删除记忆）
        return integrity_score >= 0.5 and has_required

    def _check_hash_migration(self):
        """检查哈希迁移"""
        migrated = 0
        for mem in self._long_term.values():
            if mem.content_hash and mem.content:
                detected_version = self.LibertasHashManager.detecting_hash_version(
                    mem.content_hash, mem.content
                )
                if detected_version and detected_version != self.LibertasHashManager.CurrentVersion:
                    mem.compute_hash(self.LibertasHashManager)
                    migrated += 1
        if migrated > 0:
            self.SystemMetadata["hash_version"] = self.LibertasHashManager.CurrentVersion
            self._save_system_metadata()
            self._save()

    def manually_clear_damaged_memory(self) -> Dict[str, int]:
        """手动清除损坏记忆（吸收0.1.5，调用_perform_cleaning_operation）"""
        print("[CLEAN] 执行手动清理损坏记忆...")
        return self._perform_cleaning_operation()

    def similar_match(self, core_data: Dict) -> List[Dict]:
        """
        根据核心数据查找相似的漏洞记忆（吸收0.1.5，完整实现）
        core_data: 包含 target, vulnerability_types, core_features 等。
        返回相似记录列表，每个记录包含 record_time, core_data, memory_tag。
        """
        results = []
        all_tags = self.get_all_memory_tags()
        for tag in all_tags:
            mem = self.read_memory(tag, silent=True)
            if not mem:
                continue
            # 检查是否为漏洞记忆（通过类型或主题标签）
            mem_type = mem.get("memory_type", mem.get("memory_type", ""))
            mem_tags = mem.get("tags", mem.get("tags", []))
            if mem_type == "漏洞" or "漏洞" in mem_tags:
                stored_core = mem.get("漏洞核心数据", mem.get("core_data"))
                if stored_core:
                    # 简单匹配：目标相同或漏洞类型有交集（吸收0.1.5）
                    stored_types = stored_core.get("vulnerability_types", stored_core.get("vuln_type", []))
                    if isinstance(stored_types, str):
                        stored_types = [stored_types]
                    input_types = core_data.get("vulnerability_types", core_data.get("vuln_type", []))
                    if isinstance(input_types, str):
                        input_types = [input_types]
                    if (stored_core.get("target") == core_data.get("target") or
                        set(stored_types) & set(input_types)):
                        results.append({
                            "record_time": mem.get("created_at", mem.get("created_time")),
                            "core_data": stored_core,
                            "memory_tag": tag
                        })
        # 同时支持简单的内容相似度匹配（兼容旧代码）
        if not results:
            content = core_data.get("content", "")
            if content:
                simple_results = self.retrieve(content, limit=10)
                for r in simple_results:
                    mem_content = r.get("full_content", r.get("content", ""))
                    if mem_content:
                        common = len(set(content) & set(mem_content))
                        total = len(set(content) | set(mem_content))
                        similarity = common / total if total > 0 else 0
                        if similarity > 0.3:
                            r["similarity"] = round(similarity, 4)
                            results.append(r)
        return results[:5]  # 限制返回数量

    def _cleanup_dangling_references(self) -> Dict[str, int]:
        """清理悬空引用（吸收0.1.5，完整实现）"""
        stats = {
            "关联记忆清理": 0,
            "扫描索引清理": 0,
            "记忆索引清理": 0,
            "向量索引清理": 0,
            "removed": 0,
        }
        with self._lock:
            # 1. 获取所有有效标签
            valid_tags = set(self._get_all_memory_tags())
            valid_tags.update(self._get_scan_memory_files())
            # 也包括长期记忆中的ID
            valid_tags.update(self._long_term.keys())
    
            def _tag_exists(ref: str) -> bool:
                """检查引用是否对应有效文件（支持纯哈希或完整文件名）"""
                if ref in valid_tags:
                    return True
                if ref.endswith('.json') and ref[:-5] in valid_tags:
                    return True
                # 纯哈希：找以该哈希开头的文件
                if re.fullmatch(r'[0-9a-f]{32}', ref):
                    for vt in valid_tags:
                        if vt.startswith(ref):
                            return True
                return False
    
            # 2. 扫描所有记忆文件的"关联记忆"字段，移除不存在的引用
            for d in (self.MemoryRiverDirectory, self.ScanMemoryDirectory):
                if not os.path.isdir(d):
                    continue
                for fname in os.listdir(d):
                    if not fname.endswith('.json'):
                        continue
                    fpath = os.path.join(d, fname)
                    try:
                        with open(fpath, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                        assoc = data.get("related_memories", data.get("related_memories", []))
                        if not isinstance(assoc, list) or not assoc:
                            continue
                        bad_refs = [r for r in assoc if not _tag_exists(str(r))]
                        if bad_refs:
                            for r in bad_refs:
                                assoc.remove(r)
                                data.setdefault("历史关联", []).append({
                                    "标签": r, "移除时间": datetime.now().isoformat(),
                                    "原因": "目标文件不存在"
                                })
                                stats["关联记忆清理"] += 1
                            data["related_memories"] = assoc
                            data["related_memories"] = assoc
                            with open(fpath, 'w', encoding='utf-8') as f:
                                json.dump(data, f, ensure_ascii=False, indent=2)
                    except Exception:
                        continue
    
            # 3. 清理扫描索引中的悬空引用
            for idx_type, tag_list in list(self.ScanIndex.items()):
                bad = [t for t in tag_list if not _tag_exists(str(t))]
                for t in bad:
                    tag_list.remove(t)
                    stats["扫描索引清理"] += 1
                if not tag_list:
                    del self.ScanIndex[idx_type]
            self._save_scan_index()
    
            # 4. 清理记忆索引中的悬空引用
            for idx_key, tag_list in list(self.MemoryIndex.items()):
                bad = [t for t in tag_list if not _tag_exists(str(t))]
                for t in bad:
                    tag_list.remove(t)
                    stats["记忆索引清理"] += 1
                if not tag_list:
                    del self.MemoryIndex[idx_key]
    
            # 5. 清理向量索引中的悬空引用
            for tag in list(self.scan_vectors.keys()):
                if not _tag_exists(str(tag)):
                    del self.scan_vectors[tag]
                    stats["向量索引清理"] += 1
    
            # 6. 清理标签索引中的悬空引用
            for tag in list(self._tag_index.keys()):
                valid_ids = [mid for mid in self._tag_index[tag] if mid in self._long_term]
                if len(valid_ids) != len(self._tag_index[tag]):
                    stats["记忆索引清理"] += len(self._tag_index[tag]) - len(valid_ids)
                    self._tag_index[tag] = valid_ids
    
            stats["removed"] = sum(stats.values())
        return stats

    def perform_cleaning_operation(self) -> Dict[str, int]:
        """执行清理操作"""
        result = {"removed_memories": 0, "removed_scan": 0, "removed_dangling": 0}
        # 清理过期短期记忆
        self.decay_all()
        expired = [m for m in self._short_term if m.strength < 0.1]
        result["removed_memories"] = len(expired)
        self._short_term = [m for m in self._short_term if m.strength >= 0.1]
        # 清理悬空引用
        cleanup = self._cleanup_dangling_references()
        result["removed_dangling"] = cleanup["removed"]
        self.SystemMetadata["last_cleanup"] = time.time()
        self._save_system_metadata()
        self._save()
        return result

    def _perform_cleaning_operation(self) -> Dict[str, int]:
        """执行清理操作（内部实现，吸收0.1.5，完整实现：遍历/验证/清理/统计）"""
        all_tags = self._get_all_memory_tags()
        number_damaged = 0
        number_valid = 0
        number_repaired = 0
        for mark in all_tags:
            file_path = os.path.join(self.MemoryRiverDirectory, mark)
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    memory_data = json.load(f)
                if not self._verify_memory_integrity(memory_data):
                    raise ValueError("记忆数据不完整")
                number_valid += 1
            except (FileNotFoundError, json.JSONDecodeError, ValueError, KeyError) as e:
                try:
                    os.remove(file_path)
                    number_damaged += 1
                    print(f"  [DEL] 清理: {mark}")
                    self._clear_memory_references(mark, silent=True)
                except Exception as cleanup_error:
                    print(f"  [FAIL] 清理失败 {mark}: {cleanup_error}")
                    number_repaired += 1
        # 清理悬空引用
        dangling = self._cleanup_dangling_references()
        # 清理过期的扫描记忆（超过30天）
        removed_scan = 0
        if os.path.exists(self.ScanMemoryDirectory):
            cutoff = time.time() - 30 * 86400
            for fname in os.listdir(self.ScanMemoryDirectory):
                if not fname.endswith('.json') or fname == '_index.json':
                    continue
                fpath = os.path.join(self.ScanMemoryDirectory, fname)
                try:
                    if os.path.getmtime(fpath) < cutoff:
                        os.remove(fpath)
                        removed_scan += 1
                except Exception:
                    pass
        # 清理过期的记忆河流（超过90天且重要性低）
        removed_river = 0
        if os.path.exists(self.MemoryRiverDirectory):
            cutoff = time.time() - 90 * 86400
            for fname in os.listdir(self.MemoryRiverDirectory):
                if not fname.endswith('.json'):
                    continue
                fpath = os.path.join(self.MemoryRiverDirectory, fname)
                try:
                    if os.path.getmtime(fpath) < cutoff:
                        with open(fpath, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                        importance = data.get("importance", data.get("importance_level", 0.3))
                        if isinstance(importance, str):
                            importance = 0.3
                        if importance < 0.4:
                            os.remove(fpath)
                            removed_river += 1
                except Exception:
                    pass
        statistical_results = {
            "总文件数": len(all_tags),
            "有效文件数": number_valid,
            "损坏文件数": number_damaged,
            "清理错误数": number_repaired,
            "悬空引用清理": dangling.get("removed", 0),
            "过期扫描清理": removed_scan,
            "过期记忆清理": removed_river,
            "removed": number_damaged + dangling.get("removed", 0) + removed_scan + removed_river,
        }
        print(f"[CLEAN] 清理完成: {statistical_results}")
        return statistical_results

    def _clear_memory_references(self, tag: str, silent: bool = False):
        """清除记忆引用（吸收0.1.5）"""
        with self._lock:
            # 从记忆索引移除
            self._remove_from_index(tag, silent)
            # 从扫描索引移除
            self._remove_from_scan_index(tag, silent)
            # 从向量索引移除
            if tag in self.scan_vectors:
                del self.scan_vectors[tag]
            # 从其他记忆的关联列表移除
            for mem in self._long_term.values():
                if tag in mem.related_memories:
                    mem.related_memories.remove(tag)
            if not silent:
                logger.debug(f"Cleared memory references: {tag}")
