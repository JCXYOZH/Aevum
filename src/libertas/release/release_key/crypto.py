"""发布密钥职责：crypto。"""

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


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()

def _generate_key(username: str, identity_id: str, seq: int) -> str:
    raw = f"{username}|{identity_id}|{seq}|{time.time()}|{secrets.token_hex(16)}"
    h = hashlib.sha256(raw.encode("utf-8")).hexdigest().upper()
    return f"LIBERTAS-RELEASE-{h[:8]}-{h[8:16]}-{h[16:24]}-{seq:04d}"
