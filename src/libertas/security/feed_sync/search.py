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


class FeedSearchMixin:
    """关键词拆分、时间/CVSS 归一、相关度与漏洞检索。"""

    @staticmethod
    def _split_multi(value: Any) -> List[str]:
        """把 "a,b" / ["a","b"] / None 统一成列表（大小写不敏感去重，保留原大小写）。"""
        if value is None:
            return []
        raw: List[str] = []
        if isinstance(value, (list, tuple, set)):
            for item in value:
                raw.extend(str(item).split(","))
        else:
            raw = str(value).split(",")
        out: List[str] = []
        seen = set()
        for item in raw:
            name = item.strip()
            if name and name.lower() not in seen:
                seen.add(name.lower())
                out.append(name)
        return out

    @staticmethod
    def _split_keywords(value: Any) -> List[str]:
        """关键词分词：空格（兼容逗号/列表）切开，多词之间是 AND。
    
        注意不能直接用 _split_multi：它只按逗号切，
        "apache remote" 会被当成一个整串，多词 AND 检索就永远命中不了。
        """
        out: List[str] = []
        seen = set()
        from .manager import FeedSyncManager
        for chunk in FeedSyncManager._split_multi(value):
            for word in str(chunk).replace(",", " ").split():
                if word and word.lower() not in seen:
                    seen.add(word.lower())
                    out.append(word)
        return out

    @staticmethod
    def _parse_time(value: Any) -> Optional[float]:
        """把 "YYYY-MM-DD" / ISO 时间 / 数字时间戳解析成秒级时间戳；解析失败返回 None。
    
        时间过滤宁可漏判也不抛异常：调用方把 None 当「该条不具备可比时间」处理。
        """
        if value is None or value == "":
            return None
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        raw = str(value).strip()
        if not raw:
            return None
        try:
            return float(raw)
        except (TypeError, ValueError):
            pass
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
        except ValueError:
            pass
        for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y-%m", "%Y%m%d"):
            try:
                return datetime.strptime(raw, fmt).timestamp()
            except ValueError:
                continue
        return None

    @staticmethod
    def _norm_cvss(value: Any) -> Optional[float]:
        """CVSS 过滤值归一化：空值/非法值/0 都当「不过滤」，返回 None。"""
        if value is None or value == "":
            return None
        try:
            num = float(value)
        except (TypeError, ValueError):
            return None
        if num <= 0:
            return None
        return max(0.0, min(10.0, num))

    @staticmethod
    def _norm_page(offset: Any, limit: Any) -> Tuple[int, int]:
        """分页归一化：offset >= 0；limit 默认 50、上限 200。"""
        try:
            start = int(offset)
        except (TypeError, ValueError):
            start = 0
        try:
            size = int(limit)
        except (TypeError, ValueError):
            size = 50
        if size <= 0:
            size = 50
        return max(0, start), min(size, 200)

    @staticmethod
    def _vuln_relevance(vuln: "Vulnerability", words: List[str]) -> int:
        """相关度打分：命中位置越结构化，权重越高（编号 > 标题 > CWE/产品 > 标签 > 描述）。"""
        if not words:
            return 0
        vuln_id = str(vuln.vuln_id or "").lower()
        title = str(vuln.title or "").lower()
        desc = str(vuln.description or "").lower()
        cwes = " ".join(str(c) for c in (vuln.cwe_ids or [])).lower()
        prods = " ".join(str(p) for p in (vuln.affected_products or [])).lower()
        tags = " ".join(str(t) for t in (vuln.tags or [])).lower()
        score = 0
        for word in words:
            if word in vuln_id:
                score += 6
            if word in title:
                score += 5
            if word in cwes:
                score += 3
            if word in prods:
                score += 3
            if word in tags:
                score += 2
            if word in desc:
                score += 1
        return score

    def _match_vulnerabilities(self, keyword: str = "", severity: str = "",
                               source: str = "", product: str = "",
                               status: str = "", min_cvss: Any = 0,
                               max_cvss: Any = 0, cve: str = "",
                               vuln_id: str = "", since: Any = "",
                               until: Any = "", tags: Any = None,
                               sort: str = "cvss") -> List["Vulnerability"]:
        """按结构化条件过滤并排序，返回命中全集（不含分页）。
    
        兼容老语义：只给一个关键词时，等价于原来的「整串子串匹配」。
        """
        words = [w.lower() for w in self._split_keywords(keyword)]
        severities = [s.lower() for s in self._split_multi(severity)]
        sources = [s.lower() for s in self._split_multi(source)]
        products = [p.lower() for p in self._split_multi(product)]
        statuses = [s.lower() for s in self._split_multi(status)]
        tag_filters = [t.lower() for t in self._split_multi(tags)]
        id_filters = [x.lower() for x in (self._split_multi(cve) + self._split_multi(vuln_id))]
        low_cvss = self._norm_cvss(min_cvss)
        high_cvss = self._norm_cvss(max_cvss)
        since_ts = self._parse_time(since)
        until_ts = self._parse_time(until)
    
        # 先拿快照再匹配：避免并发写入时字典在迭代中途改变
        with self._lock:
            snapshot = list(self._vulnerabilities.values())
    
        matched: List[Vulnerability] = []
        for vuln in snapshot:
            try:
                if words:
                    haystack = " ".join([
                        str(vuln.title or ""), str(vuln.description or ""),
                        str(vuln.vuln_id or ""),
                        " ".join(str(p) for p in (vuln.affected_products or [])),
                        " ".join(str(c) for c in (vuln.cwe_ids or [])),
                        " ".join(str(t) for t in (vuln.tags or [])),
                    ]).lower()
                    if not all(w in haystack for w in words):
                        continue
                if severities and str(vuln.severity or "").lower() not in severities:
                    continue
                if sources and str(vuln.source or "").lower() not in sources:
                    continue
                if products:
                    own = [str(p).lower() for p in (vuln.affected_products or [])]
                    if not any(any(p in item for item in own) for p in products):
                        continue
                if statuses and str(vuln.status or "").lower() not in statuses:
                    continue
                if tag_filters:
                    own_tags = [str(t).lower() for t in (vuln.tags or [])]
                    if not any(t in own_tags for t in tag_filters):
                        continue
                if id_filters:
                    own_id = str(vuln.vuln_id or "").lower()
                    if not any(own_id == q or own_id.startswith(q) for q in id_filters):
                        continue
                score = float(vuln.cvss_score or 0)
                if low_cvss is not None and score < low_cvss:
                    continue
                if high_cvss is not None and score > high_cvss:
                    continue
                if since_ts is not None or until_ts is not None:
                    published = self._parse_time(vuln.published_date)
                    if published is None:
                        continue                      # 时间不可解析 → 视为不匹配，不抛异常
                    if since_ts is not None and published < since_ts:
                        continue
                    if until_ts is not None and published > until_ts:
                        continue
                # 只挂临时属性供排序用，不改构造函数签名、不参与序列化
                vuln._relevance = self._vuln_relevance(vuln, words)
                matched.append(vuln)
            except Exception:
                continue
    
        order = str(sort or "cvss").strip().lower()
        severity_rank = {"critical": 4, "high": 3, "medium": 2, "low": 1, "none": 0}
        try:
            if order == "date":
                matched.sort(key=lambda v: self._parse_time(v.published_date) or 0.0, reverse=True)
            elif order == "severity":
                matched.sort(key=lambda v: (severity_rank.get(str(v.severity or "").lower(), 0),
                                            float(v.cvss_score or 0)), reverse=True)
            elif order == "relevance":
                matched.sort(key=lambda v: (getattr(v, "_relevance", 0),
                                            float(v.cvss_score or 0)), reverse=True)
            else:
                matched.sort(key=lambda v: float(v.cvss_score or 0), reverse=True)
        except Exception:
            matched.sort(key=lambda v: float(v.cvss_score or 0), reverse=True)
        return matched

    def _search_page(self, **kwargs) -> Tuple[int, List["Vulnerability"]]:
        """返回 (命中总数, 当前页)。搜索与分页共用一条路径，避免 total 与 items 口径不一致。"""
        matched = self._match_vulnerabilities(
            keyword=kwargs.get("keyword", ""),
            severity=kwargs.get("severity", ""),
            source=kwargs.get("source", ""),
            product=kwargs.get("product", ""),
            status=kwargs.get("status", ""),
            min_cvss=kwargs.get("min_cvss", 0),
            max_cvss=kwargs.get("max_cvss", 0),
            cve=kwargs.get("cve", ""),
            vuln_id=kwargs.get("vuln_id", ""),
            since=kwargs.get("since", ""),
            until=kwargs.get("until", ""),
            tags=kwargs.get("tags", None),
            sort=kwargs.get("sort", "cvss"),
        )
        start, size = self._norm_page(kwargs.get("offset", 0), kwargs.get("limit", 50))
        return len(matched), matched[start:start + size]

    def search_vulnerabilities(self, keyword: str = "", severity: str = "",
                               source: str = "", product: str = "",
                               status: str = "", limit: int = 50,
                               min_cvss: Any = 0, max_cvss: Any = 0,
                               cve: str = "", vuln_id: str = "",
                               since: Any = "", until: Any = "",
                               tags: Any = None, sort: str = "cvss",
                               offset: int = 0) -> List[Vulnerability]:
        """结构化检索漏洞（返回类型保持 List[Vulnerability]）。
    
        keyword 按空格分词后为 AND：每个词在 title / description / vuln_id /
        affected_products / cwe_ids / tags 中任一命中即可。空关键词表示不过滤。
        """
        _total, page = self._search_page(
            keyword=keyword, severity=severity, source=source, product=product,
            status=status, min_cvss=min_cvss, max_cvss=max_cvss, cve=cve,
            vuln_id=vuln_id, since=since, until=until, tags=tags, sort=sort,
            offset=offset, limit=limit,
        )
        return page

    @staticmethod
    def _build_snippet(vuln: "Vulnerability", keyword: str = "") -> str:
        """生成列表用的短摘要：命中词前后各 80 字符，没命中就取描述前 160 字符。"""
        desc = str(vuln.description or "")
        from .manager import FeedSyncManager
        for word in FeedSyncManager._split_keywords(keyword):
            pos = desc.lower().find(word.lower())
            if pos < 0:
                continue
            start = max(0, pos - 80)
            end = min(len(desc), pos + len(word) + 80)
            return ("…" if start > 0 else "") + desc[start:end] + ("…" if end < len(desc) else "")
        return desc[:160]

    def search_as_dicts(self, **kwargs) -> Dict[str, Any]:
        """检索并返回可直接给 API / 模型用的字典结构（含总数、分页、摘要）。"""
        try:
            total, items = self._search_page(**kwargs)
            start, size = self._norm_page(kwargs.get("offset", 0), kwargs.get("limit", 50))
            out = []
            for vuln in items:
                row = vuln.to_dict()
                row["snippet"] = self._build_snippet(vuln, kwargs.get("keyword", ""))
                out.append(row)
            return {"success": True, "total": total, "returned": len(out),
                    "offset": start, "limit": size, "items": out}
        except Exception as e:
            return {"success": False, "total": 0, "returned": 0,
                    "offset": 0, "limit": 0, "items": [],
                    "error": f"检索失败: {e}"}

    def get_vulnerability_detail(self, query: str) -> Optional[Dict[str, Any]]:
        """按 local_id / CVE / OSV/GHSA 编号 / 标题精确匹配取完整详情。"""
        text = str(query or "").strip()
        if not text:
            return None
        lowered = text.lower()
        with self._lock:
            snapshot = list(self._vulnerabilities.values())
        hits = [v for v in snapshot if str(v.vuln_id or "").lower() == lowered]
        if not hits:
            hits = [v for v in snapshot if v.local_id == text]
        if not hits:
            hits = [v for v in snapshot if str(v.title or "").strip().lower() == lowered]
        if not hits:
            # 允许只传编号前缀（同一编号被多个源收录时取 CVSS 最高的一条）
            hits = [v for v in snapshot if str(v.vuln_id or "").lower().startswith(lowered)]
        if not hits:
            return None
        hits.sort(key=lambda v: float(v.cvss_score or 0), reverse=True)
        return hits[0].to_detail_dict()
