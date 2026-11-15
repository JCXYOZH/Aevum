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


class FeedStorageMixin:
    """共享实例、默认源、加载保存与源增删。"""

    def __new__(cls, data_dir: str = ""):
        if data_dir:
            return super().__new__(cls)
        with cls._shared_lock:
            if cls._shared is None:
                cls._shared = super().__new__(cls)
            return cls._shared

    def __init__(self, data_dir: str = ""):
        if getattr(self, "_ready", False):
            return                        # 共享实例只初始化一次，重复构造不丢内存状态
        self.data_dir = data_dir or os.path.join(get_data_dir(), "vuln_feeds")
        self.cache_dir = os.path.join(self.data_dir, "cache")
        os.makedirs(self.cache_dir, exist_ok=True)
        self._vulnerabilities: Dict[str, Vulnerability] = {}
        self._sources: Dict[str, FeedSource] = {}
        self._lock = threading.RLock()
        self._syncing = False
        # 按编号直查的短时缓存：key -> (写入时间, 有效期, 结果字典)
        self._lookup_cache: Dict[str, Tuple[float, float, Dict[str, Any]]] = {}
        self._init_default_sources()
        self._load()
        self._ready = True

    def _default_sources(self) -> List[FeedSource]:
        """默认源清单（id 由源名确定性生成，重启后不变）。"""
        return [
            FeedSource("NVD", "api", "https://services.nvd.nist.gov/rest/json/cves/2.0",
                      description="美国国家漏洞数据库（NVD）", update_interval=7200),
            FeedSource("CISA-KEV", "json", "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
                      description="CISA已知被利用漏洞目录", update_interval=86400),
            FeedSource("GitHub-Advisories", "html", "https://github.com/advisories",
                      description="GitHub安全公告", update_interval=86400),
            FeedSource("OSV", "json", "https://api.osv.dev/v1/query",
                      description="开源漏洞数据库（OSV）", update_interval=86400),
        ]

    def _init_default_sources(self):
        """只在当前没有任何源时初始化默认源（已有配置一律不覆盖）。"""
        if self._sources:
            return
        for source in self._default_sources():
            self._sources[source.source_id] = source

    def _ensure_default_sources(self):
        """补齐缺失的默认源：老数据文件里没有源配置时自动补回，不覆盖已有的同步状态。"""
        with self._lock:
            existing = {str(s.name or "").strip().lower() for s in self._sources.values()}
            added = False
            for source in self._default_sources():
                if str(source.name).strip().lower() in existing:
                    continue
                self._sources[source.source_id] = source
                added = True
            if added:
                self._save()

    def _load(self):
        """恢复本地缓存：漏洞条目 + 源配置（含同步状态）。
    
        以前只恢复 vulnerabilities，sources 每次构造对象都用 uuid4 重新生成，
        重启后 feed_id 全变、last_sync 全丢 —— 这是「用起来不方便」的主因之一。
        """
        vuln_file = os.path.join(self.data_dir, "vulnerabilities.json")
        data = None
        try:
            if os.path.exists(vuln_file):
                with open(vuln_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
        except Exception as e:
            terminal.warn(f"加载漏洞数据失败: {e}", "feed_sync")
            data = None
    
        if isinstance(data, dict):
            # 源配置：整份恢复，保证重启后 feed_id 与同步状态都还在
            try:
                # 旧版本给默认源用的是 uuid4 的 source_id，而且会把它们落盘。
                # 现在默认源用确定性 id，如果直接按 id 塞进 _sources，同一个源就会
                # 以两个 id 各存在一份（界面上看到「情报源」整排重复）。
                # 因此按「源名」归并：同名的只保留一条，并把落盘的同步状态带回来。
                by_name = {str(s.name or "").strip().lower(): s
                           for s in self._sources.values() if s.name}
                for s_data in data.get("sources", []) or []:
                    try:
                        name = str(s_data.get("name", "") or "").strip()
                        if not name:
                            continue
                        existed = by_name.get(name.lower())
                        if existed is not None:
                            # 同名：把落盘配置/状态合并回已有源，不再新增一条。
                            # 注意 update_interval 等也要合并，否则用户改过的同步间隔
                            # 会静默回到默认值（set_config 明明写盘成功了却读不到）。
                            existed.enabled = bool(s_data.get("enabled", existed.enabled))
                            if s_data.get("url"):
                                existed.url = s_data.get("url", existed.url)
                            if s_data.get("source_type"):
                                existed.source_type = s_data.get("source_type", existed.source_type)
                            if s_data.get("description"):
                                existed.description = s_data.get("description", existed.description)
                            if s_data.get("update_interval") is not None:
                                try:
                                    existed.update_interval = float(
                                        s_data.get("update_interval") or existed.update_interval)
                                except (TypeError, ValueError):
                                    pass
                            src = existed
                        else:
                            src = FeedSource(
                                name=name,
                                source_type=s_data.get("source_type", "json"),
                                url=s_data.get("url", ""),
                                enabled=bool(s_data.get("enabled", True)),
                                update_interval=float(s_data.get("update_interval", 3600) or 3600),
                                description=s_data.get("description", ""),
                                # 统一收敛到确定性 id：历史文件里的 uuid 不再沿用，
                                # 否则同一源会在重启后再次出现两个 id。
                                source_id=FeedSource.make_source_id(name),
                            )
                        # 同一个源可能有多条历史记录（uuid id 一份、确定性 id 一份，
                        # 其中一条往往没有同步状态）。状态要「取最新的」，不能被
                        # 后面那条空记录覆盖成 0 —— 否则用户重启后就看不到同步结果了。
                        try:
                            p_sync = float(s_data.get("last_sync", 0) or 0)
                        except (TypeError, ValueError):
                            p_sync = 0.0
                        try:
                            p_count = int(s_data.get("last_sync_count", 0) or 0)
                        except (TypeError, ValueError):
                            p_count = 0
                        try:
                            p_errors = int(s_data.get("error_count", 0) or 0)
                        except (TypeError, ValueError):
                            p_errors = 0
                        if p_sync >= float(src.last_sync or 0):
                            src.last_sync = max(p_sync, float(src.last_sync or 0))
                            src.last_sync_count = max(p_count, int(src.last_sync_count or 0))
                            if s_data.get("last_error"):
                                src.last_error = str(s_data.get("last_error"))[:500]
                        src.error_count = max(p_errors, int(src.error_count or 0))
                        self._sources[src.source_id] = src
                        by_name[src.name.strip().lower()] = src
                    except Exception:
                        continue
            except Exception as e:
                terminal.warn(f"加载漏洞源配置失败: {e}", "feed_sync")
    
            # 漏洞条目：字段全量恢复（详情字段曾经不落盘，等于重启后丢详情）
            try:
                for v_data in data.get("vulnerabilities", [])[-2000:]:
                    try:
                        vuln = Vulnerability(
                            vuln_id=v_data.get("vuln_id", ""),
                            title=v_data.get("title", ""),
                            description=v_data.get("description", ""),
                            severity=v_data.get("severity", "medium"),
                            cvss_score=v_data.get("cvss_score", 0),
                            source=v_data.get("source", ""),
                            published_date=v_data.get("published_date", ""),
                            affected_products=v_data.get("affected_products", []),
                            cwe_ids=v_data.get("cwe_ids", []),
                            references=v_data.get("references", []),
                            tags=v_data.get("tags", []),
                        )
                        vuln.local_id = v_data.get("local_id", vuln.local_id)
                        vuln.status = v_data.get("status", "new")
                        vuln.notes = v_data.get("notes", "") or ""
                        vuln.cvss_vector = v_data.get("cvss_vector", "") or ""
                        vuln.first_seen = float(v_data.get("first_seen", vuln.first_seen) or vuln.first_seen)
                        vuln.last_updated = float(v_data.get("last_updated", vuln.last_updated) or vuln.last_updated)
                        vuln.exploit_available = bool(v_data.get("exploit_available", False))
                        vuln.exploit_urls = v_data.get("exploit_urls", []) or []
                        vuln.patch_available = bool(v_data.get("patch_available", False))
                        vuln.patch_urls = v_data.get("patch_urls", []) or []
                        vuln.hash = v_data.get("hash", "") or ""
                        self._vulnerabilities[vuln.local_id] = vuln
                    except Exception:
                        continue
            except Exception as e:
                terminal.warn(f"加载漏洞数据失败: {e}", "feed_sync")
    
        # 老数据文件里可能没有源配置（或默认源被删过）：补齐缺的默认源
        self._ensure_default_sources()

    def _save(self):
        vuln_file = os.path.join(self.data_dir, "vulnerabilities.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                # 存全量详情：to_dict() 会把 description 截断到 500 字符，
                # 用它落盘等于重启后详情永久丢失。
                "vulnerabilities": [v.to_detail_dict() for v in list(self._vulnerabilities.values())[-2000:]],
                "sources": [s.to_dict() for s in self._sources.values()],
            }
            with open(vuln_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def add_source(self, source: FeedSource) -> str:
        with self._lock:
            self._sources[source.source_id] = source
            self._save()
        return source.source_id

    def remove_source(self, source_id: str) -> bool:
        with self._lock:
            if source_id in self._sources:
                del self._sources[source_id]
                self._save()
                return True
            return False

    def list_sources(self, enabled_only: bool = False) -> List[FeedSource]:
        sources = list(self._sources.values())
        if enabled_only:
            sources = [s for s in sources if s.enabled]
        return sources
