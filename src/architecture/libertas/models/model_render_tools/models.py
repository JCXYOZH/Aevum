"""模型渲染工具职责：models。"""

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
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class RenderComparisonResult:
    """渲染对比结果"""
    comparison_id: str = ""
    reference_image: str = ""
    test_image: str = ""
    pixel_difference: float = 0.0
    ssim_score: float = 0.0
    histogram_similarity: float = 0.0
    edge_similarity: float = 0.0
    overall_score: float = 0.0
    anomaly_regions: List[Dict] = field(default_factory=list)
    difference_map: List[List[int]] = field(default_factory=list)
    issues: List[Dict] = field(default_factory=list)
    passed: bool = False
    threshold: float = 0.9
    duration: float = 0.0

    def __post_init__(self):
        if not self.comparison_id:
            self.comparison_id = f"rc_{uuid.uuid4().hex[:12]}"

    def to_dict(self) -> Dict:
        return {
            "comparison_id": self.comparison_id,
            "reference_image": self.reference_image,
            "test_image": self.test_image,
            "pixel_difference": round(self.pixel_difference, 4),
            "ssim_score": round(self.ssim_score, 4),
            "histogram_similarity": round(self.histogram_similarity, 4),
            "edge_similarity": round(self.edge_similarity, 4),
            "overall_score": round(self.overall_score, 4),
            "anomaly_regions": self.anomaly_regions,
            "issues": self.issues,
            "passed": self.passed,
            "threshold": self.threshold,
            "duration": round(self.duration, 3),
        }

@dataclass
class MotionParamIssue:
    """动作参数问题"""
    issue_id: str = ""
    category: str = ""
    severity: str = "medium"
    title: str = ""
    description: str = ""
    parameter: str = ""
    expected: str = ""
    actual: str = ""
    frame: int = 0
    bone: str = ""
    fix_suggestion: str = ""

    def __post_init__(self):
        if not self.issue_id:
            self.issue_id = f"mpi_{uuid.uuid4().hex[:12]}"

    def to_dict(self) -> Dict:
        return {
            "issue_id": self.issue_id,
            "category": self.category,
            "severity": self.severity,
            "title": self.title,
            "description": self.description,
            "parameter": self.parameter,
            "expected": self.expected,
            "actual": self.actual,
            "frame": self.frame,
            "bone": self.bone,
            "fix_suggestion": self.fix_suggestion,
        }
