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
from .models import *  # noqa: F401,F403
from .asset_fingerprint import *  # noqa: F401,F403

class NetworkSpaceMapper:
    """网络空间测绘主引擎

    端口扫描、服务识别、资产指纹、CVE关联、IP段批量扫描、域名关联。
    """

    def __init__(self, max_workers: int = 50, timeout: float = 3.0):
        self.max_workers = max_workers
        self.timeout = timeout
        # 指纹库「自动学习」回调，由上层注入；未注入时不做任何事
        self.learning_sink = None
        self.fingerprint = AssetFingerprint()
        self.assets: Dict[str, Asset] = {}
        self.scans: Dict[str, ScanResult] = {}
        self._cve_database = self._init_cve_database()

    def _init_cve_database(self) -> Dict:
        """初始化CVE数据库（内置常见CVE映射）"""
        return {
            "nginx": [
                {"cve": "CVE-2021-23017", "severity": "high", "description": "DNS解析器堆内存写越界"},
                {"cve": "CVE-2019-20372", "severity": "medium", "description": "HTTP请求走私"},
            ],
            "apache": [
                {"cve": "CVE-2021-41773", "severity": "critical", "description": "路径穿越和远程代码执行"},
                {"cve": "CVE-2021-42013", "severity": "critical", "description": "路径穿越和远程代码执行"},
            ],
            "tomcat": [
                {"cve": "CVE-2020-1938", "severity": "high", "description": "Ghostcat文件包含"},
                {"cve": "CVE-2017-12615", "severity": "high", "description": "PUT方法任意文件写入"},
            ],
            "weblogic": [
                {"cve": "CVE-2023-21839", "severity": "critical", "description": "反序列化远程代码执行"},
                {"cve": "CVE-2020-14882", "severity": "critical", "description": "控制台未授权访问"},
                {"cve": "CVE-2019-2725", "severity": "critical", "description": "反序列化远程代码执行"},
            ],
            "struts2": [
                {"cve": "CVE-2017-5638", "severity": "critical", "description": "Jakarta Multipart解析器远程代码执行"},
                {"cve": "CVE-2018-11776", "severity": "high", "description": "OGNL表达式注入"},
            ],
            "shiro": [
                {"cve": "CVE-2016-4437", "severity": "critical", "description": "rememberMe反序列化远程代码执行"},
            ],
            "fastjson": [
                {"cve": "CVE-2022-25845", "severity": "high", "description": "反序列化远程代码执行"},
                {"cve": "CVE-2017-18349", "severity": "critical", "description": "反序列化远程代码执行"},
            ],
            "log4j": [
                {"cve": "CVE-2021-44228", "severity": "critical", "description": "Log4Shell远程代码执行"},
                {"cve": "CVE-2021-45046", "severity": "high", "description": "拒绝服务和远程代码执行"},
            ],
            "spring boot": [
                {"cve": "CVE-2022-22965", "severity": "critical", "description": "Spring4Shell远程代码执行"},
                {"cve": "CVE-2022-22963", "severity": "high", "description": "Spring Cloud Function SpEL注入"},
            ],
            "mysql": [
                {"cve": "CVE-2016-6662", "severity": "high", "description": "权限提升"},
            ],
            "redis": [
                {"cve": "CVE-2022-0543", "severity": "critical", "description": "Lua沙箱逃逸远程代码执行"},
            ],
            "elasticsearch": [
                {"cve": "CVE-2014-3120", "severity": "critical", "description": "远程代码执行"},
                {"cve": "CVE-2015-1427", "severity": "high", "description": "Groovy脚本执行"},
            ],
            "mongodb": [
                {"cve": "CVE-2015-2705", "severity": "medium", "description": "拒绝服务"},
            ],
            "jenkins": [
                {"cve": "CVE-2024-23897", "severity": "critical", "description": "任意文件读取"},
                {"cve": "CVE-2018-1000861", "severity": "critical", "description": "远程代码执行"},
            ],
            "gitlab": [
                {"cve": "CVE-2021-22205", "severity": "critical", "description": "远程代码执行"},
            ],
            "grafana": [
                {"cve": "CVE-2021-43798", "severity": "high", "description": "路径穿越任意文件读取"},
            ],
            "kibana": [
                {"cve": "CVE-2019-7609", "severity": "critical", "description": "原型污染远程代码执行"},
            ],
            "docker": [
                {"cve": "CVE-2019-5736", "severity": "critical", "description": "容器逃逸"},
            ],
            "kubernetes": [
                {"cve": "CVE-2018-1002105", "severity": "critical", "description": "API服务器权限提升"},
            ],
            "phpmyadmin": [
                {"cve": "CVE-2018-12613", "severity": "high", "description": "本地文件包含"},
            ],
            "solr": [
                {"cve": "CVE-2019-17558", "severity": "high", "description": "Velocity模板远程代码执行"},
            ],
            "iis": [
                {"cve": "CVE-2017-7269", "severity": "critical", "description": "WebDAV远程代码执行"},
            ],
            "postgresql": [
                {"cve": "CVE-2018-1058", "severity": "medium", "description": "权限提升"},
            ],
            "oracle": [
                {"cve": "CVE-2014-4287", "severity": "high", "description": "远程代码执行"},
            ],
            "mssql": [
                {"cve": "CVE-2019-1068", "severity": "critical", "description": "远程代码执行"},
            ],
        }

    def scan_port(self, ip: str, port: int, timeout: float = None) -> PortInfo:
        """扫描单个端口"""
        timeout = timeout or self.timeout
        port_info = PortInfo(port=port, protocol="tcp")

        try:
            start_time = time.time()
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            result = sock.connect_ex((ip, port))
            port_info.response_time = time.time() - start_time

            if result == 0:
                port_info.state = "open"
                port_info.service = COMMON_PORTS.get(port, "unknown")

                # 尝试抓取Banner
                try:
                    sock.sendall(b"\r\n")
                    banner = sock.recv(1024).decode("utf-8", errors="replace").strip()
                    if banner:
                        port_info.banner = banner
                        # 从Banner提取版本
                        version_match = re.search(r'[\d]+\.[\d]+[\.\d]*', banner)
                        if version_match:
                            port_info.version = version_match.group()
                except Exception:
                    pass
            else:
                port_info.state = "closed"

            sock.close()
        except socket.timeout:
            port_info.state = "filtered"
        except Exception as e:
            port_info.state = "error"
            port_info.banner = str(e)

        return port_info

    def scan_host(self, ip: str, ports: List[int] = None,
                  scan_type: str = "tcp_connect",
                  service_detect: bool = True) -> Asset:
        """扫描单个主机"""
        asset = Asset(ip=ip)

        if ports is None:
            ports = list(COMMON_PORTS.keys())[:100]  # 默认扫描Top100端口

        # 多线程端口扫描
        open_ports = []
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {executor.submit(self.scan_port, ip, port): port for port in ports}
            for future in as_completed(futures):
                port_info = future.result()
                if port_info.state == "open":
                    open_ports.append(port_info)

        asset.ports = open_ports
        asset.last_seen = time.time()

        # 服务识别和指纹识别
        if service_detect:
            for port_info in open_ports:
                if port_info.service in ("http", "https", "http-alt", "http-proxy", "https-alt"):
                    self._http_service_detect(asset, port_info)

        # CVE关联
        self._correlate_cves(asset)

        # 风险评分
        asset.risk_score = self._calculate_risk_score(asset)

        self.assets[ip] = asset
        return asset

    def _http_service_detect(self, asset: Asset, port_info: PortInfo):
        """HTTP服务识别和指纹识别"""
        try:
            import requests
            protocol = "https" if port_info.port in (443, 8443, 9443) else "http"
            url = f"{protocol}://{asset.ip}:{port_info.port}"

            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            resp = requests.get(url, headers=headers, timeout=self.timeout, verify=False, allow_redirects=True)

            # 指纹识别
            fingerprints = self.fingerprint.identify(
                url=url,
                headers=dict(resp.headers),
                content=resp.text,
                cookies=dict(resp.cookies),
                port=port_info.port,
            )
            asset.fingerprints.extend(fingerprints)

            # 把原始 HTTP 证据交给指纹库做「自动学习」（此前这里直接丢弃了）
            if self.learning_sink:
                try:
                    self.learning_sink(
                        url=url,
                        headers=dict(resp.headers),
                        content=resp.text,
                        cookies=dict(resp.cookies),
                        port=port_info.port,
                    )
                except Exception:
                    pass

            # 更新服务信息
            server = resp.headers.get("Server", "")
            if server:
                port_info.version = server
                port_info.banner = server

            # 主机名
            title_match = re.search(r'<title[^>]*>(.*?)</title>', resp.text, re.DOTALL | re.IGNORECASE)
            if title_match:
                asset.hostname = title_match.group(1).strip()[:100]

        except Exception:
            pass

    def _correlate_cves(self, asset: Asset):
        """关联CVE漏洞"""
        for fingerprint in asset.fingerprints:
            name = fingerprint["name"].lower()
            if name in self._cve_database:
                for cve in self._cve_database[name]:
                    if cve not in asset.cves:
                        asset.cves.append(cve)

        # 基于端口的CVE关联
        for port in asset.ports:
            service = port.service.lower()
            if service in self._cve_database:
                for cve in self._cve_database[service]:
                    if cve not in asset.cves:
                        asset.cves.append(cve)

    def _calculate_risk_score(self, asset: Asset) -> float:
        """计算资产风险评分（0-100）"""
        score = 0.0

        # 开放端口数量
        score += min(len(asset.ports) * 2, 20)

        # 高危端口
        high_risk_ports = {21, 23, 25, 53, 110, 135, 139, 143, 445, 993, 995,
                           1433, 1521, 2049, 3306, 3389, 5432, 5900, 6379, 9200, 11211, 27017}
        for port in asset.ports:
            if port.port in high_risk_ports:
                score += 5

        # CVE严重程度
        for cve in asset.cves:
            severity = cve.get("severity", "low")
            if severity == "critical":
                score += 20
            elif severity == "high":
                score += 10
            elif severity == "medium":
                score += 5
            else:
                score += 2

        # 指纹置信度
        for fp in asset.fingerprints:
            if fp["confidence"] > 0.8:
                score += 2

        return min(100, score)

    def scan_cidr(self, cidr: str, ports: List[int] = None,
                  max_hosts: int = 256) -> ScanResult:
        """扫描CIDR网段"""
        scan_result = ScanResult(scan_type="cidr", target=cidr)
        scan_result.status = "running"

        try:
            network = ipaddress.ip_network(cidr, strict=False)
            hosts = list(network.hosts())[:max_hosts]
            scan_result.targets_count = len(hosts)

            # 多线程主机扫描
            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                futures = {executor.submit(self.scan_host, str(host), ports): str(host) for host in hosts}
                for future in as_completed(futures):
                    try:
                        asset = future.result()
                        if asset.ports:
                            scan_result.assets.append(asset)
                            scan_result.open_ports_total += len(asset.ports)
                            scan_result.services_found += len(asset.fingerprints)
                            scan_result.vulnerabilities_found += len(asset.cves)
                    except Exception as e:
                        scan_result.errors.append(str(e))

            scan_result.assets_found = len(scan_result.assets)
            scan_result.status = "completed"

        except Exception as e:
            scan_result.status = "failed"
            scan_result.errors.append(str(e))

        scan_result.completed_at = time.time()
        scan_result.duration = scan_result.completed_at - scan_result.started_at
        self.scans[scan_result.scan_id] = scan_result
        return scan_result

    def scan_domain(self, domain: str, ports: List[int] = None) -> ScanResult:
        """扫描域名（解析IP+关联子域名）"""
        scan_result = ScanResult(scan_type="domain", target=domain)
        scan_result.status = "running"

        try:
            # DNS解析
            ip = socket.gethostbyname(domain)
            scan_result.targets_count = 1

            # 扫描主机
            asset = self.scan_host(ip, ports)
            asset.domain = domain
            asset.hostname = domain
            scan_result.assets.append(asset)
            scan_result.assets_found = 1
            scan_result.open_ports_total = len(asset.ports)
            scan_result.services_found = len(asset.fingerprints)
            scan_result.vulnerabilities_found = len(asset.cves)
            scan_result.status = "completed"

        except socket.gaierror:
            scan_result.status = "failed"
            scan_result.errors.append(f"域名解析失败: {domain}")
        except Exception as e:
            scan_result.status = "failed"
            scan_result.errors.append(str(e))

        scan_result.completed_at = time.time()
        scan_result.duration = scan_result.completed_at - scan_result.started_at
        self.scans[scan_result.scan_id] = scan_result
        return scan_result

    def get_asset_summary(self) -> Dict:
        """获取资产汇总"""
        total = len(self.assets)
        by_risk = defaultdict(int)
        by_service = Counter()
        total_cves = 0
        total_ports = 0

        for asset in self.assets.values():
            if asset.risk_score >= 80:
                by_risk["critical"] += 1
            elif asset.risk_score >= 60:
                by_risk["high"] += 1
            elif asset.risk_score >= 30:
                by_risk["medium"] += 1
            else:
                by_risk["low"] += 1

            for port in asset.ports:
                by_service[port.service] += 1
            total_cves += len(asset.cves)
            total_ports += len(asset.ports)

        return {
            "total_assets": total,
            "by_risk": dict(by_risk),
            "top_services": by_service.most_common(10),
            "total_cves": total_cves,
            "total_open_ports": total_ports,
            "avg_risk_score": round(sum(a.risk_score for a in self.assets.values()) / total, 2) if total > 0 else 0,
        }

    def export_results(self, scan_id: str = None, format: str = "json") -> str:
        """导出扫描结果"""
        if scan_id:
            scan = self.scans.get(scan_id)
            data = scan.to_dict() if scan else {"error": "扫描不存在"}
        else:
            data = {
                "assets": [a.to_dict() for a in self.assets.values()],
                "summary": self.get_asset_summary(),
            }

        if format == "json":
            return json.dumps(data, ensure_ascii=False, indent=2)
        return str(data)
