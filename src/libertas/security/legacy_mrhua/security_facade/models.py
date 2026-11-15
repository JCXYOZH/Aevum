"""
security/security_facade.py - 统一安全API入口与漏洞优先级排序

核心能力：
- VulnerabilityPrioritizer: 漏洞优先级排序器（CVSS+可利用性+影响面+资产价值）
- SecurityFacade: 统一安全API入口（一键扫描/统一结果格式/多模块协调）
"""
import os
import re
import sys
import json
import time
import uuid
import threading
from typing import Any, Dict, List, Optional, Tuple, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed


# ================================================================
# 漏洞优先级排序器
# ================================================================

class PriorityLevel(Enum):
    """优先级级别"""
    CRITICAL = "critical"      # 立即修复
    HIGH = "high"              # 24小时内修复
    MEDIUM = "medium"          # 本周内修复
    LOW = "low"                # 下个迭代修复
    INFO = "info"              # 记录即可

@dataclass
class PrioritizedVulnerability:
    """排序后的漏洞"""
    vuln_id: str = ""
    original_vuln: Dict = field(default_factory=dict)
    priority_score: float = 0.0
    priority_level: str = "medium"
    cvss_score: float = 0.0
    exploitability: float = 0.0
    impact: float = 0.0
    asset_value: float = 0.0
    exposure: float = 0.0
    fix_effort: str = "medium"
    recommended_action: str = ""
    factors: Dict = field(default_factory=dict)
    ranked_at: float = 0.0

    def __post_init__(self):
        if not self.vuln_id:
            self.vuln_id = f"pv_{uuid.uuid4().hex[:12]}"
        if not self.ranked_at:
            self.ranked_at = time.time()

    def to_dict(self) -> Dict:
        return {
            "vuln_id": self.vuln_id,
            "priority_score": round(self.priority_score, 2),
            "priority_level": self.priority_level,
            "cvss_score": self.cvss_score,
            "exploitability": round(self.exploitability, 2),
            "impact": round(self.impact, 2),
            "asset_value": round(self.asset_value, 2),
            "exposure": round(self.exposure, 2),
            "fix_effort": self.fix_effort,
            "recommended_action": self.recommended_action,
            "factors": self.factors,
            "original": self.original_vuln,
        }
