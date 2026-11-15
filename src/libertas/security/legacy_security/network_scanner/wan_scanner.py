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
from .intelligence_collector import *  # noqa: F401,F403
from .scan_task_manager import *  # noqa: F401,F403

class WanScanner:
    """
    广域网扫描引擎（统一入口）
    整合：异步端口扫描、ICMP Ping、情报收集、任务管理
    """

    def __init__(self, max_concurrent: int = 1000, timeout: float = 3.0,
                 state_dir: str = "./scan_state"):
        self.port_scanner = AsyncPortScanner(
            max_concurrent=max_concurrent, timeout=timeout
        )
        self.pinger = IcmpPinger(timeout=timeout, max_concurrent=max_concurrent)
        self.intelligence = IntelligenceCollector(timeout=timeout, max_concurrent=max_concurrent)
        self.task_manager = ScanTaskManager(state_dir=state_dir)

    async def quick_scan(self, target: str, ports: Optional[List[int]] = None,
                          with_intelligence: bool = False) -> Dict:
        """
        快速扫描单个目标

        Args:
            target: IP/CIDR/域名
            ports: 端口列表（默认Top 100）
            with_intelligence: 是否收集情报

        Returns:
            扫描结果字典
        """
        if ports is None:
            ports = PORT_PRESETS["top_100"]

        result = {
            "target": target,
            "scan_time": time.time(),
            "hosts": [],
            "intelligence": {},
        }

        # 解析目标
        ips = self.port_scanner._resolve_targets([target])

        # 先Ping检测存活
        ping_results = await self.pinger.ping_sweep(ips)
        alive_ips = [ip for ip, alive, _ in ping_results if alive]

        # 只扫描存活主机
        scan_tasks = [self.port_scanner.scan_host(ip, ports) for ip in alive_ips]
        host_results = await asyncio.gather(*scan_tasks, return_exceptions=True)

        for hr in host_results:
            if not isinstance(hr, Exception):
                result["hosts"].append(hr.to_dict())

        # 收集情报
        if with_intelligence:
            try:
                result["intelligence"] = await self.intelligence.collect_all(target)
            except Exception:
                pass

        result["summary"] = {
            "total_ips": len(ips),
            "alive_hosts": len(alive_ips),
            "open_ports": sum(1 for h in result["hosts"] for p in h["ports"] if p["state"] == "open"),
            "scan_duration": time.time() - result["scan_time"],
        }

        return result

    async def deep_scan(self, target: str, ports: Optional[List[int]] = None,
                         with_intelligence: bool = True,
                         with_cve: bool = True) -> Dict:
        """
        深度扫描（端口扫描 + 情报收集 + CVE关联）

        Args:
            target: IP/CIDR/域名
            ports: 端口列表（默认Top 1000）
            with_intelligence: 是否收集情报
            with_cve: 是否关联CVE

        Returns:
            深度扫描结果
        """
        if ports is None:
            ports = PORT_PRESETS["top_1000"]

        result = await self.quick_scan(target, ports, with_intelligence)

        # CVE关联（需要导入NetworkSpaceMapper）
        if with_cve:
            try:
                from .network_space_mapper import NetworkSpaceMapper
                mapper = NetworkSpaceMapper()
                for host in result["hosts"]:
                    asset = mapper._dict_to_asset(host) if hasattr(mapper, '_dict_to_asset') else None
                    if asset:
                        mapper._correlate_cves(asset)
                        host["cves"] = asset.cves
                        host["risk_score"] = mapper._calculate_risk_score(asset)
            except Exception:
                pass

        result["scan_type"] = "deep"
        return result

    def create_scan_task(self, name: str, targets: List[str],
                         ports: Optional[List[int]] = None,
                         **options) -> ScanTask:
        """
        创建大规模扫描任务（支持断点续扫）

        Args:
            name: 任务名称
            targets: 目标列表
            ports: 端口列表（默认Top 100）
            **options: 其他选项（max_concurrent, timeout, retries, rate_limit等）

        Returns:
            ScanTask
        """
        if ports is None:
            ports = PORT_PRESETS["top_100"]

        return self.task_manager.create_task(name, targets, ports, options=options)

    async def start_scan_task(self, task_id: str,
                               result_callback: Optional[Callable] = None,
                               progress_callback: Optional[Callable] = None) -> bool:
        """启动扫描任务"""
        return await self.task_manager.start_task(task_id, result_callback, progress_callback)

    def pause_scan_task(self, task_id: str) -> bool:
        """暂停扫描任务"""
        return self.task_manager.pause_task(task_id)

    def resume_scan_task(self, task_id: str) -> bool:
        """恢复扫描任务"""
        return self.task_manager.resume_task(task_id)

    def cancel_scan_task(self, task_id: str) -> bool:
        """取消扫描任务"""
        return self.task_manager.cancel_task(task_id)

    def get_scan_task(self, task_id: str) -> Optional[ScanTask]:
        """获取扫描任务状态"""
        return self.task_manager.get_task(task_id)

    def list_scan_tasks(self, status: Optional[str] = None) -> List[ScanTask]:
        """列出所有扫描任务"""
        return self.task_manager.list_tasks(status)

    @staticmethod
    def get_port_preset(name: str) -> List[int]:
        """获取端口预设"""
        return PORT_PRESETS.get(name, PORT_PRESETS["top_100"])

    @staticmethod
    def list_port_presets() -> Dict[str, int]:
        """列出所有端口预设及其端口数"""
        return {name: len(ports) for name, ports in PORT_PRESETS.items()}
