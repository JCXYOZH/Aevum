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


class FeedSyncMixin:
    """单源同步、全量同步、重载与编号查询。"""

    def sync_source(self, source_id: str) -> Dict[str, Any]:
        """同步单个漏洞源（从网络获取真实漏洞数据）"""
        source = self._sources.get(source_id)
        if not source or not source.enabled:
            return {"success": False, "error": "源不存在或未启用"}
    
        source.last_sync = time.time()
        terminal.info(f"同步漏洞源: {source.name}", "feed_sync")
    
        new_count = 0
        updated_count = 0
        errors = []
        feed_data = []
    
        try:
            # 从网络获取漏洞数据
            feed_data = self._fetch_feed_data(source)
    
            # 缓存到本地
            if feed_data:
                cache_file = os.path.join(self.cache_dir, f"{source.name.lower()}_cache.json")
                try:
                    with open(cache_file, "w", encoding="utf-8") as f:
                        json.dump(feed_data, f, ensure_ascii=False, indent=2)
                except Exception:
                    pass
    
            # 解析漏洞数据
            for item in feed_data:
                try:
                    vuln = Vulnerability(
                        vuln_id=item.get("cve", item.get("id", "")),
                        title=item.get("title", item.get("name", ""))[:200],
                        description=item.get("description", ""),
                        severity=self._parse_severity(item.get("severity", ""),
                                                       float(item.get("cvss", item.get("score", 0)))),
                        cvss_score=float(item.get("cvss", item.get("score", 0))),
                        source=source.name,
                        published_date=item.get("published", item.get("date", "")),
                        affected_products=item.get("products", item.get("affected_products", [])),
                        cwe_ids=item.get("cwe", item.get("cwe_ids", [])),
                        references=item.get("references", [item.get("link", "")] if item.get("link") else []),
                        tags=item.get("tags", []),
                    )
                    if not vuln.vuln_id and not vuln.title:
                        continue
                    if self._deduplicate(vuln):
                        with self._lock:
                            self._vulnerabilities[vuln.local_id] = vuln
                        new_count += 1
                    else:
                        updated_count += 1
                except Exception as e:
                    errors.append(str(e))
    
            source.last_sync_count = new_count
            source.error_count = len(errors)
            if errors:
                source.last_error = errors[0]
    
        except Exception as e:
            source.error_count += 1
            source.last_error = str(e)
            errors.append(str(e))
            terminal.error(f"同步失败 [{source.name}]: {e}", "feed_sync")
    
        self._save()
        terminal.success(f"同步完成 [{source.name}]: 新增 {new_count}, 更新 {updated_count}", "feed_sync")
        return {
            # 统一带上 success：前端/模型都按这个字段判成败，
            # 以前只返回 source/new/updated，调用方判 d.success 永远是 undefined。
            "success": len(errors) == 0,
            "source": source.name,
            "new": new_count,
            "updated": updated_count,
            "errors": len(errors),
            "total": len(self._vulnerabilities),
        }

    def sync_all(self) -> Dict[str, Any]:
        """同步所有启用的漏洞源"""
        if self._syncing:
            return {"success": False, "error": "同步正在进行中"}
    
        self._syncing = True
        terminal.section("漏洞源同步")
    
        results = {}
        total_new = 0
        for source in self.list_sources(enabled_only=True):
            result = self.sync_source(source.source_id)
            results[source.name] = result
            total_new += result.get("new", 0)
    
        self._syncing = False
        terminal.success(f"同步完成: 新增 {total_new} 个漏洞", "feed_sync")
        failed = [k for k, v in results.items() if isinstance(v, dict) and v.get("error")]
        return {"success": not failed, "total_new": total_new, "sources": results,
                "failed_sources": failed}

    def reload(self) -> Dict[str, Any]:
        """丢掉内存缓存并从磁盘重读（手工改文件或多进程写入后强制对齐）。"""
        try:
            with self._lock:
                self._vulnerabilities.clear()
                self._sources.clear()
                self._lookup_cache.clear()
                self._init_default_sources()
                self._load()
            return {"success": True, "total": len(self._vulnerabilities),
                    "sources": len(self._sources)}
        except Exception as e:
            return {"success": False, "error": f"重新加载失败: {e}"}

    def get_vulnerability(self, local_id: str) -> Optional[Vulnerability]:
        return self._vulnerabilities.get(local_id)

    def get_by_cve(self, cve_id: str) -> Optional[Vulnerability]:
        for vuln in self._vulnerabilities.values():
            if vuln.vuln_id.upper() == cve_id.upper():
                return vuln
        return None
