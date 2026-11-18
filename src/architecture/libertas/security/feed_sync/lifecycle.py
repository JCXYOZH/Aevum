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

from .config import _nvd_api_key
from .models import FeedSource, Severity, Vulnerability


class FeedLifecycleMixin:
    """状态、统计、自动同步、停止、订阅与配置。"""

    def update_status(self, local_id: str, status: str, notes: str = "") -> bool:
        vuln = self._vulnerabilities.get(local_id)
        if vuln:
            vuln.status = status
            vuln.notes = notes
            vuln.last_updated = time.time()
            self._save()
            return True
        return False

    def get_stats(self) -> Dict[str, Any]:
        by_severity = {}
        by_source = {}
        by_status = {}
        for vuln in self._vulnerabilities.values():
            by_severity[vuln.severity] = by_severity.get(vuln.severity, 0) + 1
            by_source[vuln.source] = by_source.get(vuln.source, 0) + 1
            by_status[vuln.status] = by_status.get(vuln.status, 0) + 1
        return {
            "total": len(self._vulnerabilities),
            "by_severity": by_severity,
            "by_source": by_source,
            "by_status": by_status,
            "critical": sum(1 for v in self._vulnerabilities.values() if v.severity == "critical"),
            "high": sum(1 for v in self._vulnerabilities.values() if v.severity == "high"),
            "new": sum(1 for v in self._vulnerabilities.values() if v.status == "new"),
            "sources": len(self._sources),
            "enabled_sources": sum(1 for s in self._sources.values() if s.enabled),
        }

    def start_auto_sync(self):
        """Start auto sync (API compatible, manual trigger mode)"""
        if not hasattr(self, '_auto_sync_started'):
            self._auto_sync_started = True
            terminal.info("Feed auto sync started (manual trigger mode)", "feed_sync")

    def stop(self):
        """停止自动同步标记（兼容 API）。
    
        本类没有常驻后台线程，退出流程（主程序与 Web 服务）都会调 stop()；
        以前没有这个方法，调用处只能被 try/except 吞掉 AttributeError，
        「漏洞源同步已停止」这句日志其实从来没打出来过。
        """
        self._auto_sync_started = False
        try:
            with self._lock:
                self._save()
        except Exception:
            pass

    def list_feeds(self):
        """List all feed sources (API compatible)
    
        按源名去重：历史数据里同一个源可能同时存在（uuid id 与确定性 id 各一份），
        界面会把整排情报源重复显示一遍。这里做最后一道兜底。
        """
        seen = set()
        out = []
        for source in self.list_sources():
            key = str(source.name or "").strip().lower() or source.source_id
            if key in seen:
                continue
            seen.add(key)
            out.append(source.to_dict())
        return out

    def save_vulnerability(self, query: str, status: str = "saved",
                           notes: str = "") -> Dict[str, Any]:
        """把某条漏洞标记保存（收藏）到本地库，并可附备注。
    
        典型场景：用户按编号直查完一条情报，想把它留下来（默认 status=saved），
        以后按 status 过滤就能只看收藏。
        """
        text = str(query or "").strip()
        if not text:
            return {"success": False, "error": "请提供要保存的漏洞编号或 local_id"}
        target = self._find_local_exact(text)
        if target is None:
            # 本地还没有：先按编号取一次，取到就顺手保存
            fetched = self.lookup_vulnerability(text)
            if not fetched.get("success"):
                return fetched if isinstance(fetched, dict) else {
                    "success": False, "error": f"未找到漏洞: {text}"}
            item = fetched.get("item") or {}
            local_id = item.get("local_id", "")
            target = self._vulnerabilities.get(local_id) if local_id else None
            if target is None:
                return {"success": False, "error": f"取到了 {text} 但未能写入本地库"}
        allowed = {"new", "reviewed", "saved", "ignored", "patched"}
        new_status = str(status or "saved").strip().lower()
        if new_status not in allowed:
            new_status = "saved"
        with self._lock:
            target.status = new_status
            if notes:
                target.notes = str(notes)[:1000]
            target.last_updated = time.time()
            self._save()
            item = target.to_detail_dict()
        return {"success": True, "saved": True, "status": new_status,
                "local_id": item.get("local_id", ""), "item": item}

    def sync_feed(self, feed_id):
        """Sync single feed source (API compatible)"""
        return self.sync_source(feed_id)

    def get_items(self, feed_id="", keyword="", severity="", limit=100):
        """Get vulnerability items (API compatible)
    
        前端传的 feed_id 是源 id（feed_xxx），而漏洞条目上记的是源**名字**，
        直接拿 id 去比 name 永远筛不出东西 —— 这里先把 id 翻成名字。
        """
        source_name = feed_id
        if feed_id:
            source = self._sources.get(feed_id)
            if source is not None:
                source_name = source.name
        vulns = self.search_vulnerabilities(
            keyword=keyword, severity=severity,
            source=source_name, limit=limit
        )
        return [v.to_dict() for v in vulns]

    def set_config(self, feed_id, enabled=None, interval=None):
        """Set feed source config (API compatible)"""
        source = self._sources.get(feed_id)
        if not source:
            return {"success": False, "error": "Feed source not found"}
        if enabled is not None:
            source.enabled = bool(enabled)
        if interval is not None:
            # 字段是 update_interval，以前写成 sync_interval：等于把间隔存进了
            # 一个不存在的属性，设置永远不生效，返回值也不是用户设的那个数。
            try:
                source.update_interval = float(interval)
            except (TypeError, ValueError):
                return {"success": False, "error": "interval 必须是数字（秒）"}
        self._save()
        return {"success": True, "feed_id": feed_id,
                "enabled": source.enabled, "interval": source.update_interval}
