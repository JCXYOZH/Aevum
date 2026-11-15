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


# ============================================================

from .crypto import generate_identity_id, hash_password, verify_password
from .manager import IdentityManager
from .models import Contribution, ContributionType, IdentityProfile

_identity_manager = None


def get_identity_manager() -> IdentityManager:
    return _identity_manager


def add_contribution(identity_id: str, contribution_type: str, **kwargs) -> Optional[Contribution]:
    return _identity_manager.add_contribution(identity_id, contribution_type, **kwargs)
