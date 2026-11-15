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


class Severity(Enum):
    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class Vulnerability:
    """漏洞条目"""

    def __init__(self, vuln_id: str = "", title: str = "",
                 description: str = "", severity: str = "medium",
                 cvss_score: float = 0.0, source: str = "",
                 published_date: str = "",
                 affected_products: Optional[List[str]] = None,
                 cwe_ids: Optional[List[str]] = None,
                 references: Optional[List[str]] = None,
                 tags: Optional[List[str]] = None):
        self.vuln_id = vuln_id
        self.title = title
        self.description = description
        self.severity = severity
        self.cvss_score = cvss_score
        self.cvss_vector = ""      # CVSS 向量串（如 CVSS:3.1/AV:N/...），按编号直查时会带回来
        self.source = source
        self.published_date = published_date
        self.affected_products = affected_products or []
        self.cwe_ids = cwe_ids or []
        self.references = references or []
        self.tags = tags or []
        self.first_seen = time.time()
        self.last_updated = time.time()
        self.local_id = f"vuln_{uuid.uuid4().hex[:8]}"
        self.status = "new"  # new / reviewed / ignored / patched
        self.notes = ""
        self.exploit_available = False
        self.exploit_urls: List[str] = []
        self.patch_available = False
        self.patch_urls: List[str] = []
        self.hash = ""

    def compute_hash(self) -> str:
        content = f"{self.vuln_id}:{self.title}:{self.description[:200]}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "local_id": self.local_id,
            "vuln_id": self.vuln_id,
            "title": self.title,
            "description": self.description[:500],
            "severity": self.severity,
            "cvss_score": self.cvss_score,
            "cvss_vector": self.cvss_vector,
            "source": self.source,
            "published_date": self.published_date,
            "affected_products": self.affected_products,
            "cwe_ids": self.cwe_ids,
            "references": self.references,
            "tags": self.tags,
            "first_seen": self.first_seen,
            "last_updated": self.last_updated,
            "status": self.status,
            "exploit_available": self.exploit_available,
            "patch_available": self.patch_available,
        }

    def to_detail_dict(self) -> Dict[str, Any]:
        """完整详情：description 不截断，并带上 notes / 利用 / 补丁等字段。

        to_dict() 是列表视图（描述截断到 500 字符），详情必须走这里，
        否则用户点开一条漏洞只看得到半截描述，等于看不到详情。
        """
        data = self.to_dict()
        data.update({
            "description": self.description,
            "notes": self.notes,
            "exploit_urls": list(self.exploit_urls),
            "patch_urls": list(self.patch_urls),
            "hash": self.hash,
        })
        return data

class FeedSource:
    """漏洞源配置"""

    @staticmethod
    def make_source_id(name: str) -> str:
        """确定性 source_id：同一个源名永远得到同一个 id（重启、多进程都一致）。

        以前用 uuid4，每构造一次对象 id 就变：前端/API 手里的 feed_id 全部失效，
        last_sync 之类的同步状态也对不上，表现为「同步完看不出效果」。
        """
        text = str(name or "").strip()
        if not text:
            return f"feed_{uuid.uuid4().hex[:8]}"
        return "feed_" + hashlib.md5(text.encode("utf-8")).hexdigest()[:8]

    def __init__(self, name: str = "", source_type: str = "json",
                 url: str = "", enabled: bool = True,
                 update_interval: float = 3600,
                 api_key: str = "",
                 description: str = "",
                 source_id: str = ""):
        self.source_id = source_id or self.make_source_id(name)
        self.name = name
        self.source_type = source_type  # json / xml / rss / api
        self.url = url
        self.enabled = enabled
        self.update_interval = update_interval
        self.api_key = api_key
        self.description = description
        self.last_sync = 0.0
        self.last_sync_count = 0
        self.error_count = 0
        self.last_error = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_id": self.source_id,
            # 前端历史字段名：JS 一直读 f.id / f.count，而这里只给过 source_id /
            # last_sync_count，结果每个源都显示成「NVD (undefined)」，点开关和
            # [SYNC] 传的也是 undefined（永远操作不到真正的源）。保留旧名做别名。
            "id": self.source_id,
            "count": self.last_sync_count,
            "name": self.name,
            "source_type": self.source_type,
            "url": self.url,
            "enabled": self.enabled,
            "update_interval": self.update_interval,
            "description": self.description,
            "last_sync": self.last_sync,
            "last_sync_count": self.last_sync_count,
            "error_count": self.error_count,
            "last_error": self.last_error,
        }
