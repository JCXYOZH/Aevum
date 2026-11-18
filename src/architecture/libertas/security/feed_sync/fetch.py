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


class FeedFetchMixin:
    """CVE/OSV 解析、URL 构建与源数据抓取。"""

    def _parse_cve_id(self, text: str) -> Optional[str]:
        match = re.search(r'CVE-\d{4}-\d{4,}', text, re.IGNORECASE)
        return match.group(0).upper() if match else None

    def _parse_severity(self, text: str, cvss: float = 0) -> str:
        if cvss >= 9.0:
            return "critical"
        if cvss >= 7.0:
            return "high"
        if cvss >= 4.0:
            return "medium"
        if cvss > 0:
            return "low"
        text_lower = text.lower()
        if "critical" in text_lower or "严重" in text:
            return "critical"
        if "high" in text_lower or "高危" in text:
            return "high"
        if "medium" in text_lower or "中危" in text:
            return "medium"
        if "low" in text_lower or "低危" in text:
            return "low"
        return "medium"

    def _deduplicate(self, vuln: Vulnerability) -> bool:
        """去重检查，返回True表示是新漏洞"""
        vuln.hash = vuln.compute_hash()
        for existing in self._vulnerabilities.values():
            if existing.vuln_id and vuln.vuln_id and existing.vuln_id == vuln.vuln_id:
                existing.last_updated = time.time()
                return False
            if existing.hash == vuln.hash:
                existing.last_updated = time.time()
                return False
        return True

    @staticmethod
    def _parse_nvd_cve(cve: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """把 NVD 的 cve 对象解析成漏洞条目字典。
    
        列表同步（_fetch_feed_data）与单条直查（lookup_vulnerability）共用同一套口径，
        避免「同步进来的」和「按编号查回来的」字段不一致。
        """
        if not isinstance(cve, dict):
            return None
        cve_id = str(cve.get("id", "") or "").strip().upper()
        if not cve_id:
            return None
    
        # 描述：优先中文，其次英文
        desc = ""
        for item in cve.get("descriptions", []) or []:
            lang = str(item.get("lang", "")).lower()
            value = str(item.get("value", "") or "")
            if lang == "zh" and value:
                desc = value
                break
            if lang == "en" and value and not desc:
                desc = value
    
        # 评分与向量
        score = 0.0
        vector = ""
        metrics = cve.get("metrics", {}) or {}
        for mkey in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
            entries = metrics.get(mkey) or []
            if not entries:
                continue
            cvss_data = entries[0].get("cvssData", {}) or {}
            try:
                score = float(cvss_data.get("baseScore", 0) or 0)
            except (TypeError, ValueError):
                score = 0.0
            vector = str(cvss_data.get("vectorString", "") or "")
            break
    
        # CWE：weaknesses[].description[].value 形如 "CWE-79"
        cwe_ids: List[str] = []
        for weakness in cve.get("weaknesses", []) or []:
            for wdesc in weakness.get("description", []) or []:
                value = str(wdesc.get("value", "")).strip().upper()
                if value.startswith("CWE-") and value not in cwe_ids:
                    cwe_ids.append(value)
    
        # 受影响产品：从 configurations 的 cpeMatch.criteria 里取厂商+产品名
        products: List[str] = []
        try:
            for config_item in cve.get("configurations", []) or []:
                for node in config_item.get("nodes", []) or []:
                    for cpe_match in node.get("cpeMatch", []) or []:
                        criteria = str(cpe_match.get("criteria", ""))
                        parts = criteria.split(":")
                        if len(parts) > 4:
                            # CPE 字段里的反斜杠转义要先去掉（chr(92) 就是反斜杠）
                            vendor = parts[3].replace(chr(92), "").strip()
                            name = parts[4].replace(chr(92), "").strip()
                            label = f"{vendor} {name}".strip()
                            if label and label not in products:
                                products.append(label)
        except Exception:
            products = []
    
        # 参考链接 + 利用/补丁标记（NVD 的 references[].tags 里有 Exploit / Patch）
        references: List[str] = []
        exploit_urls: List[str] = []
        patch_urls: List[str] = []
        try:
            for ref in cve.get("references", []) or []:
                url = str(ref.get("url", "") or "").strip()
                if not url:
                    continue
                if url not in references:
                    references.append(url)
                tags = [str(t).lower() for t in (ref.get("tags", []) or [])]
                if any("exploit" in t for t in tags) and url not in exploit_urls:
                    exploit_urls.append(url)
                if any("patch" in t for t in tags) and url not in patch_urls:
                    patch_urls.append(url)
        except Exception:
            pass
    
        # 用 NVD 自己的发布日期，而不是抓取当天：否则按时间检索就失去意义
        published = str(cve.get("published", "") or "")
        if not published:
            published = datetime.now().strftime("%Y-%m-%d")
    
        return {
            "id": cve_id, "title": cve_id,
            "description": desc, "score": score, "cvss_vector": vector,
            "severity": "critical" if score >= 9 else "high" if score >= 7 else "medium" if score >= 4 else "low",
            "link": f"https://nvd.nist.gov/vuln/detail/{cve_id}",
            "source": "NVD", "date": published,
            "cwe": cwe_ids, "products": products,
            "references": references,
            "exploit_available": bool(exploit_urls), "exploit_urls": exploit_urls,
            "patch_available": bool(patch_urls), "patch_urls": patch_urls,
        }

    @staticmethod
    def _parse_osv_vuln(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """把 OSV /v1/vulns/<id> 的单条响应解析成漏洞条目字典（GHSA / PYSEC / OSV…）。"""
        if not isinstance(data, dict):
            return None
        vid = str(data.get("id", "") or "").strip()
        if not vid:
            return None
        summary = str(data.get("summary", "") or "").strip()
        details = str(data.get("details", "") or "").strip()
        database_specific = data.get("database_specific", {}) or {}
    
        score = 0.0
        vector = ""
        for sev in data.get("severity", []) or []:
            vector = str(sev.get("score", "") or "")      # OSV 这里放的是 CVSS 向量串
            break
        cvss = database_specific.get("cvss")
        if isinstance(cvss, dict):
            try:
                score = float(cvss.get("score", 0) or 0)
            except (TypeError, ValueError):
                score = 0.0
            vector = str(cvss.get("vectorString", "") or vector)
    
        sev_text = str(database_specific.get("severity", "") or "").strip().lower()
        if sev_text in ("critical", "high", "medium", "low", "none"):
            severity = sev_text
        else:
            severity = ("critical" if score >= 9 else "high" if score >= 7
                        else "medium" if score >= 4 else "low" if score > 0 else "medium")
    
        cwe_ids = [str(c) for c in (database_specific.get("cwe_ids", []) or []) if c]
        products: List[str] = []
        try:
            for affected in data.get("affected", []) or []:
                pkg = affected.get("package", {}) or {}
                name = str(pkg.get("name", "") or "").strip()
                eco = str(pkg.get("ecosystem", "") or "").strip()
                label = f"{eco} {name}".strip()
                if label and label not in products:
                    products.append(label)
        except Exception:
            products = []
    
        references: List[str] = []
        for ref in data.get("references", []) or []:
            url = str(ref.get("url", "") or "").strip()
            if url and url not in references:
                references.append(url)
    
        tags = ["osv"]
        for alias in data.get("aliases", []) or []:
            alias = str(alias or "").strip()
            if alias and alias not in tags:
                tags.append(alias)          # 把 CVE 别名塞进 tags，关键词检索也能命中
    
        published = str(data.get("published", "") or "") or str(data.get("modified", "") or "")
        return {
            "id": vid, "title": summary or vid,
            "description": details or summary,
            "score": score, "cvss_vector": vector, "severity": severity,
            "link": f"https://osv.dev/vulnerability/{vid}",
            "source": "OSV", "date": published,
            "cwe": cwe_ids, "products": products,
            "references": references, "tags": tags,
            "exploit_available": False, "exploit_urls": [],
            "patch_available": False, "patch_urls": [],
        }

    @staticmethod
    def _build_fetch_url(source: "FeedSource") -> str:
        """拼出真正用于抓取的 URL。
    
        NVD 2.0 API 不带时间窗时返回的是**最早**的一批 CVE（CVE-1999…），
        用户同步完当然检索不到近期情报。这里默认只取最近 30 天，
        并保留 resultsPerPage=200；URL 里已经有 pubStartDate 时一个参数都不加。
        """
        url = str(source.url or "")
        if "nvd.nist.gov" not in url or "pubStartDate" in url:
            return url
        parts: List[str] = []
        if "resultsPerPage=" not in url:
            parts.append("resultsPerPage=200")
        end = datetime.now()
        start = end - timedelta(days=30)
        parts.append("pubStartDate=" + start.strftime("%Y-%m-%dT00:00:00.000"))
        parts.append("pubEndDate=" + end.strftime("%Y-%m-%dT23:59:59.999"))
        sep = "&" if "?" in url else "?"
        return url + sep + "&".join(parts)

    def _fetch_feed_data(self, source: FeedSource) -> List[Dict[str, Any]]:
        """从网络获取漏洞源数据（使用WebScraperEnhancer绕过反爬虫）"""
        items = []
        raw = ""
        try:
            # 优先使用 WebScraperEnhancer（带反爬虫绕过）
            try:
                from ..security.web_scraper_enhancer import WebScraperEnhancer
                scraper = WebScraperEnhancer()
                url = self._build_fetch_url(source)
                page = scraper.fetch(url, bypass_anti_crawl=True, timeout=30)
                if page and page.content and page.status_code == 200:
                    raw = page.content
                    terminal.info(f"使用WebScraperEnhancer获取 [{source.name}] 成功，状态码: {page.status_code}", "feed_sync")
                else:
                    err = page.error if page else "unknown"
                    terminal.warn(f"WebScraperEnhancer获取 [{source.name}] 失败: {err}，回退到urllib", "feed_sync")
            except ImportError:
                terminal.warn("WebScraperEnhancer未找到，使用urllib", "feed_sync")
            except Exception as e:
                terminal.warn(f"WebScraperEnhancer出错: {e}，回退到urllib", "feed_sync")
    
            # 回退方案：urllib（带更好的请求头）
            if not raw:
                import urllib.request
                import ssl
                import random
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                # 随机User-Agent
                ua_list = [
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                ]
                url = self._build_fetch_url(source)
                req = urllib.request.Request(url, headers={
                    "User-Agent": random.choice(ua_list),
                    "Accept": "application/json, text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                    "Connection": "keep-alive",
                    "Upgrade-Insecure-Requests": "1",
                })
                with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
                    resp_data = resp.read()
                    # 检查是否是gzip压缩
                    if resp.headers.get('Content-Encoding') == 'gzip':
                        import gzip
                        resp_data = gzip.decompress(resp_data)
                    raw = resp_data.decode("utf-8", errors="replace")
                terminal.info(f"使用urllib获取 [{source.name}] 成功，长度: {len(raw)}", "feed_sync")
    
            source_name = source.name.upper()
    
            # NVD API 格式解析
            if "NVD" in source_name:
                try:
                    data = json.loads(raw)
                    for vuln in data.get("vulnerabilities", [])[:200]:
                        from .manager import FeedSyncManager
                        parsed = FeedSyncManager._parse_nvd_cve(vuln.get("cve", {}))
                        if parsed:
                            items.append(parsed)
                except Exception as e:
                    terminal.warn(f"NVD解析失败: {e}", "feed_sync")
    
            # CISA KEV 格式解析
            elif "CISA" in source_name or "KEV" in source_name:
                try:
                    data = json.loads(raw)
                    for v in data.get("vulnerabilities", [])[:200]:
                        items.append({
                            "id": v.get("cveID", ""),
                            "title": v.get("vulnerabilityName", v.get("cveID", "")),
                            "description": v.get("shortDescription", ""),
                            "score": 0, "severity": "critical",
                            "link": f"https://nvd.nist.gov/vuln/detail/{v.get('cveID','')}",
                            "source": "CISA-KEV", "date": v.get("dateAdded", ""),
                            "products": [v.get("vendorProject", "")],
                        })
                except Exception as e:
                    terminal.warn(f"CISA解析失败: {e}", "feed_sync")
    
            # RSS 格式解析（CNVD、Exploit-DB等）
            elif source.source_type == "rss" or "CNVD" in source_name:
                try:
                    import re
                    titles = re.findall(r"<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>", raw, re.DOTALL)
                    links = re.findall(r"<link>(.*?)</link>", raw, re.DOTALL)
                    descriptions = re.findall(r"<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</description>", raw, re.DOTALL)
                    for i, title in enumerate(titles[1:101]):  # 跳过第一个（频道标题）
                        items.append({
                            "id": f"{source.name}_{i}",
                            "title": title.strip()[:200],
                            "description": descriptions[i+1].strip()[:500] if i+1 < len(descriptions) else "",
                            "score": 0, "severity": "medium",
                            "link": links[i+1].strip() if i+1 < len(links) else "",
                            "source": source.name,
                            "date": datetime.now().strftime("%Y-%m-%d"),
                        })
                except Exception as e:
                    terminal.warn(f"RSS解析失败: {e}", "feed_sync")
    
            # OSV 格式解析
            elif "OSV" in source_name:
                try:
                    # OSV需要POST查询，这里获取最新的漏洞
                    import urllib.request
                    post_data = json.dumps({"version": "1.0.0", "package": {"name": "linux", "ecosystem": "Linux"}}).encode()
                    req2 = urllib.request.Request(source.url, data=post_data, headers={
                        "User-Agent": "Libertas-FeedSync/1.0",
                        "Content-Type": "application/json",
                    })
                    ctx2 = ssl.create_default_context()
                    ctx2.check_hostname = False
                    ctx2.verify_mode = ssl.CERT_NONE
                    with urllib.request.urlopen(req2, timeout=30, context=ctx2) as resp2:
                        osv_raw = resp2.read().decode("utf-8", errors="replace")
                    data = json.loads(osv_raw)
                    for v in data.get("vulns", [])[:100]:
                        items.append({
                            "id": v.get("id", ""),
                            "title": v.get("summary", v.get("id", ""))[:200],
                            "description": v.get("details", ""),
                            "score": 0,
                            "severity": "high",
                            "link": v.get("references", [{}])[0].get("url", "") if v.get("references") else "",
                            "source": "OSV",
                            "date": v.get("modified", ""),
                        })
                except Exception as e:
                    terminal.warn(f"OSV解析失败: {e}", "feed_sync")
    
            # GitHub Advisories HTML 格式解析
            elif "GITHUB" in source_name or source.source_type == "html":
                try:
                    import re
                    advisories = re.findall(r'href="(/advisories/[^"]+)"[^>]*>([^<]+)</a>', raw)
                    seen = set()
                    for path, name in advisories[:100]:
                        if path not in seen:
                            seen.add(path)
                            items.append({
                                "id": path,
                                "title": name.strip()[:200],
                                "description": name.strip(),
                                "score": 0,
                                "severity": "medium",
                                "link": f"https://github.com{path}",
                                "source": "GitHub Advisories",
                                "date": datetime.now().strftime("%Y-%m-%d"),
                            })
                except Exception as e:
                    terminal.warn(f"GitHub Advisories解析失败: {e}", "feed_sync")
    
            # 通用 JSON 格式解析
            elif source.source_type in ("json", "api"):
                try:
                    data = json.loads(raw)
                    # 尝试多种常见格式
                    vuln_list = (data.get("vulnerabilities") or
                                  data.get("results") or
                                  data.get("items") or
                                  data.get("CVE_Items") or
                                  data.get("vulns") or [])
                    if isinstance(vuln_list, list):
                        for v in vuln_list[:200]:
                            cve = v.get("cve", {}) if isinstance(v, dict) else {}
                            items.append({
                                "id": v.get("id", cve.get("id", "")),
                                "title": v.get("title", v.get("name", v.get("summary", cve.get("id", ""))))[:200],
                                "description": v.get("description", v.get("details", "")),
                                "score": float(v.get("cvss", v.get("score", 0))),
                                "severity": v.get("severity", "medium"),
                                "link": v.get("link", v.get("url", "")),
                                "source": source.name,
                                "date": v.get("date", v.get("published", v.get("modified", ""))),
                            })
                except Exception as e:
                    terminal.warn(f"JSON解析失败 [{source.name}]: {e}, 响应内容前100字符: {raw[:100]}", "feed_sync")
    
        except Exception as e:
            terminal.error(f"获取漏洞源数据失败 [{source.name}]: {e}", "feed_sync")
    
        return items
