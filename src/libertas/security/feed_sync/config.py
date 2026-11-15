"""
core/feed_sync.py - 外部漏洞源同步

从多个漏洞源（CVE、NVD、CNVD、Exploit-DB等）同步漏洞数据，
支持增量更新、去重、分类、严重程度评估、本地缓存。
"""
import os
import json
import time
import uuid
import hashlib
import threading
import re
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


def _nvd_api_key() -> str:
    """可选 NVD API Key：config.yaml 的 nvd_api_key。

    没有 key 也能查（匿名限速更严）；有就按 NVD 要求放进 apiKey 头。
    """
    try:
        from libertas.foundation.config import config as _cfg
        return str(_cfg.get("nvd_api_key", "") or "").strip()
    except Exception:
        return ""
