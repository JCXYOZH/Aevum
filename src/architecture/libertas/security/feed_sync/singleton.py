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

from .manager import FeedSyncManager
from .models import FeedSource, Severity, Vulnerability

def get_feed_sync_manager() -> FeedSyncManager:
    return _feed_sync_manager


def get_feed_sync() -> FeedSyncManager:
    """兼容别名：主程序退出流程按 get_feed_sync() 取实例（历史写法）。"""
    return _feed_sync_manager


def sync_vulnerability_feeds() -> Dict[str, Any]:
    return _feed_sync_manager.sync_all()
