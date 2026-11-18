"""职责模块：models。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
from enum import Enum
from dataclasses import dataclass, field
from collections import defaultdict
import time
import uuid

class CorrectionSeverity(Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"

class CorrectionCategory(Enum):
    BUG = "bug"
    SECURITY = "security"
    PERFORMANCE = "performance"
    STYLE = "style"
    BEST_PRACTICE = "best_practice"
    COMPATIBILITY = "compatibility"

@dataclass
class CorrectionIssue:
    """单个纠正问题"""
    issue_id: str = ""
    file_path: str = ""
    language: str = ""
    line_number: int = 0
    column: int = 0
    severity: str = "medium"
    category: str = "bug"
    rule_id: str = ""
    title: str = ""
    description: str = ""
    code_snippet: str = ""
    suggested_fix: str = ""
    auto_fixable: bool = False
    fixed: bool = False
    confidence: float = 0.8
    timestamp: float = 0.0

    def __post_init__(self):
        if not self.issue_id:
            self.issue_id = f"ci_{uuid.uuid4().hex[:12]}"
        if not self.timestamp:
            self.timestamp = time.time()

    def to_dict(self) -> Dict:
        return {
            "issue_id": self.issue_id,
            "file_path": self.file_path,
            "language": self.language,
            "line_number": self.line_number,
            "column": self.column,
            "severity": self.severity,
            "category": self.category,
            "rule_id": self.rule_id,
            "title": self.title,
            "description": self.description,
            "code_snippet": self.code_snippet,
            "suggested_fix": self.suggested_fix,
            "auto_fixable": self.auto_fixable,
            "fixed": self.fixed,
            "confidence": self.confidence,
        }

@dataclass
class CorrectionReport:
    """纠正报告"""
    report_id: str = ""
    target_path: str = ""
    files_scanned: int = 0
    total_issues: int = 0
    issues: List[CorrectionIssue] = field(default_factory=list)
    auto_fixed: int = 0
    fix_failed: int = 0
    duration: float = 0.0
    summary: Dict = field(default_factory=dict)
    generated_at: float = 0.0

    def __post_init__(self):
        if not self.report_id:
            self.report_id = f"cr_{uuid.uuid4().hex[:12]}"
        if not self.generated_at:
            self.generated_at = time.time()

    def to_dict(self) -> Dict:
        by_severity = defaultdict(int)
        by_category = defaultdict(int)
        by_language = defaultdict(int)
        for issue in self.issues:
            by_severity[issue.severity] += 1
            by_category[issue.category] += 1
            by_language[issue.language] += 1
        return {
            "report_id": self.report_id,
            "target_path": self.target_path,
            "files_scanned": self.files_scanned,
            "total_issues": self.total_issues,
            "auto_fixed": self.auto_fixed,
            "fix_failed": self.fix_failed,
            "duration": round(self.duration, 2),
            "by_severity": dict(by_severity),
            "by_category": dict(by_category),
            "by_language": dict(by_language),
            "issues": [i.to_dict() for i in self.issues],
        }
