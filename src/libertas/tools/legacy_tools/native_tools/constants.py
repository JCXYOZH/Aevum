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


cancel_event = threading.Event()

_dns_socket_lock = threading.Lock()

_PORT_PRESETS = {
    "top-20": [21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 993, 995, 1723, 3306, 3389, 5900, 8080],
    "top-100": [7, 9, 13, 21, 22, 23, 25, 26, 37, 53, 79, 80, 81, 88, 106, 110, 111, 113, 119, 135, 139, 143, 144, 179, 199, 389, 427, 443, 444, 445, 465, 513, 514, 515, 543, 544, 548, 554, 587, 631, 646, 873, 990, 993, 995, 1025, 1026, 1027, 1028, 1029, 1110, 1433, 1720, 1723, 1755, 1900, 2000, 2001, 2049, 2121, 2717, 3000, 3128, 3306, 3389, 3986, 4899, 5000, 5009, 5051, 5060, 5101, 5190, 5357, 5432, 5555, 5631, 5666, 5800, 5900, 5901, 6000, 6001, 6646, 7070, 8000, 8008, 8009, 8080, 8081, 8443, 8888, 9100, 9999, 10000, 32768, 49152, 49153, 49154, 49155, 49156, 49157],
    "web": [80, 443, 8080, 8443, 8000, 8888, 8008, 8009, 81, 82, 88, 4443, 4567, 3000, 5000, 7001, 7002, 9000, 9090],
    "database": [3306, 5432, 1433, 1521, 27017, 6379, 11211, 9200, 9300, 5984, 7474, 8529, 28015, 4848, 1527, 1528, 1529, 1530],
    "remote": [22, 23, 3389, 5900, 5901, 5800, 5801, 2222, 22222, 6000, 6001, 6002, 135, 139, 445, 3389, 5985, 5986],
}

_SPEED_PRESETS = {
    "fast": {"timeout": 0.5, "max_workers": 200, "overall_timeout": 60},
    "standard": {"timeout": 1.0, "max_workers": 100, "overall_timeout": 120},
    "thorough": {"timeout": 2.0, "max_workers": 50, "overall_timeout": 300},
}

WHOIS_SERVERS = {
    ".com": "whois.verisign-grs.com", ".net": "whois.verisign-grs.com",
    ".org": "whois.pir.org", ".io": "whois.nic.io", ".cn": "whois.cnnic.cn",
    ".com.cn": "whois.cnnic.cn", ".me": "whois.nic.me", ".info": "whois.afilias.net",
    ".biz": "whois.biz", ".us": "whois.nic.us", ".uk": "whois.nic.uk",
    ".de": "whois.denic.de", ".fr": "whois.afnic.fr", ".jp": "whois.jprs.jp",
    ".kr": "whois.kr", ".ru": "whois.tcinet.ru", ".br": "whois.registro.br",
    ".au": "whois.auda.org.au", ".ca": "whois.cira.ca", ".in": "whois.registry.in",
    ".it": "whois.nic.it", ".es": "whois.nic.es", ".nl": "whois.domain-registry.nl",
    ".se": "whois.iis.se", ".ch": "whois.nic.ch", ".at": "whois.nic.at",
    ".be": "whois.dns.be", ".dk": "whois.dk-hostmaster.dk", ".pl": "whois.dns.pl",
    ".eu": "whois.eu", ".tv": "whois.nic.tv", ".cc": "ccwhois.verisign-grs.com",
    ".xyz": "whois.nic.xyz", ".top": "whois.nic.top", ".club": "whois.nic.club",
    ".online": "whois.nic.online", ".site": "whois.nic.site",
}

COMMON_SUBDOMAINS = [
    "www", "mail", "ftp", "localhost", "webmail", "smtp", "pop", "ns1", "webdisk",
    "ns2", "cpanel", "whm", "autodiscover", "autoconfig", "m", "imap", "test",
    "ns", "blog", "pop3", "dev", "www2", "admin", "forum", "news", "vpn", "ns3",
    "mail2", "new", "mysql", "old", "lists", "support", "mobile", "mx", "static",
    "docs", "beta", "shop", "sql", "secure", "demo", "cp", "calendar", "wiki",
    "web", "media", "email", "images", "img", "www1", "intranet", "portal", "video",
    "sip", "dns2", "api", "cdn", "stats", "dns1", "ns4", "www3", "dns", "jobs",
    "db", "desktop", "app", "download", "remote", "file", "server", "chat", "my",
    "store", "hr", "crm", "git", "svn", "gitlab", "jenkins", "jira", "confluence",
    "kibana", "grafana", "prometheus", "monitor", "zabbix", "nagios", "proxy",
    "gateway", "router", "firewall", "vpn2", "backup", "cloud", "auth", "sso",
    "ldap", "ad", "exchange", "owa", "autodiscover", "lyncdiscover", "sip",
]

COMMON_PATHS = [
    "admin", "login", "wp-admin", "administrator", "phpmyadmin", "admin.php",
    "wp-login.php", "config", "backup", "test", "api", "docs", "documentation",
    "console", "dashboard", "panel", "cpanel", "manager", "upload", "uploads",
    "files", "file", "data", "db", "sql", "dump", "bak", "old", "new", "dev",
    "beta", "alpha", "staging", "debug", "status", "health", "metrics",
    ".env", ".git", ".git/config", ".svn", ".htaccess", "robots.txt", "sitemap.xml",
    "crossdomain.xml", "clientaccesspolicy.xml", "web.config", "package.json",
    "composer.json", "server-status", "server-info", "info.php", "phpinfo.php",
    "setup", "install", "readme", "README", "CHANGELOG", "LICENSE",
    "api/v1", "api/v2", "graphql", "swagger", "swagger-ui", "api-docs",
    "actuator", "actuator/health", "actuator/env", "actuator/beans",
    "jmx-console", "web-console", "struts", "jenkins", "solr", "elastic",
]

_VULN_INTEL_ACTIONS = ("lookup", "search", "detail", "save", "stats", "sources", "sync")

_VULN_ID_RE = re.compile(
    r"^(cve-\d{4}-\d{4,}|ghsa-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}"
    r"|(?:osv|pysec|rustsec|glsa|go)-[0-9a-z.\-]+|vuln_[0-9a-z]+)$",
    re.IGNORECASE)

_TARGET_ALIAS_FAMILY = {
    "target": "any", "targets": "any",
    "target_host": "host", "target_domain": "domain",
    "target_url": "url", "target_uri": "url",
    "target_ip": "ip", "target_addr": "ip", "target_address": "ip",
    "host": "host", "hostname": "host", "host_name": "host", "host_ip": "host",
    "domain": "domain", "domain_name": "domain", "dname": "domain",
    "url": "url", "uri": "url", "link": "url", "targeturl": "url",
    "ip": "ip", "ip_address": "ip", "addr": "ip", "address": "ip",
    "cidr": "cidr", "target_range": "cidr",
}

_FAMILY_PARAM_PRIORITY = {
    "any": ("target", "domain", "host", "hostname", "url", "target_url",
            "ip", "target_range", "cidr"),
    "host": ("host", "hostname", "target", "domain", "url"),
    "domain": ("domain", "hostname", "host", "target", "url"),
    "url": ("url", "target_url", "target", "host"),
    "ip": ("ip", "host", "target", "domain"),
    "cidr": ("cidr", "target_range", "target"),
}

_DISPLAY_TARGET_KEYS = ("target", "domain", "host", "hostname", "url",
                        "target_url", "ip", "target_range", "cidr")

_EXC_REPR_RE = re.compile(
    r"^\s*[A-Za-z_][\w.]*(?:Error|Exception|Exit|Interrupt)\s*[:：]"
    r"|^Traceback \(most recent call last\)")

_MISSING_BINARY_HINTS = (
    "no such file or directory",
    "command not found",
    "is not recognized as an internal or external command",
    "is not recognized as the name of a cmdlet",
    "the system cannot find the file specified",
    "the system cannot find the path specified",
    "不是内部或外部命令",
    "也不是可运行的程序",
    "不是可运行的程序",
    "系统找不到指定的文件",
    "系统找不到指定的路径",
    "无法将",                 # PowerShell：「无法将“dig”项识别为 cmdlet…」
    "识别为 cmdlet",
)

_EXIT_DIAG_KEYWORDS = (
    "error", "failed", "failure", "refused", "denied", "timeout", "timed out",
    "unreachable", "can't", "cannot", "could not", "invalid", "unknown",
    "not found", "no such", "unable", "unsupported", "usage", "nxdomain",
    "communications error", "no servers could be reached",
)

_CURL_EXIT_HINTS = {
    1: "不支持的协议或参数错误",
    3: "URL 格式不合法",
    5: "无法解析代理地址",
    6: "DNS 解析失败（域名不存在，或本机没有可用 DNS）",
    7: "无法连接到主机（端口未开放、被防火墙拦截，或网络不可达）",
    22: "服务器返回了错误状态码（HTTP 4xx/5xx）",
    28: "连接或读取超时",
    35: "TLS 握手失败（协议/端口不匹配，或对方不是 HTTPS）",
    47: "重定向次数过多",
    52: "服务器没有返回任何数据（空响应）",
    56: "接收数据失败（连接被对端重置，常见于 WAF/只支持 HTTP2 的站点）",
    60: "证书校验失败（自签名/过期/域名不匹配）",
    92: "HTTP/2 协议层错误",
}
