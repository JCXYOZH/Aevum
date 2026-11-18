"""
身份认证与任务贡献系统

融合两个版本的优点：
- 使用SQLite持久化（吸收0.1.5，7张表）
- 保留身份档案（等级/经验/徽章/技能/连续天数）
- 吸收主账户/子用户系统、任务系统、联系人系统
- 吸收密码哈希（PBKDF2 + salt）、验证码验证
- 唯一主账户（每人一份），可创建子用户但仅主用户可使用工具
- 任务系统：发布任务需支付能力价值，完成任务获得贡献分
"""
import os
import json
import time
import uuid
import hmac
import hashlib
import secrets
import sqlite3
import threading
from enum import Enum
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta
from libertas.foundation.config import get_data_dir

from .crypto import generate_identity_id


# ============================================================


class ContributionType(Enum):
    TASK = "task"
    BUG_REPORT = "bug_report"
    FEATURE_REQUEST = "feature_request"
    DOCUMENTATION = "documentation"
    CODE_REVIEW = "code_review"
    COMMUNITY = "community"
    OTHER = "other"

class IdentityProfile:
    """身份档案（等级/经验/徽章/技能/连续天数）"""

    def __init__(self, username: str = "", display_name: str = "",
                 identity_id: str = "", level: int = 1, exp: int = 0,
                 contribution_score: int = 0, badges: Optional[List[str]] = None,
                 skills: Optional[Dict[str, int]] = None,
                 streak: int = 0, last_active: float = 0.0,
                 created_at: float = 0.0, settings: Optional[Dict[str, Any]] = None):
        self.username = username
        self.display_name = display_name or username
        self.identity_id = identity_id or generate_identity_id()
        self.level = level
        self.exp = exp
        self.contribution_score = contribution_score
        self.badges = badges or []
        self.skills = skills or {}
        self.streak = streak
        self.last_active = last_active or time.time()
        self.created_at = created_at or time.time()
        self.settings = settings or {}

    def add_exp(self, amount: int):
        """添加经验（自动升级）"""
        self.exp += amount
        # 升级逻辑：每级需要 level * 100 经验
        while self.exp >= self.level * 100:
            self.exp -= self.level * 100
            self.level += 1
        self._check_level_badges()

    def _check_level_badges(self):
        """检查等级徽章"""
        level_badges = {
            5: "新手", 10: "进阶", 20: "熟练", 30: "专家",
            50: "大师", 100: "传奇"
        }
        for level, badge in level_badges.items():
            if self.level >= level and badge not in self.badges:
                self.badges.append(badge)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "username": self.username,
            "display_name": self.display_name,
            "identity_id": self.identity_id,
            "level": self.level,
            "exp": self.exp,
            "contribution_score": self.contribution_score,
            "badges": self.badges,
            "skills": self.skills,
            "streak": self.streak,
            "last_active": self.last_active,
            "created_at": self.created_at,
            "settings": self.settings,
        }

class Contribution:
    """贡献记录"""

    def __init__(self, identity_id: str = "", contribution_type: str = "other",
                 description: str = "", points: int = 0,
                 timestamp: float = 0.0, metadata: Optional[Dict[str, Any]] = None):
        self.contribution_id = "C-" + uuid.uuid4().hex[:8].upper()
        self.identity_id = identity_id
        self.contribution_type = contribution_type
        self.description = description
        self.points = points
        self.timestamp = timestamp or time.time()
        self.metadata = metadata or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "contribution_id": self.contribution_id,
            "identity_id": self.identity_id,
            "contribution_type": self.contribution_type,
            "description": self.description,
            "points": self.points,
            "timestamp": self.timestamp,
            "metadata": self.metadata,
        }
