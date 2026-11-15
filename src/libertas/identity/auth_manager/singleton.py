"""
统一认证与授权管理器

集中管理认证策略、权限矩阵、角色继承、访问控制列表、审计。
"""
import os
import json
import sqlite3
import time
import uuid
import hashlib
import hmac
import secrets
import threading
from typing import Any, Dict, List, Optional, Set, Tuple
import base64
import hmac
import hashlib
import secrets

LICENSE_SECRET = b"Libertas-License-Secret-2026-DoNotShare"
LICENSE_VERSION = 1
from datetime import datetime
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

from .crypto import generate_identity_id, generate_license_key, hash_password, validate_email, validate_phone, verify_license_key, verify_password
from .manager import AuthManager
from .models import PermissionAction, Role, ACLItem

_auth_manager = None


def get_auth_manager() -> AuthManager:
    return _auth_manager


def check_permission(user_id: str, resource: str, action: str) -> Tuple[bool, str]:
    return _auth_manager.check_permission(user_id, resource, action)
