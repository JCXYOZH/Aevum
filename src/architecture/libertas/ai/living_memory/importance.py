"""活的记忆系统职责：importance。"""

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
from .core import LivingMemory


class MemoryImportanceAssessor:
    """记忆重要性自动评估器 - 基于多维度评分自动评估记忆重要性"""

    def __init__(self, memory: "LivingMemory"):
        self.memory = memory
        self.weights = {
            "activation_frequency": 0.30,
            "recency": 0.25,
            "content_length": 0.10,
            "tag_count": 0.10,
            "association_count": 0.15,
            "explicit_importance": 0.10,
        }

    def assess(self, memory_id: str) -> Dict[str, Any]:
        """评估单条记忆的重要性"""
        mem = self.memory.get(memory_id) if hasattr(self.memory, 'get') else None
        if not mem:
            return {"success": False, "error": "记忆不存在"}
        content = mem.get("content", "") if isinstance(mem, dict) else getattr(mem, "content", "")
        activation_count = mem.get("activation_count", 0) if isinstance(mem, dict) else getattr(mem, "activation_count", 0)
        last_activated = mem.get("last_activated", 0) if isinstance(mem, dict) else getattr(mem, "last_activated", 0)
        tags = mem.get("tags", []) if isinstance(mem, dict) else getattr(mem, "tags", [])
        metadata = mem.get("metadata", {}) if isinstance(mem, dict) else getattr(mem, "metadata", {})
        related = mem.get("related_memories", []) if isinstance(mem, dict) else getattr(mem, "related_memories", [])
        # 各维度评分（0-1）
        activation_score = min(activation_count / 20.0, 1.0)
        recency_days = (time.time() - last_activated) / 86400 if last_activated else 365
        recency_score = max(0, 1.0 - recency_days / 30.0)
        length_score = min(len(content) / 500.0, 1.0)
        tag_score = min(len(tags) / 5.0, 1.0)
        association_score = min(len(related) / 10.0, 1.0)
        explicit_score = metadata.get("importance", 0.5) if isinstance(metadata, dict) else 0.5
        # 加权总分
        total_score = (
            activation_score * self.weights["activation_frequency"] +
            recency_score * self.weights["recency"] +
            length_score * self.weights["content_length"] +
            tag_score * self.weights["tag_count"] +
            association_score * self.weights["association_count"] +
            explicit_score * self.weights["explicit_importance"]
        )
        level = "critical" if total_score >= 0.8 else ("important" if total_score >= 0.6 else ("normal" if total_score >= 0.3 else "low"))
        return {
            "success": True,
            "memory_id": memory_id,
            "importance_score": total_score,
            "importance_level": level,
            "dimension_scores": {
                "activation_frequency": activation_score,
                "recency": recency_score,
                "content_length": length_score,
                "tag_count": tag_score,
                "association_count": association_score,
                "explicit_importance": explicit_score,
            },
            "recommendation": f"该记忆重要性等级为 {level}，建议{'长期保留' if level in ('critical', 'important') else '定期复习' if level == 'normal' else '可考虑遗忘'}",
        }

    def assess_all(self) -> List[Dict[str, Any]]:
        """评估所有记忆的重要性"""
        results = []
        if hasattr(self.memory, 'memories'):
            all_memories = self.memory.memories.values() if isinstance(self.memory.memories, dict) else self.memory.memories
            for mem in all_memories:
                mid = mem.get("memory_id", "") if isinstance(mem, dict) else getattr(mem, "memory_id", "")
                if mid:
                    result = self.assess(mid)
                    if result.get("success"):
                        results.append(result)
        results.sort(key=lambda x: -x["importance_score"])
        return results

    def get_low_importance_memories(self, threshold: float = 0.3) -> List[Dict[str, Any]]:
        """获取低重要性记忆（可遗忘候选）"""
        all_assessed = self.assess_all()
        return [r for r in all_assessed if r["importance_score"] < threshold]

    def auto_forget_low_importance(self, threshold: float = 0.15,
                                    max_count: int = 10) -> Dict[str, Any]:
        """自动遗忘低重要性记忆"""
        candidates = self.get_low_importance_memories(threshold)
        candidates = candidates[:max_count]
        forgotten = []
        for candidate in candidates:
            mid = candidate["memory_id"]
            if hasattr(self.memory, 'forget'):
                try:
                    self.memory.forget(mid, permanent=False)
                    forgotten.append(mid)
                except Exception:
                    pass
        return {
            "success": True,
            "forgotten_count": len(forgotten),
            "forgotten_ids": forgotten,
            "candidates_evaluated": len(candidates),
        }

class BatchMemoryIO:
    """批量记忆导入导出 - 支持JSON/CSV格式的批量操作"""

    def __init__(self, memory: "LivingMemory"):
        self.memory = memory

    def export_to_json(self, output_path: str, memory_type: str = "",
                       tags: List[str] = None) -> Dict[str, Any]:
        """导出记忆到JSON文件"""
        all_memories = []
        if hasattr(self.memory, 'memories'):
            all_memories = list(self.memory.memories.values()) if isinstance(self.memory.memories, dict) else self.memory.memories
        # 过滤
        filtered = []
        for mem in all_memories:
            mtype = mem.get("memory_type", "") if isinstance(mem, dict) else getattr(mem, "memory_type", "")
            mtags = mem.get("tags", []) if isinstance(mem, dict) else getattr(mem, "tags", [])
            if memory_type and mtype != memory_type:
                continue
            if tags and not any(t in mtags for t in tags):
                continue
            filtered.append(mem)
        # 序列化
        export_data = {
            "export_time": time.time(),
            "version": "1.0",
            "total_count": len(filtered),
            "filter": {"memory_type": memory_type, "tags": tags or []},
            "memories": filtered,
        }
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(export_data, f, ensure_ascii=False, indent=2, default=str)
            return {"success": True, "exported_count": len(filtered), "output_path": output_path}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def import_from_json(self, input_path: str, skip_duplicates: bool = True) -> Dict[str, Any]:
        """从JSON文件导入记忆"""
        try:
            with open(input_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            return {"success": False, "error": f"读取文件失败: {e}"}
        memories = data.get("memories", [])
        imported = 0
        skipped = 0
        errors = 0
        for mem_data in memories:
            try:
                content = mem_data.get("content", "")
                if not content:
                    errors += 1
                    continue
                mtype = mem_data.get("memory_type", "general")
                tags = mem_data.get("tags", [])
                metadata = mem_data.get("metadata", {})
                if hasattr(self.memory, 'store'):
                    self.memory.store(content=content, memory_type=mtype, tags=tags, metadata=metadata)
                    imported += 1
            except Exception:
                errors += 1
        return {
            "success": True,
            "imported": imported,
            "skipped": skipped,
            "errors": errors,
            "total_in_file": len(memories),
        }

    def export_to_csv(self, output_path: str) -> Dict[str, Any]:
        """导出记忆到CSV文件"""
        import csv
        all_memories = []
        if hasattr(self.memory, 'memories'):
            all_memories = list(self.memory.memories.values()) if isinstance(self.memory.memories, dict) else self.memory.memories
        try:
            with open(output_path, 'w', encoding='utf-8-sig', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(["memory_id", "content", "memory_type", "tags", "created_at", "activation_count"])
                for mem in all_memories:
                    mid = mem.get("memory_id", "") if isinstance(mem, dict) else getattr(mem, "memory_id", "")
                    content = mem.get("content", "") if isinstance(mem, dict) else getattr(mem, "content", "")
                    mtype = mem.get("memory_type", "") if isinstance(mem, dict) else getattr(mem, "memory_type", "")
                    tags = ",".join(mem.get("tags", [])) if isinstance(mem, dict) else ",".join(getattr(mem, "tags", []))
                    created = mem.get("created_at", "") if isinstance(mem, dict) else getattr(mem, "created_at", "")
                    act = mem.get("activation_count", 0) if isinstance(mem, dict) else getattr(mem, "activation_count", 0)
                    writer.writerow([mid, content, mtype, tags, created, act])
            return {"success": True, "exported_count": len(all_memories), "output_path": output_path}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def merge_memories(self, source_ids: List[str], new_content: str = "",
                        new_tags: List[str] = None) -> Dict[str, Any]:
        """合并多条记忆为一条"""
        if len(source_ids) < 2:
            return {"success": False, "error": "至少需要2条记忆才能合并"}
        contents = []
        all_tags = set()
        for mid in source_ids:
            mem = self.memory.get(mid) if hasattr(self.memory, 'get') else None
            if mem:
                content = mem.get("content", "") if isinstance(mem, dict) else getattr(mem, "content", "")
                contents.append(content)
                tags = mem.get("tags", []) if isinstance(mem, dict) else getattr(mem, "tags", [])
                all_tags.update(tags)
        merged_content = new_content or "\n---\n".join(contents)
        merged_tags = new_tags or list(all_tags)
        if hasattr(self.memory, 'store'):
            new_mem = self.memory.store(
                content=merged_content,
                memory_type="merged",
                tags=merged_tags,
                metadata={"merged_from": source_ids, "merged_at": time.time()}
            )
            return {"success": True, "merged_count": len(source_ids), "new_memory": new_mem}
        return {"success": False, "error": "记忆库不支持store方法"}
