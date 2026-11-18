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


class FeedLookupMixin:
    """编号直查：本地精确、HTTP JSON、请求缓存与情报汇总。"""

    def _find_local_exact(self, query: str) -> Optional[Vulnerability]:
        """本地精确命中：local_id / 完整编号（大小写不敏感）/ 标题完全一致。
    
        刻意不做前缀匹配：lookup("CVE-2021-4422") 不应该命中 CVE-2021-44228。
        """
        text = str(query or "").strip()
        if not text:
            return None
        lowered = text.lower()
        with self._lock:
            snapshot = list(self._vulnerabilities.values())
        for vuln in snapshot:
            if vuln.local_id == text:
                return vuln
        for vuln in snapshot:
            if str(vuln.vuln_id or "").strip().lower() == lowered:
                return vuln
        for vuln in snapshot:
            if str(vuln.title or "").strip().lower() == lowered:
                return vuln
        return None

    def _http_get_json(self, url: str, headers: Optional[Dict[str, str]] = None,
                       timeout: float = 10.0) -> Tuple[int, Any, str]:
        """单条情报用的一次性 HTTP GET（JSON）。返回 (status, data, error)，绝不抛异常。
    
        抽成独立方法是为了让「按编号取单条」这条链路可以被测试替换成假实现，
        不必真的访问 nvd.nist.gov / api.osv.dev。
        """
        import ssl as _ssl
        import urllib.error as _urlerr
        import urllib.request as _urlreq
    
        req_headers = {
            "User-Agent": "Libertas-FeedSync/1.0 (+vuln-lookup)",
            "Accept": "application/json",
        }
        req_headers.update(headers or {})
        ctx = _ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = _ssl.CERT_NONE
        try:
            req = _urlreq.Request(url, headers=req_headers)
            with _urlreq.urlopen(req, timeout=timeout, context=ctx) as resp:
                status = int(getattr(resp, "status", 200) or 200)
                body = resp.read()
                if str(resp.headers.get("Content-Encoding") or "").lower() == "gzip":
                    import gzip
                    body = gzip.decompress(body)
            return status, json.loads(body.decode("utf-8", errors="replace")), ""
        except _urlerr.HTTPError as e:
            return int(getattr(e, "code", 0) or 0), None, f"HTTP {getattr(e, 'code', '?')}"
        except _urlerr.URLError as e:
            return 0, None, f"网络不可达: {getattr(e, 'reason', e)}"
        except TimeoutError:
            return 0, None, f"请求超时（{timeout:g}s）"
        except json.JSONDecodeError as e:
            return 0, None, f"响应不是合法 JSON: {e}"
        except Exception as e:
            return 0, None, f"{type(e).__name__}: {e}"

    @staticmethod
    def _lookup_request(vuln_id: str, is_cve: bool) -> Tuple[str, Dict[str, str]]:
        """拼出单条抓取请求：CVE 走 NVD CVE API，其它编号走 OSV。"""
        from urllib.parse import quote
        if is_cve:
            url = ("https://services.nvd.nist.gov/rest/json/cves/2.0?cveId="
                   + quote(vuln_id.upper()))
            headers: Dict[str, str] = {}
            key = _nvd_api_key()
            if key:
                headers["apiKey"] = key
            return url, headers
        return "https://api.osv.dev/v1/vulns/" + quote(vuln_id), {}

    def _store_lookup_result(self, parsed: Dict[str, Any]) -> Vulnerability:
        """把单条联网结果并入库：同编号已存在就就地更新，否则新增并落盘。"""
        vuln_id = str(parsed.get("id", "") or "").strip()
        with self._lock:
            existing = None
            for vuln in self._vulnerabilities.values():
                if str(vuln.vuln_id or "").lower() == vuln_id.lower():
                    existing = vuln
                    break
            if existing is None:
                vuln = Vulnerability(
                    vuln_id=vuln_id,
                    title=str(parsed.get("title", "") or vuln_id)[:200],
                    description=str(parsed.get("description", "") or ""),
                    severity=str(parsed.get("severity", "") or "medium"),
                    cvss_score=float(parsed.get("score", 0) or 0),
                    source=str(parsed.get("source", "") or ""),
                    published_date=str(parsed.get("date", "") or ""),
                    affected_products=list(parsed.get("products", []) or []),
                    cwe_ids=list(parsed.get("cwe", []) or []),
                    references=list(parsed.get("references", []) or []),
                    tags=list(parsed.get("tags", []) or []),
                )
                self._vulnerabilities[vuln.local_id] = vuln
            else:
                vuln = existing
                vuln.title = str(parsed.get("title", "") or vuln.title)[:200]
                vuln.description = str(parsed.get("description", "") or vuln.description)
                vuln.severity = str(parsed.get("severity", "") or vuln.severity)
                vuln.cvss_score = float(parsed.get("score", 0) or vuln.cvss_score or 0)
                vuln.source = str(parsed.get("source", "") or vuln.source)
                vuln.published_date = str(parsed.get("date", "") or vuln.published_date)
                if parsed.get("products"):
                    vuln.affected_products = list(parsed["products"])
                if parsed.get("cwe"):
                    vuln.cwe_ids = list(parsed["cwe"])
                if parsed.get("references"):
                    vuln.references = list(parsed["references"])
                if parsed.get("tags"):
                    vuln.tags = list(dict.fromkeys(list(vuln.tags) + list(parsed["tags"])))
                vuln.last_updated = time.time()
            vuln.cvss_vector = str(parsed.get("cvss_vector", "") or "")
            vuln.exploit_available = bool(parsed.get("exploit_available", False))
            vuln.exploit_urls = list(parsed.get("exploit_urls", []) or [])
            vuln.patch_available = bool(parsed.get("patch_available", False))
            vuln.patch_urls = list(parsed.get("patch_urls", []) or [])
            self._save()
        return vuln

    def lookup_vulnerability(self, query: str) -> Dict[str, Any]:
        """按编号直查一条漏洞的完整情报：先本地，再按编号联网取单条。
    
        典型用法：lookup_vulnerability("CVE-2021-44228") 直接拿到这一条的
        标题/完整描述/CVSS 分数与向量/严重等级/CWE/发布日期/参考链接/受影响产品/利用与补丁。
        不做全量同步，只取这一条；取到后写回本地缓存，下次直接命中。
        """
        started = time.time()
        text = str(query or "").strip()
        if not text:
            return {"success": False, "cached": False, "code": "empty_query", "query": text,
                    "error": "请提供漏洞编号（CVE-YYYY-NNNN / GHSA-… / OSV-… 或本地 local_id）"}
    
        # 1) 本地精确命中：不联网
        local = self._find_local_exact(text)
        if local is not None:
            detail = local.to_detail_dict()
            detail["cached"] = True
            detail["fetched_from"] = "cache"
            return {"success": True, "cached": True, "fetched_from": "cache",
                    "query": text, "item": detail,
                    "elapsed": round(time.time() - started, 3)}
    
        # 2) 编号合法性：不合法就别去打上游
        is_cve = bool(self._CVE_ID_RE.match(text))
        # "CVE-abc" / "CVE2021" 这类写坏的 CVE 一律按格式错误拒掉，
        # 不要当成 OSV 编号发出去再收一个 404
        broken_cve = text.upper().startswith("CVE") and not is_cve
        if broken_cve or (not is_cve and not self._OTHER_ID_RE.match(text)):
            return {"success": False, "cached": False, "code": "invalid_id", "query": text,
                    "error": (f"编号格式不合法: {text}。"
                              "请提供 CVE-YYYY-NNNN、GHSA-xxxx-xxxx-xxxx、OSV-… / PYSEC-… 形式的编号")}
    
        # 3) 短时缓存：同一编号 5 分钟内不重复打上游
        key = text.lower()
        now = time.time()
        with self._lock:
            cached = self._lookup_cache.get(key)
        if cached and (now - cached[0]) < cached[1]:
            payload = dict(cached[2])
            payload["query"] = text
            payload["from_ttl_cache"] = True
            if payload.get("success"):
                payload["cached"] = True
            payload["elapsed"] = round(time.time() - started, 3)
            return payload
    
        # 4) 联网取单条
        url, headers = self._lookup_request(text, is_cve)
        source = "NVD" if is_cve else "OSV"
        try:
            status, data, err = self._http_get_json(
                url, headers=headers, timeout=self._LOOKUP_TIMEOUT)
        except Exception as e:
            status, data, err = 0, None, f"{type(e).__name__}: {e}"
    
        parsed: Optional[Dict[str, Any]] = None
        if not err and status == 200 and data is not None:
            if is_cve:
                vulns = data.get("vulnerabilities") if isinstance(data, dict) else None
                if vulns:
                    parsed = self._parse_nvd_cve(vulns[0].get("cve", {}))
            else:
                parsed = self._parse_osv_vuln(data)
    
        if parsed is None:
            if status == 404 or (not err and status == 200):
                code, ttl = "not_found", self._LOOKUP_TTL
                message = f"未找到该编号的情报: {text}（{source} 无此记录）"
            elif status >= 400:
                code, ttl = "upstream_error", self._LOOKUP_ERR_TTL
                message = f"上游返回 HTTP {status}，暂时取不到 {text} 的情报"
            else:
                code, ttl = "network", self._LOOKUP_ERR_TTL
                message = f"取 {text} 的情报失败：{err or '网络不可达'}"
            result = {"success": False, "cached": False, "code": code, "query": text,
                      "fetched_from": source, "error": message,
                      "elapsed": round(time.time() - started, 3)}
            with self._lock:
                self._lookup_cache[key] = (time.time(), ttl, dict(result))
            return result
    
        # 5) 入库：下次直接本地命中
        vuln = self._store_lookup_result(parsed)
        detail = vuln.to_detail_dict()
        detail["cached"] = False
        detail["fetched_from"] = source
        result = {"success": True, "cached": False, "fetched_from": source, "query": text,
                  "item": detail, "elapsed": round(time.time() - started, 3)}
        with self._lock:
            self._lookup_cache[key] = (time.time(), self._LOOKUP_TTL, dict(result))
        return result

    def intel(self, action: str = "search", **kwargs) -> Dict[str, Any]:
        """漏洞情报统一门面：lookup / search / detail / stats / sources / sync。
    
        lookup 是首选动作：给编号（CVE/GHSA/OSV）就直查这一条的完整情报，本地没有才联网取单条。
        任何异常都收敛成 success=False，绝不把异常抛给模型；
        sync 可能很慢（联网抓取），同步执行并在结果里带上耗时。
        """
        act = str(action or "search").strip().lower()
        actions = ["lookup", "search", "detail", "save", "stats", "sources", "sync"]
        try:
            if act == "lookup":
                query = (kwargs.get("query") or kwargs.get("cve")
                         or kwargs.get("vuln_id") or kwargs.get("local_id") or "")
                result = dict(self.lookup_vulnerability(str(query)))
                result["action"] = act
                return result
            if act == "search":
                result = self.search_as_dicts(**kwargs)
                result["action"] = act
                return result
            if act == "detail":
                query = (kwargs.get("query") or kwargs.get("vuln_id")
                         or kwargs.get("cve") or kwargs.get("local_id") or "")
                if not str(query).strip():
                    return {"success": False, "action": act,
                            "error": "detail 需要提供 query（CVE 编号 / local_id / 标题）"}
                detail = self.get_vulnerability_detail(str(query))
                if detail is None:
                    return {"success": False, "action": act,
                            "error": f"未找到漏洞情报: {query}",
                            "hint": "可先用 action=search 按关键词检索本地已同步的数据"}
                return {"success": True, "action": act, "item": detail}
            if act == "save":
                query = (kwargs.get("query") or kwargs.get("vuln_id")
                         or kwargs.get("cve") or kwargs.get("local_id") or "")
                result = self.save_vulnerability(
                    str(query),
                    status=str(kwargs.get("status") or "saved"),
                    notes=str(kwargs.get("notes") or ""),
                )
                result["action"] = act
                return result
            if act == "stats":
                return {"success": True, "action": act, "stats": self.get_stats()}
            if act == "sources":
                return {"success": True, "action": act, "sources": self.list_feeds()}
            if act == "sync":
                started = time.time()
                sid = str(kwargs.get("source_id") or kwargs.get("feed_id") or "").strip()
                result = self.sync_source(sid) if sid else self.sync_all()
                ok = result.get("success")
                if ok is None:
                    ok = int(result.get("errors", 0) or 0) == 0
                return {"success": bool(ok), "action": act,
                        "elapsed": round(time.time() - started, 2),
                        "source_id": sid, "result": result}
            return {"success": False, "action": act,
                    "error": f"未知 action: {action}", "actions": actions}
        except Exception as e:
            return {"success": False, "action": act, "error": f"漏洞情报操作失败: {e}"}
