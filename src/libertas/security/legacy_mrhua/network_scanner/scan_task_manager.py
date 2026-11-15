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

class ScanTaskManager:
    """
    扫描任务管理器
    支持：任务队列、优先级、暂停/恢复/取消、断点续扫、进度持久化
    """

    def __init__(self, state_dir: str = "./scan_state"):
        self.state_dir = state_dir
        self.tasks: Dict[str, ScanTask] = {}
        self._lock = asyncio.Lock()
        self._running_tasks: Dict[str, asyncio.Task] = {}
        self._pause_events: Dict[str, asyncio.Event] = {}
        self._cancel_events: Dict[str, asyncio.Event] = {}

        os.makedirs(state_dir, exist_ok=True)

    def create_task(self, name: str, targets: List[str], ports: List[int],
                    technique: str = "tcp_connect", options: Optional[Dict] = None) -> ScanTask:
        """创建扫描任务"""
        import uuid
        task_id = str(uuid.uuid4())[:8]

        # 计算总目标数和总端口数
        scanner = AsyncPortScanner()
        all_ips = scanner._resolve_targets(targets)
        total_targets = len(all_ips)
        total_ports = total_targets * len(ports)

        task = ScanTask(
            task_id=task_id,
            name=name,
            targets=targets,
            ports=ports,
            technique=technique,
            total_targets=total_targets,
            total_ports=total_ports,
            options=options or {},
        )

        self.tasks[task_id] = task
        self._pause_events[task_id] = asyncio.Event()
        self._cancel_events[task_id] = asyncio.Event()

        # 保存任务状态
        self._save_state(task)

        return task

    async def start_task(self, task_id: str,
                         result_callback: Optional[Callable] = None,
                         progress_callback: Optional[Callable] = None) -> bool:
        """
        启动扫描任务

        Args:
            task_id: 任务ID
            result_callback: 结果回调(host_result)
            progress_callback: 进度回调(progress)

        Returns:
            是否成功启动
        """
        task = self.tasks.get(task_id)
        if not task:
            return False

        if task.status == "running":
            return False

        # 恢复断点
        self._load_state(task)

        task.status = "running"
        task.started_at = time.time()
        self._pause_events[task_id].set()  # 不暂停
        self._cancel_events[task_id].clear()

        # 创建异步任务
        async_task = asyncio.create_task(
            self._run_scan(task, result_callback, progress_callback)
        )
        self._running_tasks[task_id] = async_task

        return True

    async def _run_scan(self, task: ScanTask,
                         result_callback: Optional[Callable],
                         progress_callback: Optional[Callable]):
        """执行扫描任务（内部）"""
        try:
            scanner = AsyncPortScanner(
                max_concurrent=task.options.get("max_concurrent", 1000),
                timeout=task.options.get("timeout", 3.0),
                retries=task.options.get("retries", 1),
                randomize=task.options.get("randomize", True),
                rate_limit=task.options.get("rate_limit", 0),
            )

            all_ips = scanner._resolve_targets(task.targets)

            # 断点续扫：跳过已扫描的IP
            scanned = set(task.options.get("_scanned_ips", []))
            remaining = [ip for ip in all_ips if ip not in scanned]

            for i, ip in enumerate(remaining):
                # 检查暂停
                await self._pause_events[task.task_id].wait()
                # 检查取消
                if self._cancel_events[task.task_id].is_set():
                    task.status = "cancelled"
                    break

                host_result = await scanner.scan_host(ip, task.ports)

                # 更新统计
                task.scanned_targets += 1
                if host_result.status == "up":
                    task.assets_found += 1
                for p in host_result.ports:
                    if p.state == "open":
                        task.open_ports += 1
                    elif p.state == "filtered":
                        task.filtered_ports += 1
                    else:
                        task.closed_ports += 1

                task.progress = task.scanned_targets / task.total_targets * 100 if task.total_targets > 0 else 0

                # 记录已扫描IP（每10个保存一次）
                scanned.add(ip)
                if i % 10 == 0:
                    task.options["_scanned_ips"] = list(scanned)
                    self._save_state(task)

                # 回调
                if result_callback:
                    try:
                        result_callback(host_result)
                    except Exception:
                        pass
                if progress_callback:
                    try:
                        progress_callback(self._get_progress(task))
                    except Exception:
                        pass

            if task.status != "cancelled":
                task.status = "completed"
            task.completed_at = time.time()
            task.options["_scanned_ips"] = list(scanned)
            self._save_state(task)

        except Exception as e:
            task.status = "failed"
            task.error = str(e)
            task.completed_at = time.time()
            self._save_state(task)
        finally:
            self._running_tasks.pop(task.task_id, None)

    def pause_task(self, task_id: str) -> bool:
        """暂停任务"""
        if task_id in self._pause_events:
            self._pause_events[task_id].clear()
            task = self.tasks.get(task_id)
            if task:
                task.status = "paused"
            return True
        return False

    def resume_task(self, task_id: str) -> bool:
        """恢复任务"""
        if task_id in self._pause_events:
            self._pause_events[task_id].set()
            task = self.tasks.get(task_id)
            if task:
                task.status = "running"
            return True
        return False

    def cancel_task(self, task_id: str) -> bool:
        """取消任务"""
        if task_id in self._cancel_events:
            self._cancel_events[task_id].set()
            # 同时解除暂停
            self._pause_events[task_id].set()
            return True
        return False

    def get_task(self, task_id: str) -> Optional[ScanTask]:
        """获取任务信息"""
        return self.tasks.get(task_id)

    def list_tasks(self, status: Optional[str] = None) -> List[ScanTask]:
        """列出所有任务"""
        tasks = list(self.tasks.values())
        if status:
            tasks = [t for t in tasks if t.status == status]
        tasks.sort(key=lambda t: t.created_at, reverse=True)
        return tasks

    def _get_progress(self, task: ScanTask) -> ScanProgress:
        """获取进度快照"""
        elapsed = time.time() - (task.started_at or time.time())
        rate = task.scanned_targets / elapsed if elapsed > 0 else 0
        remaining = (task.total_targets - task.scanned_targets) / rate if rate > 0 else 0

        return ScanProgress(
            task_id=task.task_id,
            status=task.status,
            progress=task.progress,
            scanned_targets=task.scanned_targets,
            total_targets=task.total_targets,
            open_ports=task.open_ports,
            filtered_ports=task.filtered_ports,
            closed_ports=task.closed_ports,
            assets_found=task.assets_found,
            elapsed_time=elapsed,
            estimated_remaining=remaining,
            current_ip="",
            current_port=0,
        )

    def _save_state(self, task: ScanTask):
        """保存任务状态到磁盘（断点续扫）"""
        try:
            state_file = os.path.join(self.state_dir, f"{task.task_id}.json")
            with open(state_file, 'w', encoding='utf-8') as f:
                json.dump(task.to_dict(), f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"保存扫描任务状态失败: {e}")

    def _load_state(self, task: ScanTask):
        """从磁盘加载任务状态"""
        try:
            state_file = os.path.join(self.state_dir, f"{task.task_id}.json")
            if os.path.exists(state_file):
                with open(state_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    task.scanned_targets = data.get("scanned_targets", 0)
                    task.open_ports = data.get("open_ports", 0)
                    task.filtered_ports = data.get("filtered_ports", 0)
                    task.closed_ports = data.get("closed_ports", 0)
                    task.assets_found = data.get("assets_found", 0)
                    task.progress = data.get("progress", 0)
                    task.options = data.get("options", {})
        except Exception as e:
            logger.error(f"加载扫描任务状态失败: {e}")

    def cleanup_old_tasks(self, max_age_days: int = 7):
        """清理过期任务状态"""
        try:
            now = time.time()
            for filename in os.listdir(self.state_dir):
                if filename.endswith('.json'):
                    filepath = os.path.join(self.state_dir, filename)
                    age = now - os.path.getmtime(filepath)
                    if age > max_age_days * 86400:
                        os.remove(filepath)
        except Exception:
            pass
