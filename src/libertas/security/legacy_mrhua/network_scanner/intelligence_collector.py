"""
花先生 - 广域网异步扫描引擎
============================
大规模网络空间测绘的核心扫描层。

核心能力：
1. 异步IO扫描引擎（asyncio + 自定义连接池），支持万级并发
2. 多种扫描技术：ICMP ping sweep、TCP connect、TCP SYN/ACK/FIN、UDP、ARP
3. 断点续扫（进度持久化），支持暂停/恢复/取消
4. 扫描速率自适应、随机化顺序、超时重试
5. 端口范围预设：Top 100/1000/全端口
6. 广域网情报收集：子域名枚举、ASN/WHOIS、SSL证书提取、IP反查域名
7. 扫描任务管理：任务队列、优先级、实时进度回调
8. 扫描结果流式输出

作者：花先生
版本：2.0.0
"""

import asyncio
import socket
import struct
import random
import time
import json
import os
import re
import ssl
import ipaddress
import concurrent.futures
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Tuple, Set, Callable, Any, Union
from enum import Enum
from collections import defaultdict
import logging
from .generate_top_1000_ports import *  # noqa: F401,F403
from .async_port_scanner import *  # noqa: F401,F403
from .icmp_pinger import *  # noqa: F401,F403

class IntelligenceCollector:
    """
    广域网情报收集器
    收集：子域名、ASN、WHOIS、SSL证书、IP反查域名
    """

    # 常见子域名字典
    SUBDOMAIN_WORDLIST = [
        "www", "mail", "ftp", "localhost", "webmail", "smtp", "pop", "ns1",
        "webdisk", "ns2", "cpanel", "whm", "autodiscover", "autoconfig",
        "m", "imap", "test", "ns", "blog", "pop3", "dev", "www2", "admin",
        "forum", "news", "vpn", "ns3", "mail2", "new", "mysql", "old",
        "lists", "apps", "www1", "intranet", "portal", "wiki", "svn", "api",
        "cdn", "static", "assets", "img", "images", "media", "files", "download",
        "backup", "bak", "stage", "staging", "demo", "beta", "alpha", "prod",
        "git", "github", "gitlab", "jenkins", "ci", "cd", "build", "deploy",
        "monitor", "grafana", "kibana", "prometheus", "zabbix", "nagios",
        "docker", "k8s", "kubernetes", "rancher", "harbor", "registry",
        "redis", "mongo", "elasticsearch", "solr", "rabbitmq", "kafka",
        "ssh", "telnet", "rdp", "vnc", "remote", "console", "shell",
        "pay", "payment", "shop", "store", "cart", "checkout", "order",
        "user", "account", "login", "register", "signup", "auth", "sso",
        "search", "help", "support", "contact", "about", "career", "jobs",
        "m", "mobile", "app", "apps", "ios", "android", "wap", "h5",
        "video", "live", "stream", "tv", "radio", "music", "audio",
        "doc", "docs", "document", "documents", "wiki", "confluence",
        "crm", "erp", "oa", "hr", "finance", "accounting", "billing",
        "status", "health", "metrics", "stats", "analytics", "report",
        "proxy", "gateway", "router", "switch", "firewall", "loadbalancer",
        "dns", "dhcp", "ntp", "snmp", "ldap", "ad", "domain",
        "test1", "test2", "dev1", "dev2", "prod1", "prod2", "web1", "web2",
        "db1", "db2", "cache1", "cache2", "mq1", "mq2",
        "en", "zh", "cn", "us", "jp", "kr", "eu", "global", "international",
        "api1", "api2", "api3", "rest", "graphql", "grpc", "ws", "wss",
        "upload", "download", "export", "import", "sync", "backup",
        "admin1", "admin2", "manager", "moderator", "superadmin", "root",
        "panel", "dashboard", "control", "manage", "settings", "config",
        "preview", "sandbox", "lab", "experiment", "poc", "demo1", "demo2",
        "old1", "old2", "archive", "legacy", "deprecated", "v1", "v2", "v3",
        "next", "future", "beta1", "beta2", "alpha1", "alpha2",
        "partner", "vendor", "supplier", "customer", "client", "b2b", "b2c",
        "internal", "external", "public", "private", "secure", "ssl", "tls",
        "cdn1", "cdn2", "edge", "origin", "cache", "proxy1", "proxy2",
        "monitor1", "monitor2", "alert", "alarm", "watch", "observe",
        "log", "logs", "logging", "elk", "efk", "loki", "fluentd",
        "ci1", "ci2", "cd1", "cd2", "pipeline", "runner", "agent", "worker",
        "git1", "git2", "repo", "repository", "code", "source", "src",
        "doc1", "doc2", "docs1", "docs2", "help1", "help2", "faq",
        "status1", "status2", "health1", "health2", "ready", "live1", "live2",
        "api-dev", "api-test", "api-prod", "api-staging", "api-beta",
        "web-dev", "web-test", "web-prod", "web-staging", "web-beta",
        "app-dev", "app-test", "app-prod", "app-staging", "app-beta",
        "db-dev", "db-test", "db-prod", "db-staging", "db-beta",
        "admin-dev", "admin-test", "admin-prod", "admin-staging",
        "portal-dev", "portal-test", "portal-prod", "portal-staging",
        "shop-dev", "shop-test", "shop-prod", "shop-staging",
        "pay-dev", "pay-test", "pay-prod", "pay-staging",
        "search-dev", "search-test", "search-prod", "search-staging",
        "cdn-dev", "cdn-test", "cdn-prod", "cdn-staging",
        "static-dev", "static-test", "static-prod", "static-staging",
        "img-dev", "img-test", "img-prod", "img-staging",
        "video-dev", "video-test", "video-prod", "video-staging",
        "mail-dev", "mail-test", "mail-prod", "mail-staging",
        "ftp-dev", "ftp-test", "ftp-prod", "ftp-staging",
        "dns-dev", "dns-test", "dns-prod", "dns-staging",
        "vpn-dev", "vpn-test", "vpn-prod", "vpn-staging",
        "proxy-dev", "proxy-test", "proxy-prod", "proxy-staging",
        "monitor-dev", "monitor-test", "monitor-prod", "monitor-staging",
        "log-dev", "log-test", "log-prod", "log-staging",
        "backup-dev", "backup-test", "backup-prod", "backup-staging",
        "sync-dev", "sync-test", "sync-prod", "sync-staging",
        "auth-dev", "auth-test", "auth-prod", "auth-staging",
        "sso-dev", "sso-test", "sso-prod", "sso-staging",
        "api-v1", "api-v2", "api-v3", "api-v4", "api-v5",
        "v1-api", "v2-api", "v3-api", "v4-api", "v5-api",
        "api1-dev", "api2-dev", "api1-test", "api2-test",
        "api1-prod", "api2-prod", "api1-staging", "api2-staging",
        "web1-dev", "web2-dev", "web1-test", "web2-test",
        "web1-prod", "web2-prod", "web1-staging", "web2-staging",
        "app1-dev", "app2-dev", "app1-test", "app2-test",
        "app1-prod", "app2-prod", "app1-staging", "app2-staging",
        "db1-dev", "db2-dev", "db1-test", "db2-test",
        "db1-prod", "db2-prod", "db1-staging", "db2-staging",
        "cache1-dev", "cache2-dev", "cache1-test", "cache2-test",
        "cache1-prod", "cache2-prod", "cache1-staging", "cache2-staging",
        "mq1-dev", "mq2-dev", "mq1-test", "mq2-test",
        "mq1-prod", "mq2-prod", "mq1-staging", "mq2-staging",
        "admin1-dev", "admin2-dev", "admin1-test", "admin2-test",
        "admin1-prod", "admin2-prod", "admin1-staging", "admin2-staging",
        "portal1-dev", "portal2-dev", "portal1-test", "portal2-test",
        "portal1-prod", "portal2-prod", "portal1-staging", "portal2-staging",
        "shop1-dev", "shop2-dev", "shop1-test", "shop2-test",
        "shop1-prod", "shop2-prod", "shop1-staging", "shop2-staging",
        "pay1-dev", "pay2-dev", "pay1-test", "pay2-test",
        "pay1-prod", "pay2-prod", "pay1-staging", "pay2-staging",
        "search1-dev", "search2-dev", "search1-test", "search2-test",
        "search1-prod", "search2-prod", "search1-staging", "search2-staging",
        "cdn1-dev", "cdn2-dev", "cdn1-test", "cdn2-test",
        "cdn1-prod", "cdn2-prod", "cdn1-staging", "cdn2-staging",
        "static1-dev", "static2-dev", "static1-test", "static2-test",
        "static1-prod", "static2-prod", "static1-staging", "static2-staging",
        "img1-dev", "img2-dev", "img1-test", "img2-test",
        "img1-prod", "img2-prod", "img1-staging", "img2-staging",
        "video1-dev", "video2-dev", "video1-test", "video2-test",
        "video1-prod", "video2-prod", "video1-staging", "video2-staging",
        "mail1-dev", "mail2-dev", "mail1-test", "mail2-test",
        "mail1-prod", "mail2-prod", "mail1-staging", "mail2-staging",
        "ftp1-dev", "ftp2-dev", "ftp1-test", "ftp2-test",
        "ftp1-prod", "ftp2-prod", "ftp1-staging", "ftp2-staging",
        "dns1-dev", "dns2-dev", "dns1-test", "dns2-test",
        "dns1-prod", "dns2-prod", "dns1-staging", "dns2-staging",
        "vpn1-dev", "vpn2-dev", "vpn1-test", "vpn2-test",
        "vpn1-prod", "vpn2-prod", "vpn1-staging", "vpn2-staging",
        "proxy1-dev", "proxy2-dev", "proxy1-test", "proxy2-test",
        "proxy1-prod", "proxy2-prod", "proxy1-staging", "proxy2-staging",
        "monitor1-dev", "monitor2-dev", "monitor1-test", "monitor2-test",
        "monitor1-prod", "monitor2-prod", "monitor1-staging", "monitor2-staging",
        "log1-dev", "log2-dev", "log1-test", "log2-test",
        "log1-prod", "log2-prod", "log1-staging", "log2-staging",
        "backup1-dev", "backup2-dev", "backup1-test", "backup2-test",
        "backup1-prod", "backup2-prod", "backup1-staging", "backup2-staging",
        "sync1-dev", "sync2-dev", "sync1-test", "sync2-test",
        "sync1-prod", "sync2-prod", "sync1-staging", "sync2-staging",
        "auth1-dev", "auth2-dev", "auth1-test", "auth2-test",
        "auth1-prod", "auth2-prod", "auth1-staging", "auth2-staging",
        "sso1-dev", "sso2-dev", "sso1-test", "sso2-test",
        "sso1-prod", "sso2-prod", "sso1-staging", "sso2-staging",
    ]

    def __init__(self, timeout: float = 5.0, max_concurrent: int = 1000):
        self.timeout = timeout
        self.max_concurrent = max_concurrent

    async def enumerate_subdomains(self, domain: str,
                                    wordlist: Optional[List[str]] = None,
                                    use_dict: bool = True) -> List[Dict]:
        """
        子域名枚举（DNS爆破）

        Args:
            domain: 主域名
            wordlist: 自定义子域名字典
            use_dict: 是否使用内置字典

        Returns:
            [{"subdomain": "www.example.com", "ip": "1.2.3.4", "source": "dns_brute"}, ...]
        """
        words = wordlist if wordlist else (self.SUBDOMAIN_WORDLIST if use_dict else [])
        if not words:
            return []

        semaphore = asyncio.Semaphore(self.max_concurrent)
        results = []

        async def _resolve(subdomain):
            async with semaphore:
                try:
                    loop = asyncio.get_event_loop()
                    infos = await asyncio.wait_for(
                        loop.getaddrinfo(subdomain, None),
                        timeout=self.timeout
                    )
                    ips = list(set(info[4][0] for info in infos))
                    return {"subdomain": subdomain, "ips": ips, "source": "dns_brute"}
                except Exception:
                    return None

        tasks = [_resolve(f"{word}.{domain}") for word in words]
        for coro in asyncio.as_completed(tasks):
            result = await coro
            if result:
                results.append(result)

        return results

    async def get_ssl_certificate(self, host: str, port: int = 443) -> Optional[Dict]:
        """
        获取SSL/TLS证书信息

        Returns:
            {"subject": ..., "issuer": ..., "valid_from": ..., "valid_to": ...,
             "serial": ..., "version": ..., "san": [...], "fingerprint": ...}
        """
        try:
            context = ssl.create_default_context()
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE

            loop = asyncio.get_event_loop()

            def _connect():
                sock = socket.create_connection((host, port), timeout=self.timeout)
                ssock = context.wrap_socket(sock, server_hostname=host)
                cert = ssock.getpeercert()
                der_cert = ssock.getpeercert(binary_form=True)
                ssock.close()
                return cert, der_cert

            cert, der_cert = await asyncio.wait_for(
                loop.run_in_executor(None, _connect),
                timeout=self.timeout + 2
            )

            import hashlib
            fingerprint = hashlib.sha256(der_cert).hexdigest()

            # 解析SAN
            san = []
            if "subjectAltName" in cert:
                san = [name for _, name in cert["subjectAltName"]]

            return {
                "subject": dict(x[0] for x in cert.get("subject", [])),
                "issuer": dict(x[0] for x in cert.get("issuer", [])),
                "valid_from": cert.get("notBefore", ""),
                "valid_to": cert.get("notAfter", ""),
                "serial": cert.get("serialNumber", ""),
                "version": cert.get("version", ""),
                "san": san,
                "fingerprint_sha256": fingerprint,
            }
        except Exception as e:
            return {"error": str(e)}

    async def reverse_dns(self, ip: str) -> List[str]:
        """
        IP反查域名（PTR记录）

        Returns:
            域名列表
        """
        try:
            loop = asyncio.get_event_loop()
            hostname, aliases, _ = await asyncio.wait_for(
                loop.gethostbyaddr(ip),
                timeout=self.timeout
            )
            result = [hostname] + aliases
            return list(set(result))
        except Exception:
            return []

    async def get_whois(self, domain: str) -> Dict:
        """
        WHOIS信息查询（使用whois命令或HTTP API）

        Returns:
            WHOIS信息字典
        """
        try:
            # 尝试使用whois命令
            proc = await asyncio.create_subprocess_exec(
                "whois", domain,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=self.timeout)
            output = stdout.decode('utf-8', errors='ignore')

            # 解析关键信息
            info = {"raw": output[:2000]}
            patterns = {
                "registrar": r'Registrar:\s*(.+)',
                "registrant": r'Registrant\s+Name:\s*(.+)',
                "created": r'Creation Date:\s*(.+)',
                "expires": r'Registry Expiry Date:\s*(.+)',
                "nameservers": r'Name Server:\s*(.+)',
                "status": r'Status:\s*(.+)',
            }
            for key, pattern in patterns.items():
                matches = re.findall(pattern, output, re.IGNORECASE)
                if matches:
                    info[key] = matches if len(matches) > 1 else matches[0]

            return info
        except FileNotFoundError:
            # whois命令不存在，使用HTTP API
            try:
                import urllib.request
                url = f"https://rdap.org/domain/{domain}"
                req = urllib.request.Request(url, headers={"User-Agent": "MrHua-Scanner/2.0"})
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                    return {"source": "rdap", "data": data}
            except Exception as e:
                return {"error": str(e)}
        except Exception as e:
            return {"error": str(e)}

    async def collect_all(self, target: str) -> Dict:
        """
        收集目标的全部情报

        Args:
            target: 域名或IP

        Returns:
            完整情报字典
        """
        result = {
            "target": target,
            "subdomains": [],
            "ssl_certificates": [],
            "reverse_dns": [],
            "whois": {},
            "asn": {},
        }

        # 判断是域名还是IP
        try:
            ipaddress.ip_address(target)
            is_ip = True
        except ValueError:
            is_ip = False

        if is_ip:
            # IP目标：反查域名 + SSL证书
            result["reverse_dns"] = await self.reverse_dns(target)
            cert = await self.get_ssl_certificate(target)
            if cert and "error" not in cert:
                result["ssl_certificates"].append(cert)
        else:
            # 域名目标：子域名枚举 + WHOIS + SSL
            subdomains_task = self.enumerate_subdomains(target)
            whois_task = self.get_whois(target)
            cert_task = self.get_ssl_certificate(target)

            subdomains, whois, cert = await asyncio.gather(
                subdomains_task, whois_task, cert_task, return_exceptions=True
            )

            if not isinstance(subdomains, Exception):
                result["subdomains"] = subdomains
            if not isinstance(whois, Exception):
                result["whois"] = whois
            if not isinstance(cert, Exception) and cert and "error" not in cert:
                result["ssl_certificates"].append(cert)

        return result
