"""活的记忆系统职责：export。"""

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


class TrainingDataExporter:
    """训练数据导出器 - 将记忆导出为各种模型训练格式（JSONL/Alpaca/ShareGPT）"""

    def __init__(self, memory: "LivingMemory"):
        self.memory = memory

    def export_to_jsonl(self, output_path: str, memory_type: str = "",
                         min_activation: float = 0.0) -> Dict[str, Any]:
        """导出为JSONL格式（每行一条记忆）"""
        memories = self._get_filtered_memories(memory_type, min_activation)
        count = 0
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                for mem in memories:
                    record = {
                        "id": mem.get("memory_id", ""),
                        "content": mem.get("content", ""),
                        "type": mem.get("memory_type", ""),
                        "tags": mem.get("tags", []),
                        "created_at": mem.get("created_at", 0),
                    }
                    f.write(json.dumps(record, ensure_ascii=False) + "\n")
                    count += 1
            return {"success": True, "exported_count": count, "output_path": output_path}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def export_to_alpaca(self, output_path: str, instruction_template: str = "") -> Dict[str, Any]:
        """导出为Alpaca格式（instruction/input/output）"""
        memories = self._get_filtered_memories()
        dataset = []
        for mem in memories:
            content = mem.get("content", "")
            tags = mem.get("tags", [])
            # 生成instruction
            if instruction_template:
                instruction = instruction_template
            elif tags:
                instruction = f"关于{tags[0]}的知识"
            else:
                instruction = "回答以下问题"
            dataset.append({
                "instruction": instruction,
                "input": "",
                "output": content,
            })
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(dataset, f, ensure_ascii=False, indent=2)
            return {"success": True, "exported_count": len(dataset), "output_path": output_path, "format": "alpaca"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def export_to_sharegpt(self, output_path: str) -> Dict[str, Any]:
        """导出为ShareGPT格式（conversations数组）"""
        memories = self._get_filtered_memories()
        dataset = []
        for i, mem in enumerate(memories):
            content = mem.get("content", "")
            dataset.append({
                "id": f"conv_{i}",
                "conversations": [
                    {"from": "human", "value": f"告诉我关于这个的知识: {content[:50]}..."},
                    {"from": "gpt", "value": content},
                ],
            })
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(dataset, f, ensure_ascii=False, indent=2)
            return {"success": True, "exported_count": len(dataset), "output_path": output_path, "format": "sharegpt"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def export_conversation_pairs(self, output_path: str) -> Dict[str, Any]:
        """导出对话对格式（从对话记忆中提取问答对）"""
        memories = self._get_filtered_memories(memory_type="conversation")
        pairs = []
        for mem in memories:
            content = mem.get("content", "")
            # 简单分割：假设对话记忆包含问答
            if "?" in content or "？" in content:
                parts = content.split("?", 1) if "?" in content else content.split("？", 1)
                if len(parts) == 2:
                    pairs.append({
                        "question": parts[0].strip() + "?",
                        "answer": parts[1].strip(),
                    })
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(pairs, f, ensure_ascii=False, indent=2)
            return {"success": True, "exported_pairs": len(pairs), "output_path": output_path}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_filtered_memories(self, memory_type: str = "",
                                min_activation: float = 0.0) -> List[Dict]:
        """获取过滤后的记忆列表"""
        all_memories = []
        if hasattr(self.memory, 'memories'):
            all_memories = list(self.memory.memories.values()) if isinstance(self.memory.memories, dict) else self.memory.memories
        filtered = []
        for mem in all_memories:
            mtype = mem.get("memory_type", "") if isinstance(mem, dict) else getattr(mem, "memory_type", "")
            if memory_type and mtype != memory_type:
                continue
            activation = mem.get("current_activation", 1.0) if isinstance(mem, dict) else getattr(mem, "current_activation", 1.0)
            if activation < min_activation:
                continue
            filtered.append(mem)
        return filtered

    def get_export_stats(self) -> Dict[str, Any]:
        """获取可导出数据统计"""
        all_memories = self._get_filtered_memories()
        by_type = {}
        for mem in all_memories:
            t = mem.get("memory_type", "unknown") if isinstance(mem, dict) else getattr(mem, "memory_type", "unknown")
            by_type[t] = by_type.get(t, 0) + 1
        return {
            "total_memories": len(all_memories),
            "by_type": by_type,
            "supported_formats": ["jsonl", "alpaca", "sharegpt", "conversation_pairs"],
        }
