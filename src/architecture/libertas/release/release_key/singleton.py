"""发布密钥职责：singleton。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

from .models import ReleaseKey
from .manager import ReleaseKeyManager

_release_key_manager = ReleaseKeyManager()

def get_release_key_manager() -> ReleaseKeyManager:
    return _release_key_manager

def create_release_key(name: str, **kwargs) -> Tuple[ReleaseKey, str]:
    return _release_key_manager.create_key(name, **kwargs)
