# tools/native_tools.py
"""
原生网络安全工具 - 纯Python标准库实现，不依赖外部工具安装
支持跨平台（Windows/macOS/Linux）

每个工具返回统一格式：
{
    "success": bool,
    "tool": str,
    "target": str,
    "data": Any,
    "raw_output": str,
    "scan_time": str,
    "error": str (可选)
}
"""
import os
import re
import ssl
import sys
import json
import time
import socket
import struct
import shutil
import platform
import inspect
import subprocess
import threading
import urllib.request
import urllib.error
from typing import Dict, List, Any, Optional, Callable
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeout
from datetime import datetime
from libertas.utils.text_decode import decode_output

from .constants import *


def native_http_methods(url: str, timeout: float = 10) -> Dict[str, Any]:
    """枚举目标支持的HTTP方法（增强版：19种方法，WebDAV检测，利用建议）"""
    if not url.startswith("http"):
        url = "http://" + url
    methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD",
               "TRACE", "CONNECT", "MOVE", "COPY", "MKCOL", "PROPFIND",
               "PROPPATCH", "LOCK", "UNLOCK", "SEARCH", "DEBUG", "TRACK"]
    dangerous = {"PUT": "可上传任意文件，可能导致Webshell",
                 "DELETE": "可删除服务器文件",
                 "TRACE": "可触发XST攻击，窃取Cookie",
                 "CONNECT": "可建立隧道代理",
                 "PATCH": "可修改资源，可能导致未授权修改",
                 "MOVE": "WebDAV方法，可移动文件",
                 "COPY": "WebDAV方法，可复制文件",
                 "MKCOL": "WebDAV方法，可创建目录",
                 "PROPFIND": "WebDAV方法，可枚举目录和文件",
                 "PROPPATCH": "WebDAV方法，可修改文件属性",
                 "LOCK": "WebDAV方法，可锁定文件",
                 "UNLOCK": "WebDAV方法，可解锁文件",
                 "SEARCH": "WebDAV方法，可搜索服务器内容"}
    results = []
    try:
        allow_header = ""
        # 先尝试OPTIONS获取Allow头
        try:
            req = urllib.request.Request(url, method="OPTIONS",
                                         headers={"User-Agent": "Mozilla/5.0 (MrHua Scanner/2.0)"})
            resp = urllib.request.urlopen(req, timeout=timeout)
            allow_header = resp.headers.get("Allow", "")
            if allow_header:
                results.append({"method": "OPTIONS(Allow)", "status": resp.status,
                                "allow": allow_header, "risky": False})
        except Exception:
            pass
        # 逐个测试方法
        for method in methods:
            try:
                req = urllib.request.Request(url, method=method,
                                             headers={"User-Agent": "Mozilla/5.0 (MrHua Scanner/2.0)"})
                resp = urllib.request.urlopen(req, timeout=timeout)
                status = resp.status
            except urllib.error.HTTPError as e:
                status = e.code
            except Exception:
                continue
            is_supported = status not in (405, 501)
            risky = method in dangerous and is_supported
            results.append({"method": method, "status": status, "supported": is_supported,
                            "risky": risky, "risk_desc": dangerous.get(method, "")})
        risky_methods = [r for r in results if r.get("risky")]
        supported = [r["method"] for r in results if r.get("supported")]
        webdav_methods = ["MOVE", "COPY", "MKCOL", "PROPFIND", "PROPPATCH", "LOCK", "UNLOCK", "SEARCH"]
        webdav_enabled = [m for m in webdav_methods if m in supported]
        # 风险评级
        if any(r["method"] in ("PUT", "DELETE", "TRACE", "CONNECT") for r in risky_methods):
            risk_level = "严重"
        elif risky_methods:
            risk_level = "高风险"
        elif webdav_enabled:
            risk_level = "中风险"
        else:
            risk_level = "安全"
        raw = f"目标: {url}\n支持方法: {len(supported)}/{len(methods)}\n风险等级: {risk_level}\n"
        if allow_header:
            raw += f"Allow头: {allow_header}\n"
        raw += "\n方法测试结果:\n"
        for r in results:
            if r["method"] == "OPTIONS(Allow)":
                raw += f"  OPTIONS(Allow头): {r.get('allow', '')}\n"
                continue
            flag = " ⚠️ 危险!" if r.get("risky") else (" ✅" if r.get("supported") else " ❌")
            raw += f"  {r['method']:10s} → {r['status']}{flag}\n"
            if r.get("risk_desc") and r.get("risky"):
                raw += f"             风险: {r['risk_desc']}\n"
        if webdav_enabled:
            raw += f"\nWebDAV启用: {', '.join(webdav_enabled)}\n"
        return _result("http_methods", url, True,
                       data={"url": url, "methods": results, "supported": supported,
                             "risky": risky_methods, "allow_header": allow_header,
                             "webdav_enabled": webdav_enabled, "risk_level": risk_level}, raw=raw)
    except Exception as e:
        return _result("http_methods", url, False, error=str(e))

def native_backup_finder(url: str, timeout: float = 5, max_workers: int = 10,
                         overall_timeout: int = 60) -> Dict[str, Any]:
    """扫描网站常见备份文件"""
    if not url.startswith("http"):
        url = "http://" + url
    from urllib.parse import urlparse
    parsed = urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path or "/"
    # 从路径提取文件名基础名
    base_name = os.path.basename(path) if path != "/" else ""
    name_no_ext = os.path.splitext(base_name)[0] if base_name else "index"
    backup_exts = [".bak", ".old", ".backup", ".swp", ".swo", "~", ".orig", ".save",
                   ".tmp", ".temp", ".copy", ".txt", ".zip", ".tar.gz", ".rar", ".7z",
                   ".sql", ".db", ".sqlite", ".log", ".dist", ".example"]
    backup_names = []
    # 基于当前路径生成备份文件名
    if base_name:
        for ext in backup_exts:
            backup_names.append(path + ext)
            backup_names.append(path + "/" + base_name + ext)
    # 通用备份文件名
    common = ["/backup.zip", "/backup.tar.gz", "/backup.rar", "/www.zip", "/wwwroot.zip",
              "/web.zip", "/site.zip", "/html.zip", "/db.sql", "/database.sql",
              "/dump.sql", "/backup.sql", "/.git/config", "/.svn/entries", "/.env",
              "/config.php.bak", "/web.config.bak", "/wp-config.php.bak",
              "/.DS_Store", "/crossdomain.xml", "/phpinfo.php", "/test.php",
              "/admin.zip", "/1.zip", "/a.zip"]
    backup_names.extend(common)
    backup_names = list(dict.fromkeys(backup_names))  # 去重

    found = []
    tested = 0
    start = time.time()
    lock = threading.Lock()

    def check_path(bp):
        nonlocal tested
        if is_cancelled() or time.time() - start > overall_timeout:
            return
        try:
            target = base + bp
            req = urllib.request.Request(target, headers={"User-Agent": "Mozilla/5.0 (MrHua Scanner)"})
            resp = urllib.request.urlopen(req, timeout=timeout)
            ct = resp.headers.get("Content-Type", "")
            size = len(resp.read(4096))
            with lock:
                tested += 1
            if resp.status == 200 and size > 0:
                found.append({"path": bp, "status": 200, "size": size,
                              "content_type": ct, "url": target})
        except urllib.error.HTTPError:
            with lock:
                tested += 1
        except Exception:
            with lock:
                tested += 1

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(check_path, bp) for bp in backup_names]
        for f in as_completed(futures, timeout=overall_timeout):
            try:
                f.result()
            except Exception:
                pass
    elapsed = time.time() - start
    raw = f"扫描 {tested} 个路径，发现 {len(found)} 个备份文件\n"
    for f in found:
        raw += f"  📁 {f['path']} ({f['size']} bytes) {f['content_type']}\n"
    return _result("backup_finder", url, True,
                   data={"url": url, "found": found, "tested": tested,
                         "elapsed": round(elapsed, 2)}, raw=raw)

def native_link_extractor(url: str, timeout: float = 15) -> Dict[str, Any]:
    """提取网页中的所有链接"""
    if not url.startswith("http"):
        url = "http://" + url
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (MrHua Scanner)"})
        resp = urllib.request.urlopen(req, timeout=timeout)
        body = resp.read().decode("utf-8", errors="replace")
        from urllib.parse import urljoin
        links = set()
        for m in re.finditer(r'href=["\']([^"\']+)["\']', body, re.IGNORECASE):
            links.add(urljoin(url, m.group(1)))
        for m in re.finditer(r'src=["\']([^"\']+)["\']', body, re.IGNORECASE):
            links.add(urljoin(url, m.group(1)))
        internal = []
        external = []
        from urllib.parse import urlparse
        domain = urlparse(url).netloc
        for link in sorted(links):
            if urlparse(link).netloc == domain:
                internal.append(link)
            else:
                external.append(link)
        raw = f"内部链接 ({len(internal)}):\n"
        for l in internal[:30]:
            raw += f"  {l}\n"
        raw += f"\n外部链接 ({len(external)}):\n"
        for l in external[:30]:
            raw += f"  {l}\n"
        return _result("link_extractor", url, True,
                       data={"url": url, "internal": internal, "external": external,
                             "total": len(links)}, raw=raw)
    except Exception as e:
        return _result("link_extractor", url, False, error=str(e))

def native_directory_listing(url: str, timeout: float = 10) -> Dict[str, Any]:
    """检测网站是否开启目录列表"""
    if not url.startswith("http"):
        url = "http://" + url
    test_paths = ["/", "/images/", "/img/", "/css/", "/js/", "/uploads/",
                  "/files/", "/assets/", "/static/", "/media/", "/backup/"]
    findings = []
    try:
        for path in test_paths:
            try:
                target = url.rstrip("/") + path
                req = urllib.request.Request(target, headers={"User-Agent": "Mozilla/5.0"})
                resp = urllib.request.urlopen(req, timeout=timeout)
                body = resp.read(4096).decode("utf-8", errors="replace").lower()
                if "index of /" in body or "<title>index of" in body or "directory listing for" in body:
                    findings.append({"path": path, "vulnerable": True, "url": target})
            except Exception:
                continue
        raw = f"检测 {len(test_paths)} 个路径，发现 {len(findings)} 个目录列表:\n"
        for f in findings:
            raw += f"  📂 {f['url']}\n"
        return _result("directory_listing", url, True,
                       data={"url": url, "findings": findings, "vulnerable": len(findings) > 0},
                       raw=raw)
    except Exception as e:
        return _result("directory_listing", url, False, error=str(e))

def native_http_compare(url: str, timeout: float = 10) -> Dict[str, Any]:
    """对比HTTP和HTTPS响应差异，检测安全问题"""
    results = {}
    try:
        for scheme in ("http", "https"):
            target = scheme + "://" + url.replace("https://", "").replace("http://", "")
            try:
                req = urllib.request.Request(target, headers={"User-Agent": "Mozilla/5.0"})
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                resp = urllib.request.urlopen(req, timeout=timeout, context=ctx)
                results[scheme] = {"status": resp.status, "url": resp.geturl(),
                                   "headers": dict(resp.headers)}
            except Exception as e:
                results[scheme] = {"error": str(e)}
        findings = []
        if results.get("http", {}).get("status") == 200:
            if not results["http"].get("url", "").startswith("https"):
                findings.append("HTTP可访问且未重定向到HTTPS")
        if results.get("https", {}).get("status"):
            hsts = results["https"].get("headers", {}).get("Strict-Transport-Security", "")
            if not hsts:
                findings.append("HTTPS未设置HSTS头")
        raw = f"HTTP: {results.get('http', {}).get('status', 'N/A')}\n"
        raw += f"HTTPS: {results.get('https', {}).get('status', 'N/A')}\n"
        for f in findings:
            raw += f"  ⚠️ {f}\n"
        return _result("http_compare", url, True,
                       data={"url": url, "http": results.get("http"),
                             "https": results.get("https"), "findings": findings}, raw=raw)
    except Exception as e:
        return _result("http_compare", url, False, error=str(e))

def native_comment_scraper(url: str, timeout: float = 15) -> Dict[str, Any]:
    """抓取网页中的HTML注释（常含开发者备注、调试信息、凭证）"""
    if not url.startswith("http"):
        url = "http://" + url
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (MrHua Scanner)"})
        resp = urllib.request.urlopen(req, timeout=timeout)
        body = resp.read().decode("utf-8", errors="replace")
        comments = re.findall(r"<!--(.*?)-->", body, re.DOTALL)
        interesting = []
        keywords = ["todo", "fixme", "hack", "xxx", "bug", "password", "secret", "key",
                    "token", "admin", "debug", "test", "deprecated", "temp", "backup",
                    "api", "credential", "auth", "user", "email", "database", "config"]
        for c in comments:
            text = c.strip()
            if len(text) < 2:
                continue
            is_interesting = any(kw in text.lower() for kw in keywords)
            interesting.append({"text": text[:500], "interesting": is_interesting})
        flagged = [c for c in interesting if c["interesting"]]
        raw = f"发现 {len(comments)} 个注释，{len(flagged)} 个可能包含敏感信息\n"
        for c in interesting[:30]:
            prefix = "[!!] " if c["interesting"] else "     "
            raw += f"{prefix}{c['text'][:100]}\n"
        return _result("comment_scraper", url, True,
                       data={"url": url, "total_comments": len(comments),
                             "interesting": flagged, "all_comments": interesting[:100]}, raw=raw)
    except Exception as e:
        return _result("comment_scraper", url, False, error=str(e))

def native_js_endpoint_finder(url: str, timeout: float = 20) -> Dict[str, Any]:
    """从页面和JS文件中提取API端点"""
    if not url.startswith("http"):
        url = "http://" + url
    from urllib.parse import urljoin, urlparse
    endpoints = set()
    js_files = set()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (MrHua Scanner)"})
        resp = urllib.request.urlopen(req, timeout=timeout)
        body = resp.read().decode("utf-8", errors="replace")
        for m in re.finditer(r'src=["\']([^"\']+\.js[^"\']*)["\']', body, re.IGNORECASE):
            js_files.add(urljoin(url, m.group(1)))
        for pattern in [r'["\']/(api/[^"\']+)["\']', r'["\'](/v\d/[^"\']+)["\']',
                        r'fetch\(["\']([^"\']+)["\']', r'axios\.[a-z]+\(["\']([^"\']+)["\']',
                        r'url:\s*["\']([^"\']+)["\']', r'endpoint["\']?\s*[:=]\s*["\']([^"\']+)["\']']:
            for m in re.finditer(pattern, body, re.IGNORECASE):
                ep = m.group(1)
                if not ep.startswith("http") or urlparse(url).netloc in ep:
                    endpoints.add(ep)
        for js_url in list(js_files)[:10]:
            try:
                req2 = urllib.request.Request(js_url, headers={"User-Agent": "Mozilla/5.0"})
                resp2 = urllib.request.urlopen(req2, timeout=timeout)
                js_body = resp2.read().decode("utf-8", errors="replace")
                for pattern in [r'["\']/(api/[^"\']{3,80})["\']', r'["\'](/v\d/[^"\']{3,80})["\']',
                                r'["\']https?://[^"\']*/(api/[^"\']{3,80})["\']']:
                    for m in re.finditer(pattern, js_body):
                        ep = m.group(1)
                        endpoints.add("/" + ep if not ep.startswith("/") else ep)
            except Exception:
                continue
        ep_list = sorted(endpoints)
        raw = f"JS文件: {len(js_files)}个\n发现API端点: {len(ep_list)}个\n"
        for ep in ep_list[:50]:
            raw += f"  {ep}\n"
        return _result("js_endpoint_finder", url, True,
                       data={"url": url, "js_files": list(js_files)[:30],
                             "endpoints": ep_list, "count": len(ep_list)}, raw=raw)
    except Exception as e:
        return _result("js_endpoint_finder", url, False, error=str(e))

def native_web_crawler(url: str, max_pages: int = 20, max_depth: int = 2,
                       same_domain: bool = True, timeout: float = 10,
                       overall_timeout: float = 60) -> Dict[str, Any]:
    """简单网页爬虫，收集页面标题、链接和表单

    抓不到的页面不再静默吞掉：逐个 URL 记录失败原因（errors），
    success 反映"是否至少取到 1 页"；overall_timeout 是整轮抓取的总预算，
    避免在不可达站点上被 max_pages × timeout 拖住。
    """
    if not url.startswith("http"):
        url = "http://" + url
    from urllib.parse import urljoin, urlparse
    base_domain = urlparse(url).netloc
    visited = set()
    to_visit = [(url, 0)]
    pages = []
    errors: List[Dict[str, str]] = []
    start = time.time()
    budget_exceeded = False
    while to_visit and len(visited) < max_pages and not is_cancelled():
        if time.time() - start > overall_timeout:
            budget_exceeded = True
            break
        current, depth = to_visit.pop(0)
        if current in visited or depth > max_depth:
            continue
        visited.add(current)
        try:
            req = urllib.request.Request(current, headers={"User-Agent": "Mozilla/5.0 (MrHua Crawler)"})
            resp = urllib.request.urlopen(req, timeout=timeout)
            body = resp.read(65536).decode("utf-8", errors="replace")
            title_m = re.search(r"<title>(.*?)</title>", body, re.I | re.DOTALL)
            title = title_m.group(1).strip() if title_m else ""
            forms = len(re.findall(r"<form", body, re.I))
            inputs = len(re.findall(r"<input", body, re.I))
            links = re.findall(r'href=["\']([^"\']+)["\']', body, re.I)
            abs_links = [urljoin(current, l) for l in links if not l.startswith(("#", "javascript:", "mailto:"))]
            pages.append({"url": current, "title": title, "status": resp.status,
                          "forms": forms, "inputs": inputs, "links_count": len(abs_links),
                          "depth": depth, "size": len(body)})
            if depth < max_depth:
                for link in abs_links:
                    if link not in visited and len(visited) + len(to_visit) < max_pages * 2:
                        if not same_domain or urlparse(link).netloc == base_domain:
                            to_visit.append((link, depth + 1))
        except Exception as e:
            # 单个页面抓不到是常态：记录原因后继续，不影响整轮抓取
            errors.append({"url": current, "error": _short_url_error(e),
                           "type": type(e).__name__})
            continue
    elapsed = time.time() - start
    success = len(pages) > 0
    raw = f"爬虫: {url}\n  成功 {len(pages)} 页, 失败 {len(errors)} 个 ({round(elapsed,1)}s)\n"
    for p in pages:
        raw += f"  [{p['status']}] {p['title'][:40] or p['url'][:50]} (表单:{p['forms']}, 输入:{p['inputs']})\n"
    for err in errors[:20]:
        raw += f"  [失败] {err['url'][:70]} -> {err['error']}\n"
    if budget_exceeded:
        raw += f"  [提示] 已达整轮超时预算 {overall_timeout}s，剩余链接未抓取\n"
    if not pages:
        raw += "  未能抓取任何页面，请检查目标可达性（DNS/端口/防火墙/代理）\n"
    first_err = errors[0]["error"] if errors else "无可用链接"
    return _result("web_crawler", url, success,
                   data={"url": url, "pages": pages, "total": len(pages),
                         "errors": errors, "failed_count": len(errors),
                         "budget_exceeded": budget_exceeded,
                         "elapsed": round(elapsed, 2)}, raw=raw,
                   error="" if success else f"未能抓取任何页面（{len(errors)} 个 URL 失败，首个原因: {first_err}）")
