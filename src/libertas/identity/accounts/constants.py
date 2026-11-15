"""账户职责：constants。"""

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
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


LICENSE_SECRET = b"Libertas-License-Secret-2026-DoNotShare"

LICENSE_VERSION = 1

ACCOUNT_TIERS = {
    "unregistered": {
        "label": "未注册",
        "features": ["chat_local", "toolbox_basic", "devtools"],
        "can_network": False,
        "can_cloud": False,
        "can_governance": False,
        "can_fork": False,
    },
    "registered": {
        "label": "已注册",
        "features": ["chat_local", "toolbox_full", "devtools", "lan_share",
                     "wan_share", "knowledge_base", "code_workshop", "browser"],
        "can_network": True,
        "can_cloud": False,
        "can_governance": True,
        "can_fork": True,
    },
    "activated": {
        "label": "已激活",
        "features": ["chat_local", "toolbox_full", "devtools", "lan_share",
                     "wan_share", "knowledge_base", "code_workshop", "browser",
                     "cloud_sync", "cloud_storage", "governance", "voting",
                     "fork", "nat_traversal", "tunnel"],
        "can_network": True,
        "can_cloud": True,
        "can_governance": True,
        "can_fork": True,
    },
    "verified": {
        "label": "已认证",
        "features": ["*"],
        "can_network": True,
        "can_cloud": True,
        "can_governance": True,
        "can_fork": True,
    },
}

DEFAULT_QUOTAS = {
    "unregistered": {"api_calls_per_day": 50, "storage_mb": 10, "scans_per_day": 5},
    "registered": {"api_calls_per_day": 500, "storage_mb": 100, "scans_per_day": 50},
    "activated": {"api_calls_per_day": 5000, "storage_mb": 1024, "scans_per_day": 500},
    "verified": {"api_calls_per_day": -1, "storage_mb": -1, "scans_per_day": -1},  # -1 表示无限制
}
