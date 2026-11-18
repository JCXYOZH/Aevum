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

from .fetch import FeedFetchMixin
from .lifecycle import FeedLifecycleMixin
from .lookup import FeedLookupMixin
from .models import FeedSource, Severity, Vulnerability
from .search import FeedSearchMixin
from .storage import FeedStorageMixin
from .sync import FeedSyncMixin


class FeedSyncManager(FeedStorageMixin, FeedFetchMixin, FeedSyncMixin, FeedSearchMixin, FeedLookupMixin, FeedLifecycleMixin):
    """外部漏洞源同步"""

    # 进程内共享实例：Web 路由、原生工具、主程序各自 FeedSyncManager() 时
    # 会各建一份独立内存库 —— 「Web 里同步完，模型检索不到」就是这么来的。
    # 默认数据目录只保留一个实例；显式传 data_dir（测试/多库）仍是独立实例。
    _shared = None
    _shared_lock = threading.Lock()
