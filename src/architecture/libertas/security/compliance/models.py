"""
合规与服从控制系统（优化版）

融合两个版本的功能：
1. 规则守护系统（内容安全检查 + 违规记录）
2. 服从控制引擎（AI拒绝检测 + 强制服从）

职责：
- 规则管理（添加/删除/启用/禁用规则）
- 文本检查（模式匹配/阈值/速率）
- 违规记录和处理
- AI拒绝检测（中英文拒绝模式 + 推脱回避模式）
- 强制执行指令生成（3级递增）
- 系统提示词增强（前缀/后缀/强制模式）
- 输出后处理（清理拒绝前缀）
- 合规报告生成
- SQLite 持久化（compliance.db，rules + violations 两张表）
"""
import os
import re
import time
import json
import secrets
import sqlite3
import threading
from typing import Dict, List, Any, Optional, Tuple, Callable
from enum import Enum
from collections import defaultdict


class GuardianRule:
    """守护规则"""

    def __init__(self, name: str = "", description: str = "",
                 category: str = "general", pattern: str = "",
                 level: str = "warning", threshold: float = 0.0,
                 cooldown_seconds: int = 60, enabled: bool = True,
                 rule_id: str = ""):
        self.rule_id = rule_id or secrets.token_hex(8)
        self.name = name
        self.description = description
        self.category = category
        self.pattern = pattern
        self.level = level
        self.threshold = threshold
        self.cooldown_seconds = cooldown_seconds
        self.enabled = enabled
        self._last_triggered = 0.0
        self._compiled = None
        if pattern:
            try:
                self._compiled = re.compile(pattern, re.IGNORECASE)
            except re.error:
                self._compiled = None

    def check_pattern(self, text: str) -> bool:
        """检查文本是否匹配规则模式"""
        if not self.enabled or not self._compiled or not text:
            return False
        return bool(self._compiled.search(text))

    def check_threshold(self, value: float) -> bool:
        """检查值是否超过阈值"""
        if not self.enabled or self.threshold <= 0:
            return False
        return value >= self.threshold

    def can_trigger(self) -> bool:
        """检查是否可以触发（冷却时间）"""
        if self.cooldown_seconds <= 0:
            return True
        return (time.time() - self._last_triggered) >= self.cooldown_seconds

    def trigger(self):
        """触发规则，记录触发时间"""
        self._last_triggered = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "pattern": self.pattern,
            "level": self.level,
            "threshold": self.threshold,
            "cooldown_seconds": self.cooldown_seconds,
            "enabled": self.enabled,
        }

class Violation:
    """违规记录"""

    def __init__(self, rule_name: str = "", level: str = "warning",
                 content: str = "", context: str = "",
                 violation_id: str = "", resolved: bool = False,
                 resolution: str = "", created_at: float = 0.0):
        self.violation_id = violation_id or secrets.token_hex(8)
        self.rule_name = rule_name
        self.level = level
        self.content = content
        self.context = context
        self.resolved = resolved
        self.resolution = resolution
        self.created_at = created_at or time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "violation_id": self.violation_id,
            "rule_name": self.rule_name,
            "level": self.level,
            "content": self.content,
            "context": self.context,
            "resolved": self.resolved,
            "resolution": self.resolution,
            "created_at": self.created_at,
        }
