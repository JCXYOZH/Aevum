"""能力增强职责：models。"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
import time
import uuid
from collections import OrderedDict, defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from libertas.foundation.byte_stream import safe_decode


class MemoryImportance(Enum):
    """记忆重要性等级"""
    CRITICAL = "critical"      # 关键（永不遗忘）
    HIGH = "high"              # 高（长期保留）
    MEDIUM = "medium"          # 中（正常衰减）
    LOW = "low"                # 低（快速衰减）
    TRANSIENT = "transient"

@dataclass
class EnhancedMemory:
    """增强记忆条目"""
    memory_id: str = ""
    content: str = ""
    content_hash: str = ""
    importance: str = "medium"
    access_count: int = 0
    last_accessed: float = 0.0
    created_at: float = 0.0
    decay_rate: float = 0.1  # 每日衰减率
    current_strength: float = 1.0  # 当前记忆强度（0-1）
    associations: List[str] = field(default_factory=list)  # 关联记忆ID
    tags: List[str] = field(default_factory=list)
    source: str = ""  # 来源（user/agent/tool/code）
    compressed: bool = False
    original_length: int = 0

    def __post_init__(self):
        if not self.memory_id:
            self.memory_id = f"mem_{uuid.uuid4().hex[:12]}"
        if not self.created_at:
            self.created_at = time.time()
        if not self.content_hash:
            self.content_hash = hashlib.md5(self.content.encode()).hexdigest()
        self.original_length = len(self.content)

    def calculate_strength(self, current_time: float = None) -> float:
        """根据遗忘曲线计算当前记忆强度"""
        if current_time is None:
            current_time = time.time()
        if self.importance == MemoryImportance.CRITICAL.value:
            return 1.0
        days_elapsed = (current_time - max(self.last_accessed, self.created_at)) / 86400
        # 艾宾浩斯遗忘曲线：R = e^(-t/S)
        stability = self._get_stability()
        strength = math.exp(-days_elapsed / stability)
        # 访问次数增强
        strength = min(1.0, strength + self.access_count * 0.02)
        self.current_strength = strength
        return strength

    def _get_stability(self) -> float:
        """获取记忆稳定性（天数）"""
        stability_map = {
            "critical": 9999,
            "high": 30,
            "medium": 7,
            "low": 2,
            "transient": 0.5,
        }
        return stability_map.get(self.importance, 7)

    def should_forget(self, threshold: float = 0.1) -> bool:
        """判断是否应该遗忘"""
        if self.importance == MemoryImportance.CRITICAL.value:
            return False
        return self.calculate_strength() < threshold

    def to_dict(self) -> Dict:
        return {
            "memory_id": self.memory_id,
            "content_preview": self.content[:200],
            "importance": self.importance,
            "access_count": self.access_count,
            "current_strength": round(self.current_strength, 4),
            "associations": len(self.associations),
            "tags": self.tags,
            "source": self.source,
            "compressed": self.compressed,
            "original_length": self.original_length,
        }

@dataclass
class EnhancedTool:
    """增强工具条目"""
    tool_id: str = ""
    name: str = ""
    description: str = ""
    category: str = ""
    command: str = ""
    version: str = ""
    installed: bool = False
    install_command: str = ""
    dependencies: List[str] = field(default_factory=list)
    health_status: str = "unknown"  # healthy/unhealthy/unknown
    last_health_check: float = 0.0
    success_rate: float = 0.0
    call_count: int = 0
    avg_duration: float = 0.0
    output_schema: Dict = field(default_factory=dict)
    tags: List[str] = field(default_factory=list)

    def __post_init__(self):
        if not self.tool_id:
            self.tool_id = f"tool_{uuid.uuid4().hex[:12]}"

    def to_dict(self) -> Dict:
        return {
            "tool_id": self.tool_id,
            "name": self.name,
            "category": self.category,
            "installed": self.installed,
            "health_status": self.health_status,
            "success_rate": round(self.success_rate, 2),
            "call_count": self.call_count,
            "avg_duration": round(self.avg_duration, 2),
            "tags": self.tags,
        }

@dataclass
class CodeImpact:
    """代码变更影响分析"""
    file_path: str = ""
    change_type: str = ""  # added/modified/deleted
    lines_changed: int = 0
    affected_functions: List[str] = field(default_factory=list)
    affected_tests: List[str] = field(default_factory=list)
    risk_level: str = "medium"
    dependencies_affected: List[str] = field(default_factory=list)
    suggestion: str = ""
