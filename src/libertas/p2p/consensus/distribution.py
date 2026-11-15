"""职责模块：distribution。"""

from __future__ import annotations

from ..transport import NodeIdentity, ConnectionManager, P2PConnection, Message, ChannelType
from typing import Optional, Dict, List, Tuple, Set, Callable, Any
import asyncio
import time
import uuid

from .constants import MAX_TASKS_PER_NODE
from .constants import REPUTATION_DECREASE
from .models import ScanTask
from .constants import TASK_TIMEOUT
from .constants import logger

class TaskDistributor:
    """
    任务分片与分发器
    按节点能力、当前负载、信誉分配任务
    """

    def __init__(self, consensus: "ConsensusEngine"):
        self.consensus = consensus
        self.tasks: Dict[str, ScanTask] = {}
        self._task_lock = asyncio.Lock()
        self._reassign_task: Optional[asyncio.Task] = None

    async def create_task(self, target: str, ports: List[int],
                           scan_type: str = "quick", priority: int = 0,
                           options: Optional[Dict] = None) -> ScanTask:
        """创建扫描任务"""
        task = ScanTask(
            task_id=str(uuid.uuid4())[:8],
            creator=self.consensus.identity.node_id,
            target=target,
            ports=ports,
            scan_type=scan_type,
            priority=priority,
            options=options or {},
            reputation_stake=min(0.1, self.consensus.get_reputation(self.consensus.identity.node_id) * 0.1),
        )

        async with self._task_lock:
            self.tasks[task.task_id] = task

        # 广播任务到网络
        await self._broadcast_task(task)

        # 尝试分配
        await self._assign_task(task)

        return task

    async def _broadcast_task(self, task: ScanTask):
        """广播任务到网络"""
        msg = Message(
            channel=ChannelType.SCAN.value,
            message_type="SCAN_TASK",
            payload=task.to_dict(),
            source_node=self.consensus.identity.node_id,
        )
        await self.consensus.protocol.broadcast_message(
            "SCAN_TASK", task.to_dict(), channel=ChannelType.SCAN.value
        )

    async def _assign_task(self, task: ScanTask) -> bool:
        """
        分配任务给最合适的节点

        选择标准：
        1. 有对应能力
        2. 当前负载最低
        3. 信誉最高
        4. 网络延迟最低
        """
        candidates = await self._find_candidates(task)
        if not candidates:
            # 没有合适的候选节点，自己执行
            task.assigned_to = self.consensus.identity.node_id
            task.status = "assigned"
            task.assigned_at = time.time()
            asyncio.create_task(self._execute_task_local(task))
            return True

        # 选择最佳候选
        best = candidates[0]
        task.assigned_to = best["node_id"]
        task.status = "assigned"
        task.assigned_at = time.time()

        # 发送任务分配通知
        await self.consensus.protocol.send_message(
            best["node_id"], "SCAN_TASK_ASSIGN",
            task.to_dict(), channel=ChannelType.SCAN.value
        )

        return True

    async def _find_candidates(self, task: ScanTask) -> List[Dict]:
        """找到合适的候选节点"""
        candidates = []
        connected_nodes = self.consensus.protocol.conn_manager.get_all_connections()

        for conn in connected_nodes:
            node_id = conn.node_id
            if not node_id:
                continue

            # 检查是否被隔离
            if self.consensus.is_isolated(node_id):
                continue

            # 检查能力
            node_info = self.consensus.protocol.get_node_info(node_id)
            if not node_info:
                continue

            caps = node_info.capabilities
            if task.scan_type == "vuln_verify" and not caps.get("vuln_verify", False):
                continue
            if task.scan_type == "weak_password" and not caps.get("weak_password", False):
                continue

            # 检查当前负载
            node_tasks = [t for t in self.tasks.values()
                          if t.assigned_to == node_id and t.status in ("assigned", "running")]
            if len(node_tasks) >= MAX_TASKS_PER_NODE:
                continue

            # 计算综合评分
            reputation = self.consensus.get_reputation(node_id)
            latency = conn.stats.latency_ms
            load = len(node_tasks) / MAX_TASKS_PER_NODE

            score = reputation * 0.5 + (1 - load) * 0.3 + (1 - min(latency / 1000, 1)) * 0.2

            candidates.append({
                "node_id": node_id,
                "score": score,
                "reputation": reputation,
                "latency": latency,
                "load": load,
            })

        # 按评分排序
        candidates.sort(key=lambda x: x["score"], reverse=True)
        return candidates[:5]  # 返回前5个候选

    async def _execute_task_local(self, task: ScanTask):
        """本地执行任务"""
        task.status = "running"
        try:
            # 调用实际的扫描引擎（由上层注入）
            if self.consensus.scan_executor:
                results = await self.consensus.scan_executor(
                    task.target, task.ports, task.scan_type, task.options
                )
                task.result_count = len(results)

                # 提交结果
                for result_data in results:
                    await self.consensus.result_gossip.submit_result(task, result_data)

            task.status = "completed"
            task.completed_at = time.time()

            # 增加完成任务计数
            self.consensus.reputation_system.record_task_completed(
                self.consensus.identity.node_id
            )

        except Exception as e:
            task.status = "failed"
            task.completed_at = time.time()
            logger.error(f"任务执行失败 {task.task_id}: {e}")

            # 记录失败
            self.consensus.reputation_system.record_task_failed(
                self.consensus.identity.node_id
            )

        # 广播任务完成
        await self.consensus.protocol.broadcast_message(
            "TASK_COMPLETE", task.to_dict(), channel=ChannelType.SCAN.value
        )

    async def handle_task_assignment(self, task_data: Dict):
        """处理被分配的任务"""
        task_id = task_data.get("task_id", "")
        if task_id in self.tasks:
            task = self.tasks[task_id]
        else:
            task = ScanTask(**{k: v for k, v in task_data.items()
                               if k in ScanTask.__dataclass_fields__})
            self.tasks[task_id] = task

        task.assigned_to = self.consensus.identity.node_id
        task.status = "assigned"
        task.assigned_at = time.time()

        # 本地执行
        asyncio.create_task(self._execute_task_local(task))

    async def check_timeouts(self):
        """检查超时任务并重新分配"""
        now = time.time()
        for task in list(self.tasks.values()):
            if task.status in ("assigned", "running"):
                if now - task.assigned_at > TASK_TIMEOUT:
                    # 任务超时
                    task.status = "timeout"

                    # 扣除执行者信誉
                    if task.assigned_to and task.assigned_to != self.consensus.identity.node_id:
                        self.consensus.reputation_system.decrease_reputation(
                            task.assigned_to, REPUTATION_DECREASE
                        )

                    # 退还创建者抵押
                    # 重新分配
                    await self._assign_task(task)

    def get_task(self, task_id: str) -> Optional[ScanTask]:
        return self.tasks.get(task_id)

    def get_all_tasks(self) -> List[ScanTask]:
        return list(self.tasks.values())

    async def start_reassign_loop(self):
        """启动任务超时检查循环"""
        while True:
            try:
                await self.check_timeouts()
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"任务重分配异常: {e}")
                await asyncio.sleep(30)
