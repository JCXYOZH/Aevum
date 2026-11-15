"""发布密钥职责：constants。"""

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


ROLE_KEY_CONFIG = {
    "guest":     {"max_base": 0,  "interval": 0,    "min_contrib": 0,   "min_tasks": 0},
    "member":    {"max_base": 1,  "interval": 86400, "min_contrib": 0,   "min_tasks": 0},
    "creator":   {"max_base": 5,  "interval": 3600,  "min_contrib": 0,   "min_tasks": 0},
    "admin":     {"max_base": 10, "interval": 600,   "min_contrib": 0,   "min_tasks": 0},
    "owner":     {"max_base": 99, "interval": 0,     "min_contrib": 0,   "min_tasks": 0},
}

CONTRIB_BONUS_STEP = 100

TASK_BONUS_STEP = 10

HARD_CAP = 99
