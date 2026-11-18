"""
security/network_space_mapper.py - 网络空间测绘引擎

核心能力：
- NetworkSpaceMapper: 网络空间测绘主引擎
  - 端口扫描（TCP全连接/SYN/UDP）
  - 服务识别（Banner抓取/版本探测）
  - IP段批量扫描（CIDR/范围）
  - 域名解析与关联发现
  - 资产指纹识别（CMS/框架/中间件/设备）
  - CVE漏洞关联（CPE→CVE映射）
  - 地理信息映射
  - 测绘结果导出
- AssetFingerprint: 资产指纹识别器（200+指纹规则）
- TopologyGenerator: 拓扑图生成器（资产关系图/域名关联/IP段拓扑）
- AssetMonitor: 资产变化监控器（新增/变更/消失资产检测）
"""
import os
import re
import sys
import json
import time
import uuid
import socket
import struct
import hashlib
import ipaddress
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple, Set
from dataclasses import dataclass, field
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from enum import Enum

class ScanType(Enum):
    """扫描类型"""
    TCP_CONNECT = "tcp_connect"    # TCP全连接扫描
    TCP_SYN = "tcp_syn"            # TCP SYN半开扫描
    UDP = "udp"                     # UDP扫描
    SERVICE = "service"             # 服务识别
    FULL = "full"                   # 完整扫描（端口+服务+指纹）

@dataclass
class PortInfo:
    """端口信息"""
    port: int = 0
    protocol: str = "tcp"
    state: str = "closed"  # open/closed/filtered
    service: str = ""
    version: str = ""
    banner: str = ""
    cpe: str = ""
    response_time: float = 0.0
    extra: Dict = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "port": self.port,
            "protocol": self.protocol,
            "state": self.state,
            "service": self.service,
            "version": self.version,
            "banner": self.banner[:200] if self.banner else "",
            "cpe": self.cpe,
            "response_time": round(self.response_time, 3),
        }

@dataclass
class Asset:
    """资产"""
    asset_id: str = ""
    ip: str = ""
    hostname: str = ""
    domain: str = ""
    ports: List[PortInfo] = field(default_factory=list)
    os: str = ""
    os_version: str = ""
    location: str = ""
    country: str = ""
    fingerprints: List[Dict] = field(default_factory=list)
    cves: List[Dict] = field(default_factory=list)
    risk_score: float = 0.0
    first_seen: float = 0.0
    last_seen: float = 0.0
    tags: List[str] = field(default_factory=list)
    status: str = "active"  # active/inactive/new/changed/removed

    def __post_init__(self):
        if not self.asset_id:
            self.asset_id = f"asset_{uuid.uuid4().hex[:12]}"
        if not self.first_seen:
            self.first_seen = time.time()
        if not self.last_seen:
            self.last_seen = time.time()

    def to_dict(self) -> Dict:
        return {
            "asset_id": self.asset_id,
            "ip": self.ip,
            "hostname": self.hostname,
            "domain": self.domain,
            "port_count": len(self.ports),
            "open_ports": [p.port for p in self.ports if p.state == "open"],
            "os": self.os,
            "os_version": self.os_version,
            "location": self.location,
            "country": self.country,
            "fingerprint_count": len(self.fingerprints),
            "cve_count": len(self.cves),
            "risk_score": round(self.risk_score, 2),
            "risk_level": self.risk_level,
            "status": self.status,
            "tags": self.tags,
            "ports": [p.to_dict() for p in self.ports],
            "fingerprints": self.fingerprints,
            "cves": self.cves[:20],
        }

    @property
    def risk_level(self) -> str:
        """风险等级（与 get_asset_summary() 的 by_risk 口径保持一致）"""
        if self.risk_score >= 80:
            return "critical"
        if self.risk_score >= 60:
            return "high"
        if self.risk_score >= 30:
            return "medium"
        return "low"

@dataclass
class ScanResult:
    """扫描结果"""
    scan_id: str = ""
    scan_type: str = ""
    target: str = ""
    targets_count: int = 0
    assets_found: int = 0
    open_ports_total: int = 0
    services_found: int = 0
    vulnerabilities_found: int = 0
    started_at: float = 0.0
    completed_at: float = 0.0
    duration: float = 0.0
    status: str = "pending"  # pending/running/completed/failed
    assets: List[Asset] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)

    def __post_init__(self):
        if not self.scan_id:
            self.scan_id = f"scan_{uuid.uuid4().hex[:12]}"
        if not self.started_at:
            self.started_at = time.time()

    def to_dict(self) -> Dict:
        return {
            "scan_id": self.scan_id,
            "scan_type": self.scan_type,
            "target": self.target,
            "targets_count": self.targets_count,
            "assets_found": self.assets_found,
            "open_ports_total": self.open_ports_total,
            "services_found": self.services_found,
            "vulnerabilities_found": self.vulnerabilities_found,
            "duration": round(self.duration, 2),
            "status": self.status,
            "assets": [a.to_dict() for a in self.assets],
            "errors": self.errors[:20],
        }

COMMON_PORTS = {
    21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns",
    67: "dhcp", 68: "dhcp", 69: "tftp", 80: "http", 110: "pop3",
    111: "rpcbind", 113: "ident", 119: "nntp", 123: "ntp", 135: "msrpc",
    137: "netbios-ns", 138: "netbios-dgm", 139: "netbios-ssn", 143: "imap",
    161: "snmp", 162: "snmp-trap", 179: "bgp", 194: "irc", 389: "ldap",
    443: "https", 445: "smb", 465: "smtps", 512: "exec", 513: "login",
    514: "syslog", 515: "printer", 520: "rip", 521: "ripng", 540: "uucp",
    554: "rtsp", 587: "submission", 631: "ipp", 636: "ldaps", 873: "rsync",
    990: "ftps", 993: "imaps", 995: "pop3s", 1080: "socks", 1099: "rmi",
    1194: "openvpn", 1433: "mssql", 1521: "oracle", 1723: "pptp", 1812: "radius",
    1813: "radius-acct", 2049: "nfs", 2082: "cpanel", 2083: "cpanel-ssl",
    2086: "whostmgr", 2087: "whostmgr-ssl", 2095: "webmail", 2096: "webmail-ssl",
    2181: "zookeeper", 2375: "docker", 2376: "docker-ssl", 2483: "oracle-tns",
    3000: "http-alt", 3128: "http-proxy", 3306: "mysql", 3389: "rdp",
    3690: "svn", 4040: "http-alt", 4369: "epmd", 4444: "metasploit",
    4567: "galera", 4848: "glassfish", 5000: "upnp", 5001: "synology",
    5060: "sip", 5061: "sips", 5222: "xmpp-client", 5269: "xmpp-server",
    5432: "postgresql", 5555: "freeciv", 5601: "kibana", 5666: "nrpe",
    5672: "amqp", 5900: "vnc", 5984: "couchdb", 5985: "winrm", 5986: "winrm-ssl",
    6000: "x11", 6379: "redis", 6443: "kubernetes", 6660: "irc", 6667: "irc",
    6868: "boinc", 7000: "afs3-fileserver", 7001: "weblogic", 7002: "weblogic-ssl",
    7077: "spark", 7199: "cassandra-jmx", 7474: "neo4j", 7547: "cwmp",
    7680: "pando-pub", 7777: "cbt", 8000: "http-alt", 8008: "http-alt",
    8009: "ajp", 8010: "http-alt", 8042: "orthanc", 8069: "odoo", 8080: "http-proxy",
    8081: "http-alt", 8083: "influxdb", 8086: "influxdb", 8088: "http-alt",
    8089: "splunk", 8090: "http-alt", 8091: "couchbase", 8118: "privoxy",
    8123: "clickhouse", 8161: "activemq", 8200: "vault", 8222: "nats",
    8333: "bitcoin", 8384: "syncthing", 8400: "couchbase", 8443: "https-alt",
    8484: "http-alt", 8500: "consul", 8530: "consul-dns", 8600: "consul-dns",
    8686: "jmx", 8761: "eureka", 8800: "http-alt", 8834: "nessus", 8888: "http-alt",
    8983: "solr", 9000: "http-alt", 9001: "http-alt", 9042: "cassandra",
    9090: "prometheus", 9092: "kafka", 9100: "node-exporter", 9200: "elasticsearch",
    9300: "elasticsearch", 9418: "git", 9443: "https-alt", 9500: "sap",
    9600: "logstash", 9700: "sap", 9800: "http-alt", 9900: "http-alt",
    9999: "http-alt", 10000: "webmin", 10050: "zabbix-agent", 10051: "zabbix-server",
    10250: "kubelet", 10251: "kube-scheduler", 10252: "kube-controller",
    11211: "memcached", 11300: "beanstalkd", 12345: "netbus", 13720: "bprd",
    15672: "rabbitmq", 16080: "http-alt", 16379: "redis", 18080: "http-alt",
    18081: "http-alt", 18082: "http-alt", 18083: "emqx", 19000: "http-alt",
    20000: "dnp", 21025: "http-alt", 22022: "ssh-alt", 25565: "minecraft",
    27017: "mongodb", 27018: "mongodb", 28015: "rethinkdb", 30000: "http-alt",
    31337: "elite", 32400: "plex", 33848: "http-alt", 34567: "http-alt",
    36330: "http-alt", 38080: "http-alt", 40000: "http-alt", 41000: "http-alt",
    44334: "http-alt", 44444: "http-alt", 45000: "http-alt", 47000: "http-alt",
    47808: "bacnet", 48400: "http-alt", 49152: "upnp", 50000: "ibm-db2",
    50070: "hadoop-namenode", 50075: "hadoop-datanode", 50090: "hadoop-secondary",
    50470: "hadoop-namenode-https", 51000: "impala", 51400: "hive",
    52000: "http-alt", 54321: "postgresql-alt", 55555: "http-alt",
    56010: "kibana-alt", 60000: "http-alt", 60010: "hadoop-regionserver",
    60020: "hadoop-regionserver", 60030: "hadoop-regionserver",
    61000: "http-alt", 62000: "http-alt", 63000: "http-alt", 64000: "http-alt",
    65000: "http-alt", 65535: "reserved",
}

SERVICE_DEFAULT_PORTS = {
    "http": [80, 8080, 8000, 8888, 8008, 8081],
    "https": [443, 8443, 9443],
    "ssh": [22, 2222],
    "ftp": [21, 2121],
    "mysql": [3306],
    "postgresql": [5432],
    "mongodb": [27017],
    "redis": [6379],
    "elasticsearch": [9200, 9300],
    "rdp": [3389],
    "smb": [445, 139],
    "dns": [53],
    "smtp": [25, 587, 465],
    "pop3": [110, 995],
    "imap": [143, 993],
    "ldap": [389, 636],
    "snmp": [161, 162],
    "vnc": [5900, 5901],
    "telnet": [23],
    "oracle": [1521],
    "mssql": [1433],
}
