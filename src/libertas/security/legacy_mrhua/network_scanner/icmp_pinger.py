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

class IcmpPinger:
    """
    ICMP Ping扫描器
    用于主机存活检测（比端口扫描快）
    """

    def __init__(self, timeout: float = 2.0, max_concurrent: int = 1000):
        self.timeout = timeout
        self.max_concurrent = max_concurrent

    async def ping(self, ip: str) -> Tuple[str, bool, float]:
        """
        Ping单个主机

        Returns:
            (ip, is_alive, latency_ms)
        """
        start = time.time()
        try:
            # 使用系统ping命令（跨平台）
            import platform
            param = "-n" if platform.system().lower() == "windows" else "-c"
            timeout_param = "-w" if platform.system().lower() == "windows" else "-W"

            proc = await asyncio.create_subprocess_exec(
                "ping", param, "1", timeout_param, str(int(self.timeout * 1000)),
                ip,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=self.timeout + 1)

            latency = (time.time() - start) * 1000
            output = stdout.decode('utf-8', errors='ignore').lower()

            is_alive = (
                "ttl=" in output or
                "time=" in output or
                "bytes=" in output or
                proc.returncode == 0
            )

            # 提取延迟
            latency_match = re.search(r'time[=<]([\d.]+)\s*ms', output)
            if latency_match:
                latency = float(latency_match.group(1))

            return ip, is_alive, latency

        except Exception:
            return ip, False, (time.time() - start) * 1000

    async def ping_sweep(self, ips: List[str],
                          progress_callback: Optional[Callable] = None) -> List[Tuple[str, bool, float]]:
        """
        批量Ping扫描

        Args:
            ips: IP列表
            progress_callback: 进度回调

        Returns:
            [(ip, is_alive, latency), ...]
        """
        semaphore = asyncio.Semaphore(self.max_concurrent)

        async def _ping_with_limit(ip):
            async with semaphore:
                return await self.ping(ip)

        tasks = [_ping_with_limit(ip) for ip in ips]
        results = []
        completed = 0

        for coro in asyncio.as_completed(tasks):
            result = await coro
            results.append(result)
            completed += 1
            if progress_callback:
                try:
                    progress_callback(result, completed, len(ips))
                except Exception:
                    pass

        return results
