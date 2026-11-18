"""
HTTP 专业工具集
- Repeater（重放器）：保存/修改/重放 HTTP 请求，支持请求历史
- Intruder（攻击器）：批量 payload 注入，支持字典和位置标记
- Scanner（扫描器）：安全头检测、目录探测、常见漏洞检查
"""
import os
import json
import time
import uuid
import sqlite3
import threading
import urllib.parse
from typing import Dict, List, Optional
from datetime import datetime
from libertas.foundation.config import get_data_dir


class HttpProTools:
    def __init__(self, db_path: str = ""):
        if not db_path:
            db_dir = os.path.join(get_data_dir(), "HttpPro")
            os.makedirs(db_dir, exist_ok=True)
            db_path = os.path.join(db_dir, "httppro.db")
        self.db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._lock, self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS repeater_history (
                    id TEXT PRIMARY KEY,
                    name TEXT DEFAULT '',
                    method TEXT,
                    url TEXT,
                    headers TEXT DEFAULT '{}',
                    body TEXT DEFAULT '',
                    status_code INTEGER,
                    response_headers TEXT DEFAULT '{}',
                    response_body TEXT DEFAULT '',
                    response_time REAL,
                    created_at REAL NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS intruder_results (
                    id TEXT PRIMARY KEY,
                    target_url TEXT,
                    payload TEXT,
                    status_code INTEGER,
                    response_length INTEGER,
                    response_time REAL,
                    created_at REAL NOT NULL
                )
            """)

    def _do_request(self, method: str, url: str, headers: Dict, body: str = "",
                    timeout: int = 15, follow_redirects: bool = True) -> Dict:
        try:
            import requests
            start = time.time()
            resp = requests.request(
                method, url, headers=headers, data=body.encode() if body else None,
                timeout=timeout, allow_redirects=follow_redirects, verify=False
            )
            elapsed = time.time() - start
            return {
                "success": True,
                "status_code": resp.status_code,
                "headers": dict(resp.headers),
                "body": resp.text[:50000],
                "elapsed": round(elapsed, 3),
                "url": str(resp.url),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def repeater_send(self, method: str, url: str, headers: Dict = None,
                      body: str = "", follow_redirects: bool = True, name: str = "") -> Dict:
        headers = headers or {}
        result = self._do_request(method, url, headers, body, follow_redirects=follow_redirects)
        rid = uuid.uuid4().hex[:12]
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "INSERT INTO repeater_history (id, name, method, url, headers, body, status_code, response_headers, response_body, response_time, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (rid, name, method, url, json.dumps(headers), body,
                 result.get("status_code", 0),
                 json.dumps(result.get("headers", {})),
                 result.get("body", "")[:20000],
                 result.get("elapsed", 0), time.time())
            )
        result["id"] = rid
        return result

    def repeater_history(self, limit: int = 50) -> List[Dict]:
        with self._lock, self._get_conn() as conn:
            rows = conn.execute(
                "SELECT id, name, method, url, status_code, response_time, created_at FROM repeater_history ORDER BY created_at DESC LIMIT ?",
                (limit,)
            ).fetchall()
            return [dict(r) for r in rows]

    def repeater_get(self, rid: str) -> Optional[Dict]:
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT * FROM repeater_history WHERE id=?", (rid,)).fetchone()
            return dict(row) if row else None

    def repeater_delete(self, rid: str) -> bool:
        with self._lock, self._get_conn() as conn:
            cur = conn.execute("DELETE FROM repeater_history WHERE id=?", (rid,))
            return cur.rowcount > 0

    def intruder_attack(self, url_template: str, payloads: List[str], method: str = "GET",
                        headers: Dict = None, body_template: str = "", marker: str = "§",
                        follow_redirects: bool = True, concurrency: int = 5) -> Dict:
        headers = headers or {}
        results = []
        threads = []
        result_lock = threading.Lock()

        def attack_one(payload):
            target_url = url_template.replace(marker + marker, urllib.parse.quote(payload))
            if marker + marker not in url_template:
                target_url = url_template.replace(marker, urllib.parse.quote(payload))
            req_body = body_template.replace(marker + marker, payload).replace(marker, payload) if body_template else ""
            r = self._do_request(method, target_url, headers, req_body, follow_redirects=follow_redirects)
            item = {
                "payload": payload,
                "url": target_url,
                "status_code": r.get("status_code", 0),
                "response_length": len(r.get("body", "")),
                "response_time": r.get("elapsed", 0),
                "success": r.get("success", False),
                "error": r.get("error", ""),
            }
            with result_lock:
                results.append(item)
            rid = uuid.uuid4().hex[:12]
            with self._lock, self._get_conn() as conn:
                conn.execute(
                    "INSERT INTO intruder_results (id, target_url, payload, status_code, response_length, response_time, created_at) VALUES (?,?,?,?,?,?,?)",
                    (rid, target_url, payload, item["status_code"], item["response_length"], item["response_time"], time.time())
                )

        for payload in payloads:
            t = threading.Thread(target=attack_one, args=(payload,), daemon=True)
            threads.append(t)
            t.start()
            if len(threads) >= concurrency:
                for t in threads:
                    t.join(timeout=30)
                threads = []
        for t in threads:
            t.join(timeout=30)
        results.sort(key=lambda x: x.get("response_time", 0))
        return {"success": True, "total": len(results), "results": results}

    def scanner_scan(self, url: str, scan_dirs: bool = True, scan_headers: bool = True) -> Dict:
        findings = []
        base_result = self._do_request("GET", url, {}, timeout=10)
        if not base_result.get("success"):
            return {"success": False, "error": base_result.get("error", "请求失败")}

        if scan_headers:
            resp_headers = {k.lower(): v for k, v in base_result.get("headers", {}).items()}
            security_checks = [
                ("content-security-policy", "缺失 Content-Security-Policy", "中"),
                ("x-frame-options", "缺失 X-Frame-Options（点击劫持风险）", "中"),
                ("x-content-type-options", "缺失 X-Content-Type-Options", "低"),
                ("strict-transport-security", "缺失 HSTS（未强制HTTPS）", "中"),
                ("x-xss-protection", "缺失 X-XSS-Protection", "低"),
                ("referrer-policy", "缺失 Referrer-Policy", "低"),
                ("permissions-policy", "缺失 Permissions-Policy", "低"),
            ]
            for header, desc, severity in security_checks:
                if header not in resp_headers:
                    findings.append({"type": "header", "severity": severity, "finding": desc})
            server = resp_headers.get("server", "")
            if server and any(v in server.lower() for v in ["apache", "nginx", "iis", "php"]):
                findings.append({"type": "info", "severity": "低", "finding": f"服务器版本泄露: {server}"})

        if scan_dirs:
            common_paths = [
                "/admin", "/login", "/robots.txt", "/sitemap.xml", "/.git/HEAD",
                "/.env", "/wp-admin", "/phpinfo.php", "/server-status",
                "/api", "/swagger", "/docs", "/.DS_Store", "/backup",
                "/config", "/debug", "/console", "/actuator", "/graphql",
            ]
            parsed = urllib.parse.urlparse(url)
            base = f"{parsed.scheme}://{parsed.netloc}"
            for path in common_paths:
                try:
                    r = self._do_request("GET", base + path, {}, timeout=5)
                    code = r.get("status_code", 0)
                    if code == 200:
                        findings.append({"type": "path", "severity": "信息", "finding": f"发现可访问路径: {path} (200)", "path": path})
                    elif code == 401 or code == 403:
                        findings.append({"type": "path", "severity": "低", "finding": f"受限路径: {path} ({code})", "path": path})
                except Exception:
                    pass

        return {
            "success": True,
            "url": url,
            "status_code": base_result.get("status_code", 0),
            "findings": findings,
            "total_findings": len(findings),
        }
