"""
安全专项搜索工具：CVE漏洞、证书透明度、Wayback历史URL、Shodan网络空间。
统一返回 [{"title","url","snippet","extra"?}] 格式，可被 search_orchestrator 直接使用。
"""
import json
import time
import logging
import urllib.parse
from typing import List, Dict, Any, Optional
from libertas.foundation.config import get_data_dir

logger = logging.getLogger(__name__)

_DATA_DIR_CACHE = None

def _get_cache_dir() -> str:
    import os
    global _DATA_DIR_CACHE
    if _DATA_DIR_CACHE:
        return _DATA_DIR_CACHE
    d = get_data_dir()
    os.makedirs(d, exist_ok=True)
    _DATA_DIR_CACHE = d
    return d


def _cache_get(key: str, ttl: int = 86400 * 7) -> Optional[Any]:
    import os
    cache_file = os.path.join(_get_cache_dir(), "cve_cache.json")
    try:
        if os.path.exists(cache_file):
            with open(cache_file, "r", encoding="utf-8") as f:
                cache = json.load(f)
            entry = cache.get(key)
            if entry and (time.time() - entry.get("ts", 0)) < ttl:
                return entry.get("data")
    except Exception:
        pass
    return None


def _cache_put(key: str, data: Any):
    import os
    cache_file = os.path.join(_get_cache_dir(), "cve_cache.json")
    try:
        cache = {}
        if os.path.exists(cache_file):
            with open(cache_file, "r", encoding="utf-8") as f:
                cache = json.load(f)
        cache[key] = {"ts": time.time(), "data": data}
        if len(cache) > 5000:
            cache = dict(list(cache.items())[-5000:])
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
    except Exception:
        pass


def _safe_get(url, params=None, headers=None, timeout=8):
    import requests
    h = {"User-Agent": "MrHua-SecurityScanner/1.0", "Accept": "application/json"}
    if headers:
        h.update(headers)
    return requests.get(url, params=params, headers=h, timeout=timeout)


# ============================================================
# CVE 搜索（NVD API 2.0，免费无需key）
# ============================================================
def search_cve(query: str, max_results: int = 8) -> List[Dict]:
    """搜索CVE漏洞。query可以是CVE编号或产品关键词。"""
    import re
    results = []
    cve_match = re.search(r'CVE-\d{4}-\d{4,7}', query, re.IGNORECASE)
    if cve_match:
        cve_id = cve_match.group(0).upper()
        cached = _cache_get(f"cve:{cve_id}")
        if cached:
            return cached[:max_results]
        try:
            resp = _safe_get(f"https://services.nvd.nist.gov/rest/json/cves/2.0",
                             params={"cveId": cve_id}, timeout=10)
            data = resp.json()
            for vuln in data.get("vulnerabilities", [])[:max_results]:
                cve = vuln.get("cve", {})
                desc = ""
                for d in cve.get("descriptions", []):
                    if d.get("lang") == "zh" or d.get("lang") == "en":
                        desc = d.get("value", "")
                        if d.get("lang") == "en":
                            break
                metrics = cve.get("metrics", {})
                cvss = 0.0
                for mkey in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
                    if mkey in metrics and metrics[mkey]:
                        cvss = metrics[mkey][0].get("cvssData", {}).get("baseScore", 0.0)
                        break
                refs = [r.get("url", "") for r in cve.get("references", [])[:3]]
                results.append({
                    "title": f"{cve_id} (CVSS: {cvss})",
                    "url": f"https://nvd.nist.gov/vuln/detail/{cve_id}",
                    "snippet": desc[:300],
                    "extra": {"cve_id": cve_id, "cvss": cvss, "references": refs,
                              "source": "nvd", "type": "cve"},
                })
            _cache_put(f"cve:{cve_id}", results)
        except Exception as e:
            logger.warning(f"CVE search failed: {e}")
    else:
        cache_key = f"cve_search:{query.lower().strip()}"
        cached = _cache_get(cache_key, ttl=86400)
        if cached:
            return cached[:max_results]
        try:
            resp = _safe_get("https://services.nvd.nist.gov/rest/json/cves/2.0",
                             params={"keywordSearch": query, "resultsPerPage": max_results},
                             timeout=10)
            data = resp.json()
            for vuln in data.get("vulnerabilities", [])[:max_results]:
                cve = vuln.get("cve", {})
                cve_id = cve.get("id", "")
                desc = ""
                for d in cve.get("descriptions", []):
                    if d.get("lang") == "en":
                        desc = d.get("value", "")
                        break
                metrics = cve.get("metrics", {})
                cvss = 0.0
                for mkey in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
                    if mkey in metrics and metrics[mkey]:
                        cvss = metrics[mkey][0].get("cvssData", {}).get("baseScore", 0.0)
                        break
                results.append({
                    "title": f"{cve_id} (CVSS: {cvss})",
                    "url": f"https://nvd.nist.gov/vuln/detail/{cve_id}",
                    "snippet": desc[:300],
                    "extra": {"cve_id": cve_id, "cvss": cvss, "source": "nvd", "type": "cve"},
                })
            _cache_put(cache_key, results)
        except Exception as e:
            logger.warning(f"CVE keyword search failed: {e}")
    return results


# ============================================================
# crt.sh 证书透明度（子域名发现）
# ============================================================
def search_crtsh(domain: str, max_results: int = 50) -> List[Dict]:
    """从crt.sh查询域名的证书透明度日志，返回子域名列表。"""
    domain = domain.strip().lower()
    if not domain:
        return []
    cache_key = f"crtsh:{domain}"
    cached = _cache_get(cache_key, ttl=3600)
    if cached:
        return cached[:max_results]
    results = []
    try:
        resp = _safe_get("https://crt.sh/",
                         params={"q": f"%.{domain}", "output": "json"},
                         headers={"Accept": "application/json"}, timeout=12)
        entries = resp.json()
        subdomains = set()
        for entry in entries:
            name = entry.get("name_value", "")
            for n in name.split("\n"):
                n = n.strip().lower().lstrip("*.")
                if n and domain in n and " " not in n:
                    subdomains.add(n)
        for sub in sorted(subdomains)[:max_results]:
            results.append({
                "title": sub,
                "url": f"https://{sub}",
                "snippet": f"子域名 (证书透明度日志)",
                "extra": {"subdomain": sub, "source": "crtsh", "type": "subdomain"},
            })
        _cache_put(cache_key, results)
    except Exception as e:
        logger.warning(f"crt.sh search failed: {e}")
    return results


# ============================================================
# Wayback Machine 历史URL
# ============================================================
def search_wayback(domain: str, max_results: int = 50) -> List[Dict]:
    """从Wayback Machine CDX API查询历史URL。"""
    domain = domain.strip().lower()
    if not domain:
        return []
    if "://" in domain:
        domain = domain.split("://", 1)[1].rstrip("/")
    cache_key = f"wayback:{domain}"
    cached = _cache_get(cache_key, ttl=86400)
    if cached:
        return cached[:max_results]
    results = []
    try:
        from .web_search import resolve_redirect_urls
        resp = _safe_get("http://web.archive.org/cdx/search/cdx",
                         params={
                             "url": f"*.{domain}/*",
                             "output": "json",
                             "fl": "timestamp,original,statuscode,mimetype",
                             "filter": "statuscode:200",
                             "collapse": "urlkey",
                             "limit": str(max_results * 2),
                         }, timeout=15)
        rows = resp.json()
        if len(rows) > 1:
            for row in rows[1:]:
                ts, original, status, mime = row[0], row[1], row[2], row[3]
                if any(x in mime for x in ("html", "json", "xml", "text")):
                    year = ts[:4]
                    month = ts[4:6]
                    results.append({
                        "title": original[:100],
                        "url": original,
                        "snippet": f"历史快照 {year}-{month} (HTTP {status}, {mime})",
                        "extra": {"timestamp": ts, "status": status,
                                  "mimetype": mime, "source": "wayback",
                                  "type": "historical_url"},
                    })
        results = results[:max_results]
        _cache_put(cache_key, results)
    except Exception as e:
        logger.warning(f"Wayback search failed: {e}")
    return results


# ============================================================
# Shodan 网络空间搜索（需API key）
# ============================================================
def search_shodan(query: str, max_results: int = 10) -> List[Dict]:
    """Shodan搜索。需要在设置中配置shodan_api_key。"""
    import os
    api_key = os.environ.get("SHODAN_API_KEY", "")
    if not api_key:
        try:
            from libertas.data.system_settings import get_setting
            api_key = get_setting("shodan_api_key", "")
        except Exception:
            pass
    if not api_key:
        return []
    cache_key = f"shodan:{query.lower().strip()}"
    cached = _cache_get(cache_key, ttl=3600)
    if cached:
        return cached[:max_results]
    results = []
    try:
        import ipaddress
        is_ip = False
        try:
            ipaddress.ip_address(query)
            is_ip = True
        except ValueError:
            pass
        if is_ip:
            resp = _safe_get(f"https://api.shodan.io/shodan/host/{query}",
                             params={"key": api_key}, timeout=10)
            data = resp.json()
            for svc in data.get("data", [])[:max_results]:
                port = svc.get("port", 0)
                product = svc.get("product", svc.get("_shodan", {}).get("module", "unknown"))
                version = svc.get("version", "")
                banner = (svc.get("data", "") or "")[:200]
                results.append({
                    "title": f"{query}:{port} — {product} {version}",
                    "url": f"http://{query}:{port}",
                    "snippet": banner.strip(),
                    "extra": {"ip": query, "port": port, "service": product,
                              "version": version, "source": "shodan", "type": "host"},
                })
        else:
            resp = _safe_get("https://api.shodan.io/shodan/host/search",
                             params={"key": api_key, "query": query,
                                     "limit": min(max_results, 100)}, timeout=10)
            data = resp.json()
            for match in data.get("matches", [])[:max_results]:
                ip = match.get("ip_str", "")
                port = match.get("port", 0)
                product = match.get("product", "")
                version = match.get("version", "")
                org = match.get("org", "")
                results.append({
                    "title": f"{ip}:{port} — {product} {version}".strip(),
                    "url": f"http://{ip}:{port}",
                    "snippet": f"[{org}] {match.get('data', '')[:200]}".strip(),
                    "extra": {"ip": ip, "port": port, "service": product,
                              "version": version, "org": org,
                              "source": "shodan", "type": "host"},
                })
        _cache_put(cache_key, results)
    except Exception as e:
        logger.warning(f"Shodan search failed: {e}")
    return results


# ============================================================
# 意图识别：判断查询应该路由到哪个专项引擎
# ============================================================
def detect_security_intent(query: str) -> Optional[str]:
    """识别安全搜索意图。返回引擎名或None（走通用搜索）。"""
    import re
    q = query.strip()
    if not q:
        return None
    if re.search(r'CVE-\d{4}-\d{4,7}', q, re.IGNORECASE):
        return "cve"
    if re.search(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', q):
        if any(k in q.lower() for k in ("shodan", "fofa", "zoomeye", "端口", "服务", "banner", "开放")):
            return "shodan"
        if any(k in q.lower() for k in ("cve", "漏洞", "vuln", "exploit")):
            return "cve"
    if re.search(r'(子域名|subdomain|crt\.?sh|证书透明|certificate transparency)', q, re.IGNORECASE):
        return "crtsh"
    if re.search(r'(wayback|历史url|历史记录|历史快照|archive\.org|网页存档)', q, re.IGNORECASE):
        return "wayback"
    if re.search(r'(shodan|fofa|zoomeye|censys|网络空间|网络空间测绘)', q, re.IGNORECASE):
        return "shodan"
    if re.search(r'(github.*(泄露|密钥|硬编码|token|secret)|dorking)', q, re.IGNORECASE):
        return None
    if re.search(r'(漏洞|vulnerability|exploit|exp|poc|CVE)\b', q, re.IGNORECASE) and len(q) < 60:
        return "cve"
    domain_match = re.search(r'([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)', q)
    if domain_match:
        domain = domain_match.group(1)
        if any(k in q for k in ("子域名", "subdomain", "crt")):
            return "crtsh"
        if any(k in q.lower() for k in ("wayback", "历史", "archive")):
            return "wayback"
    return None


def extract_domain(query: str) -> str:
    """从查询中提取域名。"""
    import re
    q = query.strip()
    q = re.sub(r'^https?://', '', q)
    q = q.split("/")[0].split("?")[0]
    m = re.search(r'([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)', q)
    return m.group(1) if m else q


SECURITY_SEARCH_ENGINES = {
    "cve": search_cve,
    "crtsh": lambda q, n: search_crtsh(extract_domain(q), n),
    "wayback": lambda q, n: search_wayback(extract_domain(q), n),
    "shodan": search_shodan,
}
