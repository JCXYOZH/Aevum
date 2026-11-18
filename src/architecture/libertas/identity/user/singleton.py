"""
用户管理器

用户注册、登录、会话、角色、权限、用户配置、用户活动、用户统计。
"""
import os
import json
import time
import uuid
import hashlib
import hmac
import secrets
import threading
import sqlite3
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

from .manager import UserManager
from .models import User

_user_manager = None


def get_user_manager() -> UserManager:
    return _user_manager


def register_user(username: str, password: str, **kwargs) -> Tuple[Optional[User], str]:
    return _user_manager.register(username, password, **kwargs)
