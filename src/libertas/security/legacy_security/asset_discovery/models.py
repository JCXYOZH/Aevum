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

@dataclass
class Subdomain:
    """子域名"""
    domain: str
    ip: str = ""
    alive: bool = False
    status_code: int = 0
    server: str = ""
    source: str = ""  # dictionary/dns/crtsh/google
    discovered_at: float = 0.0

    def __post_init__(self):
        if not self.discovered_at:
            self.discovered_at = time.time()

    def to_dict(self) -> Dict:
        return {
            "domain": self.domain,
            "ip": self.ip,
            "alive": self.alive,
            "status_code": self.status_code,
            "server": self.server,
            "source": self.source,
        }

@dataclass
class DiscoveredPath:
    """发现的路径"""
    url: str
    path: str
    status_code: int
    content_length: int
    content_type: str = ""
    redirect_url: str = ""
    title: str = ""
    discovered_at: float = 0.0

    def __post_init__(self):
        if not self.discovered_at:
            self.discovered_at = time.time()

    def to_dict(self) -> Dict:
        return {
            "url": self.url,
            "path": self.path,
            "status_code": self.status_code,
            "content_length": self.content_length,
            "content_type": self.content_type,
            "redirect_url": self.redirect_url,
            "title": self.title,
        }

@dataclass
class OpenPort:
    """开放端口"""
    ip: str
    port: int
    service: str = ""
    banner: str = ""
    open: bool = True

    def to_dict(self) -> Dict:
        return {
            "ip": self.ip,
            "port": self.port,
            "service": self.service,
            "banner": self.banner,
            "open": self.open,
        }

SUBDOMAIN_WORDLIST = [
    "www", "mail", "ftp", "localhost", "webmail", "smtp", "pop", "ns1", "webdisk",
    "ns2", "cpanel", "whm", "autodiscover", "autoconfig", "m", "imap", "test", "ns",
    "blog", "pop3", "dev", "www2", "admin", "forum", "news", "vpn", "ns3", "mail2",
    "new", "mysql", "old", "lists", "apps", "support", "shop", "db", "stage", "staging",
    "api", "cdn", "static", "media", "upload", "files", "download", "backup", "bak",
    "test1", "test2", "demo", "beta", "alpha", "prod", "production", "dev1", "dev2",
    "internal", "intranet", "extranet", "portal", "dashboard", "admin1", "administrator",
    "manage", "management", "console", "panel", "cpanel", "wp-admin", "wp-login",
    "phpmyadmin", "pma", "adminer", "sqlbuddy", "mysql-admin", "webadmin",
    "git", "svn", "hg", "cvs", ".git", ".svn", "config", "conf", "etc",
    "monitor", "monitoring", "nagios", "zabbix", "cacti", "ganglia",
    "jenkins", "ci", "cd", "build", "deploy", "release",
    "docker", "k8s", "kubernetes", "registry", "harbor",
    "grafana", "kibana", "elastic", "elasticsearch", "logstash",
    "prometheus", "alertmanager", "consul", "etcd", "zookeeper",
    "redis", "memcached", "mongodb", "mongo", "couchdb", "cassandra",
    "rabbitmq", "kafka", "activemq", "zmq",
    "s3", "bucket", "storage", "cdn", "cloudfront",
    "status", "health", "ping", "metrics", "debug",
    "docs", "documentation", "api-docs", "swagger", "redoc",
    "mobile", "app", "ios", "android", "m",
    "search", "api", "graphql", "rpc", "grpc",
    "auth", "login", "logout", "register", "signup", "sso",
    "oauth", "saml", "oidc", "cas",
    "pay", "payment", "checkout", "cart", "order",
    "user", "users", "account", "profile", "me",
    "admin", "moderator", "mod", "staff", "team",
    "cms", "wp", "wordpress", "drupal", "joomla",
    "shop", "store", "market", "mall", "ecommerce",
    "blog", "news", "article", "post", "forum",
    "wiki", "kb", "help", "faq", "support",
    "cdn1", "cdn2", "img", "images", "pic", "photos",
    "static1", "static2", "assets", "resource", "resources",
    "js", "css", "fonts", "font", "icon", "icons",
    "upload", "uploads", "file", "files", "download", "downloads",
    "tmp", "temp", "cache", "logs", "log", "backup", "backups",
    "old", "new", "test", "dev", "stage", "prod", "demo",
    "en", "zh", "cn", "us", "uk", "jp", "kr",
    "api1", "api2", "api3", "v1", "v2", "v3",
    "gateway", "proxy", "reverse-proxy", "load-balancer", "lb",
    "waf", "firewall", "security", "ids", "ips",
    "vpn", "remote", "rdp", "ssh", "telnet",
    "dns", "dhcp", "ntp", "snmp", "ldap",
    "mail", "smtp", "pop3", "imap", "exchange",
    "web", "www", "www1", "www2", "www3",
    "server", "host", "node", "worker", "master",
    "db1", "db2", "db3", "database", "datastore",
    "cache1", "cache2", "redis1", "redis2", "memcached1",
    "mq1", "mq2", "queue", "broker",
    "es1", "es2", "es3", "elastic1", "elastic2",
    "k8s1", "k8s2", "k8s3", "node1", "node2", "node3",
    "master1", "master2", "master3", "worker1", "worker2", "worker3",
]
