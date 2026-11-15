"""模型验证职责：models。"""

from __future__ import annotations

import json
import math
import os
import re
import struct
import sys
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple


class ValidationSeverity(Enum):
    CRITICAL = "critical"   # 模型无法使用
    HIGH = "high"           # 严重影响渲染/动画
    MEDIUM = "medium"       # 部分功能异常
    LOW = "low"             # 轻微问题
    INFO = "info"

class ValidationCategory(Enum):
    SKELETON = "skeleton"           # 骨骼结构
    SKIN_WEIGHT = "skin_weight"     # 蒙皮权重
    IK = "ik"                       # IK/FK
    MATERIAL = "material"           # 材质
    TEXTURE = "texture"             # 纹理
    MORPH = "morph"                 # 形态键
    PHYSICS = "physics"             # 物理
    MOTION = "motion"               # 动作数据
    RENDERING = "rendering"         # 渲染
    CALCULATION = "calculation"     # 计算错误
    FORMAT = "format"               # 文件格式
    METADATA = "metadata"

@dataclass
class ValidationIssue:
    """验证问题"""
    issue_id: str = ""
    category: str = ""
    severity: str = "medium"
    title: str = ""
    description: str = ""
    location: str = ""  # 骨骼名/材质名/顶点索引等
    expected: str = ""
    actual: str = ""
    auto_fixable: bool = False
    fix_suggestion: str = ""
    confidence: float = 0.8
    timestamp: float = 0.0

    def __post_init__(self):
        if not self.issue_id:
            self.issue_id = f"vi_{uuid.uuid4().hex[:12]}"
        if not self.timestamp:
            self.timestamp = time.time()

    def to_dict(self) -> Dict:
        return {
            "issue_id": self.issue_id,
            "category": self.category,
            "severity": self.severity,
            "title": self.title,
            "description": self.description,
            "location": self.location,
            "expected": self.expected,
            "actual": self.actual,
            "auto_fixable": self.auto_fixable,
            "fix_suggestion": self.fix_suggestion,
            "confidence": self.confidence,
        }

@dataclass
class ValidationReport:
    """验证报告"""
    report_id: str = ""
    model_path: str = ""
    model_format: str = ""
    model_name: str = ""
    total_checks: int = 0
    issues: List[ValidationIssue] = field(default_factory=list)
    model_stats: Dict = field(default_factory=dict)
    duration: float = 0.0
    generated_at: float = 0.0

    def __post_init__(self):
        if not self.report_id:
            self.report_id = f"vr_{uuid.uuid4().hex[:12]}"
        if not self.generated_at:
            self.generated_at = time.time()

    def to_dict(self) -> Dict:
        by_severity = defaultdict(int)
        by_category = defaultdict(int)
        for issue in self.issues:
            by_severity[issue.severity] += 1
            by_category[issue.category] += 1
        return {
            "report_id": self.report_id,
            "model_path": self.model_path,
            "model_format": self.model_format,
            "model_name": self.model_name,
            "total_checks": self.total_checks,
            "total_issues": len(self.issues),
            "by_severity": dict(by_severity),
            "by_category": dict(by_category),
            "issues": [i.to_dict() for i in self.issues],
            "model_stats": self.model_stats,
            "duration": round(self.duration, 2),
        }

    def is_usable(self) -> bool:
        """模型是否基本可用（无critical问题）"""
        return not any(i.severity == "critical" for i in self.issues)
