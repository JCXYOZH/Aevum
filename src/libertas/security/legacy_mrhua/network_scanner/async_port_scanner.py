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

class AsyncPortScanner:
    """
    异步IO端口扫描器
    基于asyncio + 自定义信号量控制并发
    """

    # 常见端口服务映射
    COMMON_SERVICES = {
        21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns",
        80: "http", 110: "pop3", 111: "rpcbind", 135: "msrpc", 139: "netbios-ssn",
        143: "imap", 443: "https", 445: "microsoft-ds", 465: "smtps",
        587: "submission", 631: "ipp", 873: "rsync", 990: "ftps", 993: "imaps",
        995: "pop3s", 1080: "socks", 1433: "mssql", 1521: "oracle", 1723: "pptp",
        2049: "nfs", 2375: "docker", 2376: "docker-tls", 3000: "http-alt",
        3306: "mysql", 3389: "ms-wbt-server", 5000: "upnp", 5432: "postgresql",
        5601: "kibana", 5672: "amqp", 5900: "vnc", 5984: "couchdb",
        6379: "redis", 6443: "kubernetes", 7001: "weblogic", 8000: "http-alt",
        8080: "http-proxy", 8086: "influxdb", 8443: "https-alt", 8888: "http-alt",
        9000: "http-alt", 9090: "http-alt", 9200: "elasticsearch", 9300: "elasticsearch",
        11211: "memcached", 15672: "rabbitmq", 27017: "mongodb", 50070: "hadoop",
    }

    def __init__(self, max_concurrent: int = 1000, timeout: float = 3.0,
                 retries: int = 1, randomize: bool = True, rate_limit: int = 0):
        """
        Args:
            max_concurrent: 最大并发连接数
            timeout: 连接超时（秒）
            retries: 失败重试次数
            randomize: 是否随机化扫描顺序
            rate_limit: 每秒最大请求数（0表示不限制）
        """
        self.max_concurrent = max_concurrent
        self.timeout = timeout
        self.retries = retries
        self.randomize = randomize
        self.rate_limit = rate_limit
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._rate_limiter = asyncio.Lock()
        self._last_request_time = 0.0
        self._request_count = 0

    async def _acquire_rate(self):
        """速率控制"""
        if self.rate_limit <= 0:
            return
        async with self._rate_limiter:
            now = time.time()
            elapsed = now - self._last_request_time
            if elapsed < 1.0 / self.rate_limit:
                await asyncio.sleep(1.0 / self.rate_limit - elapsed)
            self._last_request_time = time.time()
            self._request_count += 1

    async def scan_port(self, ip: str, port: int, protocol: str = "tcp") -> PortScanResult:
        """
        异步扫描单个端口

        Args:
            ip: 目标IP
            port: 目标端口
            protocol: 协议（tcp/udp）

        Returns:
            PortScanResult
        """
        await self._acquire_rate()
        start_time = time.time()

        for attempt in range(self.retries + 1):
            try:
                async with self._semaphore:
                    if protocol == "udp":
                        result = await self._scan_udp(ip, port)
                    else:
                        result = await self._scan_tcp_connect(ip, port)

                    result.latency = (time.time() - start_time) * 1000
                    return result

            except asyncio.TimeoutError:
                if attempt < self.retries:
                    await asyncio.sleep(0.1 * (attempt + 1))
                    continue
                return PortScanResult(
                    ip=ip, port=port, state="filtered",
                    service=self.COMMON_SERVICES.get(port, ""),
                    protocol=protocol, latency=(time.time() - start_time) * 1000,
                    reason="timeout"
                )
            except Exception as e:
                if attempt < self.retries:
                    await asyncio.sleep(0.1 * (attempt + 1))
                    continue
                return PortScanResult(
                    ip=ip, port=port, state="filtered",
                    service=self.COMMON_SERVICES.get(port, ""),
                    protocol=protocol, latency=(time.time() - start_time) * 1000,
                    reason=str(e)
                )

        return PortScanResult(
            ip=ip, port=port, state="filtered",
            service=self.COMMON_SERVICES.get(port, ""),
            protocol=protocol, latency=(time.time() - start_time) * 1000,
            reason="max_retries"
        )

    async def _scan_tcp_connect(self, ip: str, port: int) -> PortScanResult:
        """TCP connect扫描"""
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(ip, port),
                timeout=self.timeout
            )
            # 尝试获取Banner
            banner = ""
            service = self.COMMON_SERVICES.get(port, "")
            version = ""

            try:
                # 发送换行触发Banner
                writer.write(b"\r\n")
                await writer.drain()
                data = await asyncio.wait_for(reader.read(1024), timeout=1.0)
                if data:
                    banner = data.decode('utf-8', errors='ignore').strip()[:200]
                    service, version = self._parse_banner(banner, port)
            except Exception:
                pass

            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

            return PortScanResult(
                ip=ip, port=port, state="open",
                service=service, version=version, banner=banner,
                protocol="tcp", reason="syn-ack"
            )
        except (ConnectionRefusedError, OSError) as e:
            if "refused" in str(e).lower() or "10061" in str(e):
                return PortScanResult(
                    ip=ip, port=port, state="closed",
                    service=self.COMMON_SERVICES.get(port, ""),
                    protocol="tcp", reason="rst"
                )
            return PortScanResult(
                ip=ip, port=port, state="filtered",
                service=self.COMMON_SERVICES.get(port, ""),
                protocol="tcp", reason=str(e)
            )

    async def _scan_udp(self, ip: str, port: int) -> PortScanResult:
        """UDP扫描（简化版）"""
        try:
            # UDP扫描通过发送空包，等待ICMP端口不可达
            loop = asyncio.get_event_loop()
            transport, protocol = await loop.create_datagram_endpoint(
                asyncio.DatagramProtocol,
                remote_addr=(ip, port)
            )
            transport.sendto(b"\x00" * 8)
            await asyncio.sleep(0.5)
            transport.close()

            # UDP扫描结果不确定，标记为open|filtered
            return PortScanResult(
                ip=ip, port=port, state="open|filtered",
                service=self.COMMON_SERVICES.get(port, ""),
                protocol="udp", reason="no-response"
            )
        except Exception as e:
            return PortScanResult(
                ip=ip, port=port, state="filtered",
                service=self.COMMON_SERVICES.get(port, ""),
                protocol="udp", reason=str(e)
            )

    def _parse_banner(self, banner: str, port: int) -> Tuple[str, str]:
        """从Banner中解析服务名和版本"""
        banner_lower = banner.lower()

        # SSH
        if "ssh" in banner_lower:
            match = re.search(r'SSH-([\d.]+)-(.*)', banner)
            if match:
                return "ssh", match.group(2).strip()[:50]
            return "ssh", ""

        # FTP
        if "ftp" in banner_lower or port == 21:
            match = re.search(r'([\w.-]+) ftp server', banner_lower)
            if match:
                return "ftp", match.group(1)
            return "ftp", ""

        # SMTP
        if "smtp" in banner_lower or "esmtp" in banner_lower or port in (25, 465, 587):
            return "smtp", ""

        # MySQL
        if port == 3306:
            match = re.search(r'([\d.]+)-\w+', banner)
            if match:
                return "mysql", match.group(1)
            return "mysql", ""

        # Redis
        if port == 6379 or "redis" in banner_lower:
            return "redis", ""

        # MongoDB
        if port == 27017:
            return "mongodb", ""

        # HTTP
        if port in (80, 8080, 8000, 8888) or "http" in banner_lower:
            return "http", ""

        # 默认
        return self.COMMON_SERVICES.get(port, ""), ""

    async def scan_host(self, ip: str, ports: List[int],
                        progress_callback: Optional[Callable] = None) -> HostScanResult:
        """
        异步扫描单个主机的多个端口

        Args:
            ip: 目标IP
            ports: 端口列表
            progress_callback: 进度回调函数(result, current, total)

        Returns:
            HostScanResult
        """
        host_result = HostScanResult(ip=ip)
        total = len(ports)

        if self.randomize:
            ports = ports.copy()
            random.shuffle(ports)

        # 创建所有端口扫描任务
        tasks = [self.scan_port(ip, port) for port in ports]

        completed = 0
        for coro in asyncio.as_completed(tasks):
            result = await coro
            completed += 1
            if result.state == "open":
                host_result.ports.append(result)
            elif result.state == "filtered":
                host_result.ports.append(result)

            if progress_callback:
                try:
                    progress_callback(result, completed, total)
                except Exception:
                    pass

        # 按端口号排序
        host_result.ports.sort(key=lambda p: p.port)

        # 主机状态判断
        open_count = sum(1 for p in host_result.ports if p.state == "open")
        host_result.status = "up" if open_count > 0 else "down"

        return host_result

    async def scan_network(self, targets: List[str], ports: List[int],
                           progress_callback: Optional[Callable] = None,
                           batch_size: int = 256) -> List[HostScanResult]:
        """
        异步扫描多个目标（支持IP/CIDR/域名混合）

        Args:
            targets: 目标列表（IP/CIDR/域名）
            ports: 端口列表
            progress_callback: 进度回调
            batch_size: 每批扫描的主机数

        Returns:
            HostScanResult列表
        """
        # 解析所有目标为IP列表
        all_ips = self._resolve_targets(targets)
        total_hosts = len(all_ips)
        results = []

        if self.randomize:
            random.shuffle(all_ips)

        # 分批扫描
        for batch_start in range(0, total_hosts, batch_size):
            batch = all_ips[batch_start:batch_start + batch_size]
            batch_tasks = [self.scan_host(ip, ports) for ip in batch]

            for coro in asyncio.as_completed(batch_tasks):
                host_result = await coro
                if host_result.status == "up":
                    results.append(host_result)

                if progress_callback:
                    try:
                        progress_callback(host_result, len(results), total_hosts)
                    except Exception:
                        pass

        return results

    def _resolve_targets(self, targets: List[str]) -> List[str]:
        """
        解析目标列表为IP列表
        支持：单个IP、CIDR网段、IP范围、域名
        """
        ips = []
        for target in targets:
            target = target.strip()
            if not target:
                continue

            # CIDR
            if "/" in target:
                try:
                    network = ipaddress.ip_network(target, strict=False)
                    ips.extend([str(ip) for ip in network.hosts()])
                except ValueError:
                    pass
                continue

            # IP范围 (192.168.1.1-192.168.1.254 或 192.168.1.1-254)
            if "-" in target:
                try:
                    parts = target.split("-")
                    if len(parts) == 2:
                        start_ip = ipaddress.ip_address(parts[0].strip())
                        if "." in parts[1]:
                            end_ip = ipaddress.ip_address(parts[1].strip())
                        else:
                            # 只给了最后一段
                            start_parts = parts[0].split(".")
                            end_ip = ipaddress.ip_address(
                                f"{start_parts[0]}.{start_parts[1]}.{start_parts[2]}.{parts[1].strip()}"
                            )
                        current = int(start_ip)
                        end = int(end_ip)
                        while current <= end:
                            ips.append(str(ipaddress.ip_address(current)))
                            current += 1
                except (ValueError, IndexError):
                    pass
                continue

            # 单个IP
            try:
                ipaddress.ip_address(target)
                ips.append(target)
                continue
            except ValueError:
                pass

            # 域名（DNS解析）
            try:
                resolved = socket.getaddrinfo(target, None)
                for info in resolved:
                    ip = info[4][0]
                    if ip not in ips:
                        ips.append(ip)
            except socket.gaierror:
                pass

        # 去重
        return list(dict.fromkeys(ips))
