"""
Libertas - 任务调度优化
========================
任务优先级队列、依赖管理、分片优化、失败重试。

版本：1.0.0
"""

import asyncio
import time
import hashlib
import json
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple, Set, Callable
from collections import defaultdict, deque
from enum import Enum
import heapq
import logging

logger = logging.getLogger(__name__)


class TaskPriority(Enum):
    CRITICAL = 0
    HIGH = 1
    MEDIUM = 2
    LOW = 3
    BACKGROUND = 4


@dataclass
class ScheduledTask:
    """调度任务"""
    task_id: str
    target: str
    ports: List[int]
    scan_type: str = "quick"
    priority: int = TaskPriority.MEDIUM.value
    status: str = "pending"
    dependencies: List[str] = field(default_factory=list)
    dependents: List[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    scheduled_at: float = 0.0
    started_at: float = 0.0
    completed_at: float = 0.0
    retry_count: int = 0
    max_retries: int = 3
    retry_delay: float = 5.0
    assigned_to: str = ""
    progress: float = 0.0
    result_count: int = 0
    error: str = ""
    shard_id: str = ""  # 分片ID
    parent_task_id: str = ""  # 父任务（分片后的原任务）

    def __lt__(self, other):
        return self.priority < other.priority or self.created_at < other.created_at


class TaskScheduler:
    """
    任务调度器
    优先级队列、依赖管理、分片优化、失败重试
    """

    def __init__(self, node_id: str, max_concurrent: int = 10):
        self.node_id = node_id
        self.max_concurrent = max_concurrent
        self.tasks: Dict[str, ScheduledTask] = {}
        self._priority_queue: List[Tuple[int, float, str]] = []  # (priority, created_at, task_id)
        self._running: Set[str] = set()
        self._completed: Set[str] = set()
        self._failed: Set[str] = set()
        self._lock = asyncio.Lock()
        self._scheduler_task: Optional[asyncio.Task] = None
        self._running_flag = False
        self._execute_callback: Optional[Callable] = None
        self._stats = defaultdict(int)

    def set_execute_callback(self, callback: Callable):
        self._execute_callback = callback

    async def add_task(self, target: str, ports: List[int],
                        scan_type: str = "quick",
                        priority: int = TaskPriority.MEDIUM.value,
                        dependencies: Optional[List[str]] = None,
                        shard_id: str = "",
                        parent_task_id: str = "") -> str:
        """添加任务"""
        task_id = hashlib.sha256(
            f"{target}:{ports}:{time.time()}:{self.node_id}".encode()
        ).hexdigest()[:16]

        task = ScheduledTask(
            task_id=task_id,
            target=target,
            ports=ports,
            scan_type=scan_type,
            priority=priority,
            dependencies=dependencies or [],
            shard_id=shard_id,
            parent_task_id=parent_task_id,
        )

        async with self._lock:
            self.tasks[task_id] = task
            heapq.heappush(self._priority_queue, (priority, task.created_at, task_id))

        self._stats["tasks_added"] += 1
        return task_id

    async def shard_task(self, target: str, ports: List[int],
                           scan_type: str = "quick",
                           shard_size: int = 256,
                           priority: int = TaskPriority.MEDIUM.value) -> List[str]:
        """
        任务分片（大网段拆分成小分片）

        Returns:
            子任务ID列表
        """
        import ipaddress
        try:
            network = ipaddress.ip_network(target, strict=False)
            hosts = list(network.hosts())
        except ValueError:
            # 不是CIDR，作为单个任务
            return [await self.add_task(target, ports, scan_type, priority)]

        if len(hosts) <= shard_size:
            return [await self.add_task(target, ports, scan_type, priority)]

        # 分片
        shard_ids = []
        for i in range(0, len(hosts), shard_size):
            shard_hosts = hosts[i:i + shard_size]
            shard_target = f"{shard_hosts[0]}-{shard_hosts[-1]}"
            shard_id = await self.add_task(
                shard_target, ports, scan_type, priority,
                shard_id=f"shard_{i // shard_size}",
                parent_task_id=target,
            )
            shard_ids.append(shard_id)

        self._stats["tasks_sharded"] += 1
        return shard_ids

    async def start(self):
        """启动调度器"""
        self._running_flag = True
        self._scheduler_task = asyncio.create_task(self._scheduler_loop())

    async def stop(self):
        """停止调度器"""
        self._running_flag = False
        if self._scheduler_task:
            self._scheduler_task.cancel()

    async def _scheduler_loop(self):
        """调度循环"""
        while self._running_flag:
            try:
                await self._schedule_next()
                await asyncio.sleep(0.1)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"调度器异常: {e}")
                await asyncio.sleep(1)

    async def _schedule_next(self):
        """调度下一个任务"""
        if len(self._running) >= self.max_concurrent:
            return

        async with self._lock:
            # 从优先级队列中找可执行的任务
            ready_tasks = []
            while self._priority_queue:
                priority, created_at, task_id = heapq.heappop(self._priority_queue)
                task = self.tasks.get(task_id)
                if not task or task.status != "pending":
                    continue

                # 检查依赖
                deps_met = all(
                    dep in self._completed
                    for dep in task.dependencies
                )
                if not deps_met:
                    ready_tasks.append((priority, created_at, task_id))
                    continue

                # 可以执行
                task.status = "running"
                task.started_at = time.time()
                task.assigned_to = self.node_id
                self._running.add(task_id)

                asyncio.create_task(self._execute_task(task))
                break

            # 把未就绪的任务放回队列
            for item in ready_tasks:
                heapq.heappush(self._priority_queue, item)

    async def _execute_task(self, task: ScheduledTask):
        """执行任务"""
        try:
            if self._execute_callback:
                results = await self._execute_callback(
                    task.target, task.ports, task.scan_type, {}
                )
                task.result_count = len(results) if results else 0

            task.status = "completed"
            task.completed_at = time.time()
            task.progress = 1.0

            async with self._lock:
                self._running.discard(task.task_id)
                self._completed.add(task.task_id)

            self._stats["tasks_completed"] += 1

        except Exception as e:
            task.error = str(e)
            task.retry_count += 1

            if task.retry_count < task.max_retries:
                # 重试
                task.status = "pending"
                delay = task.retry_delay * (2 ** (task.retry_count - 1))
                await asyncio.sleep(delay)
                async with self._lock:
                    heapq.heappush(
                        self._priority_queue,
                        (task.priority, task.created_at, task.task_id)
                    )
                self._stats["tasks_retried"] += 1
            else:
                task.status = "failed"
                task.completed_at = time.time()
                async with self._lock:
                    self._running.discard(task.task_id)
                    self._failed.add(task.task_id)
                self._stats["tasks_failed"] += 1

    def get_task(self, task_id: str) -> Optional[ScheduledTask]:
        return self.tasks.get(task_id)

    def get_pending_tasks(self) -> List[ScheduledTask]:
        return [t for t in self.tasks.values() if t.status == "pending"]

    def get_running_tasks(self) -> List[ScheduledTask]:
        return [t for t in self.tasks.values() if t.status == "running"]

    def get_stats(self) -> Dict:
        return {
            "total_tasks": len(self.tasks),
            "pending": len(self.get_pending_tasks()),
            "running": len(self._running),
            "completed": len(self._completed),
            "failed": len(self._failed),
            "max_concurrent": self.max_concurrent,
            "added": self._stats.get("tasks_added", 0),
            "sharded": self._stats.get("tasks_sharded", 0),
            "retried": self._stats.get("tasks_retried", 0),
        }
