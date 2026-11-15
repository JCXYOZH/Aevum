"""
security/asset_discovery.py - 资产发现与目录爆破

核心能力：
- 子域名枚举（字典爆破、DNS解析、证书透明度、搜索引擎）
- 目录爆破（常见路径、管理后台、备份文件、配置文件）
- 端口扫描（基础版）
- 服务识别
- 资产信息聚合
"""
import os
import re
import sys
import json
import time
import uuid
import socket
import threading
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple, Set
from dataclasses import dataclass, field
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor, as_completed


# ================================================================
# 数据结构
# ================================================================
from .models import *  # noqa: F401,F403
from .constants import *  # noqa: F401,F403

class AssetDiscovery:
    """资产发现器 - 子域名枚举、DNS解析、证书透明度查询"""

    def __init__(self, timeout: int = 5, concurrent: int = 20,
                 wordlist: List[str] = None, use_crtsh: bool = True,
                 use_dns: bool = True, use_http: bool = True):
        self.timeout = timeout
        self.concurrent = concurrent
        self.wordlist = wordlist or SUBDOMAIN_WORDLIST
        self.use_crtsh = use_crtsh
        self.use_dns = use_dns
        self.use_http = use_http
        self.discovered: Dict[str, Subdomain] = {}
        self._lock = threading.RLock()

    def enumerate_subdomains(self, domain: str) -> List[Subdomain]:
        """枚举子域名"""
        self.discovered.clear()

        # 1. 证书透明度查询
        if self.use_crtsh:
            try:
                crtsh_domains = self._query_crtsh(domain)
                for d in crtsh_domains:
                    with self._lock:
                        if d not in self.discovered:
                            self.discovered[d] = Subdomain(domain=d, source="crtsh")
            except Exception:
                pass

        # 2. DNS字典爆破
        if self.use_dns:
            self._dns_bruteforce(domain)

        # 3. HTTP存活检测
        if self.use_http:
            self._http_probe()

        return list(self.discovered.values())

    def _query_crtsh(self, domain: str) -> List[str]:
        """查询证书透明度日志（crt.sh）"""
        url = f"https://crt.sh/?q=%25.{domain}&output=json"
        try:
            req = urllib.request.Request(url)
            req.add_header("User-Agent", "Mozilla/5.0")
            resp = urllib.request.urlopen(req, timeout=self.timeout)
            data = json.loads(resp.read().decode("utf-8"))
            domains = set()
            for entry in data:
                name = entry.get("name_value", "")
                for d in name.split("\n"):
                    d = d.strip().lstrip("*.")
                    if d.endswith(domain) and d != domain:
                        domains.add(d)
            return list(domains)
        except Exception:
            return []

    def _dns_bruteforce(self, domain: str):
        """DNS字典爆破"""
        def resolve(sub: str):
            full = f"{sub}.{domain}"
            try:
                ip = socket.gethostbyname(full)
                with self._lock:
                    if full not in self.discovered:
                        self.discovered[full] = Subdomain(domain=full, ip=ip, source="dns")
                    else:
                        self.discovered[full].ip = ip
            except Exception:
                pass

        with ThreadPoolExecutor(max_workers=self.concurrent) as executor:
            futures = [executor.submit(resolve, sub) for sub in self.wordlist]
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception:
                    pass

    def _http_probe(self):
        """HTTP存活检测"""
        def probe(sub: Subdomain):
            for scheme in ["http", "https"]:
                url = f"{scheme}://{sub.domain}"
                try:
                    req = urllib.request.Request(url, method="GET")
                    req.add_header("User-Agent", "Mozilla/5.0")
                    resp = urllib.request.urlopen(req, timeout=self.timeout)
                    sub.alive = True
                    sub.status_code = resp.getcode()
                    sub.server = resp.headers.get("Server", "")
                    break
                except urllib.error.HTTPError as e:
                    sub.alive = True
                    sub.status_code = e.code
                    sub.server = e.headers.get("Server", "") if e.headers else ""
                    break
                except Exception:
                    continue

        with ThreadPoolExecutor(max_workers=self.concurrent) as executor:
            futures = [executor.submit(probe, sub) for sub in self.discovered.values()]
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception:
                    pass

    def get_alive_subdomains(self) -> List[Subdomain]:
        return [s for s in self.discovered.values() if s.alive]

    def get_stats(self) -> Dict:
        return {
            "total_discovered": len(self.discovered),
            "alive": len(self.get_alive_subdomains()),
            "by_source": dict(Counter(s.source for s in self.discovered.values())),
            "wordlist_size": len(self.wordlist),
        }

class DirectoryBruteforcer:
    """目录爆破器 - 爆破Web目录、文件、管理后台"""

    def __init__(self, timeout: int = 5, concurrent: int = 20,
                 wordlist: List[str] = None, follow_redirects: bool = False,
                 hide_status: List[int] = None, extensions: List[str] = None):
        self.timeout = timeout
        self.concurrent = concurrent
        self.wordlist = wordlist or DIRECTORY_WORDLIST
        self.follow_redirects = follow_redirects
        self.hide_status = hide_status or [404]
        self.extensions = extensions or ["", ".php", ".html", ".txt", ".bak", ".zip", ".sql"]
        self.discovered: List[DiscoveredPath] = []
        self._lock = threading.RLock()

    def bruteforce(self, base_url: str, paths: List[str] = None) -> List[DiscoveredPath]:
        """爆破目录"""
        self.discovered.clear()
        base_url = base_url.rstrip("/")

        # 构建路径列表
        target_paths = paths or self.wordlist
        all_paths = []
        for path in target_paths:
            for ext in self.extensions:
                if ext and path.endswith(ext):
                    all_paths.append(path)
                elif not ext:
                    all_paths.append(path)
                elif "." not in path:
                    all_paths.append(f"{path}{ext}")

        # 去重
        all_paths = list(set(all_paths))

        def probe(path: str):
            url = f"{base_url}/{path.lstrip('/')}"
            try:
                req = urllib.request.Request(url, method="GET")
                req.add_header("User-Agent", "Mozilla/5.0")
                resp = urllib.request.urlopen(req, timeout=self.timeout)
                status = resp.getcode()
                body = resp.read()
                content_length = len(body)
                content_type = resp.headers.get("Content-Type", "")

                if status not in self.hide_status:
                    discovered = DiscoveredPath(
                        url=url,
                        path=path,
                        status_code=status,
                        content_length=content_length,
                        content_type=content_type,
                    )
                    # 提取标题
                    title_match = re.search(r"<title>([^<]+)</title>", body.decode("utf-8", errors="replace"), re.I)
                    if title_match:
                        discovered.title = title_match.group(1)[:100]

                    with self._lock:
                        self.discovered.append(discovered)

            except urllib.error.HTTPError as e:
                status = e.code
                if status not in self.hide_status:
                    discovered = DiscoveredPath(
                        url=url,
                        path=path,
                        status_code=status,
                        content_length=0,
                    )
                    with self._lock:
                        self.discovered.append(discovered)
            except Exception:
                pass

        with ThreadPoolExecutor(max_workers=self.concurrent) as executor:
            futures = [executor.submit(probe, path) for path in all_paths]
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception:
                    pass

        # 按状态码排序
        self.discovered.sort(key=lambda x: (x.status_code, x.path))
        return self.discovered

    def get_by_status(self, status: int) -> List[DiscoveredPath]:
        return [p for p in self.discovered if p.status_code == status]

    def get_interesting(self) -> List[DiscoveredPath]:
        """获取有趣的发现（200/201/204/301/302/401/403）"""
        interesting_status = [200, 201, 204, 301, 302, 401, 403]
        return [p for p in self.discovered if p.status_code in interesting_status]

    def get_stats(self) -> Dict:
        by_status = defaultdict(int)
        for p in self.discovered:
            by_status[p.status_code] += 1
        return {
            "total_requests": len(self.wordlist) * len(self.extensions),
            "discovered": len(self.discovered),
            "interesting": len(self.get_interesting()),
            "by_status": dict(by_status),
        }

class PortScanner:
    """端口扫描器 - 基础TCP端口扫描和服务识别"""

    COMMON_PORTS = {
        21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns",
        80: "http", 110: "pop3", 111: "rpcbind", 135: "msrpc", 139: "netbios",
        143: "imap", 443: "https", 445: "smb", 465: "smtps", 587: "submission",
        631: "ipp", 873: "rsync", 993: "imaps", 995: "pop3s", 1080: "socks",
        1433: "mssql", 1521: "oracle", 1723: "pptp", 2049: "nfs", 2375: "docker",
        3306: "mysql", 3389: "rdp", 5000: "upnp", 5432: "postgresql", 5900: "vnc",
        5984: "couchdb", 6379: "redis", 7001: "weblogic", 8000: "http-alt",
        8080: "http-proxy", 8081: "http-alt", 8443: "https-alt", 8888: "http-alt",
        9000: "php-fpm", 9090: "http-alt", 9200: "elasticsearch", 9300: "elasticsearch",
        11211: "memcached", 27017: "mongodb", 27018: "mongodb", 50070: "hadoop",
    }

    def __init__(self, timeout: int = 3, concurrent: int = 50):
        self.timeout = timeout
        self.concurrent = concurrent
        self.open_ports: List[OpenPort] = []

    def scan(self, ip: str, ports: List[int] = None) -> List[OpenPort]:
        """扫描端口"""
        self.open_ports.clear()
        target_ports = ports or list(self.COMMON_PORTS.keys())

        def scan_port(port: int):
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(self.timeout)
                result = sock.connect_ex((ip, port))
                if result == 0:
                    service = self.COMMON_PORTS.get(port, "unknown")
                    banner = self._grab_banner(ip, port)
                    self.open_ports.append(OpenPort(
                        ip=ip, port=port, service=service, banner=banner
                    ))
                sock.close()
            except Exception:
                pass

        with ThreadPoolExecutor(max_workers=self.concurrent) as executor:
            futures = [executor.submit(scan_port, port) for port in target_ports]
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception:
                    pass

        self.open_ports.sort(key=lambda x: x.port)
        return self.open_ports

    def _grab_banner(self, ip: str, port: int) -> str:
        """获取服务banner"""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(self.timeout)
            sock.connect((ip, port))
            # 发送一些常见探针
            probes = [b"\r\n", b"GET / HTTP/1.0\r\n\r\n", b"HELP\r\n"]
            for probe in probes:
                try:
                    sock.send(probe)
                    data = sock.recv(1024)
                    if data:
                        sock.close()
                        return data.decode("utf-8", errors="replace")[:200]
                except Exception:
                    continue
            sock.close()
        except Exception:
            pass
        return ""

    def get_stats(self) -> Dict:
        return {
            "open_ports": len(self.open_ports),
            "services": dict(Counter(p.service for p in self.open_ports)),
            "ports": [p.port for p in self.open_ports],
        }
