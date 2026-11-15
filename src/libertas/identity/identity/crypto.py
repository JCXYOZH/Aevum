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


def hash_password(password: str) -> str:
    """密码哈希（PBKDF2 + salt）"""
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
    return f"pbkdf2${salt}${h.hex()}"

def verify_password(password: str, stored: str) -> bool:
    """密码验证"""
    try:
        parts = stored.split("$")
        if len(parts) != 3:
            return False
        h = hashlib.pbkdf2_hmac("sha256", password.encode(), parts[1].encode(), 100000)
        return hmac.compare_digest(h.hex(), parts[2])
    except Exception:
        return False

def generate_identity_id() -> str:
    """生成身份ID（MH-前缀）"""
    return "MH-" + uuid.uuid4().hex[:12].upper()
