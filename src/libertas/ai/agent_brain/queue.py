"""
core/agent_brain.py - Agent自主循环大脑

核心能力：七阶段自主循环（感知→思考→规划→决策→执行→观察→反思→学习）、
状态机驱动、任务动态规划、多策略决策、上下文智能裁剪、反思学习闭环、
目标层级管理、注意力聚焦、自我监控、可中断可恢复。
整合记忆库、工具库、代码库三大本地化能力。
"""
import os
import sys
import json
import time
import uuid
import math
import hashlib
import threading
import re
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter, defaultdict
from enum import Enum
from libertas.foundation.terminal import terminal


from .enums import AgentPhase, DecisionStrategy, GoalType, TaskPriority, TaskStatus
from .models import AgentState, CycleRecord, Goal, Task



class TaskQueue:
    """任务队列 - 支持优先级、依赖、并发控制的任务队列"""

    def __init__(self, max_concurrent: int = 3):
        self.tasks = []
        self.completed = []
        self.failed = []
        self.max_concurrent = max_concurrent
        self.running = []
        self._lock = threading.RLock()

    def add_task(self, task_id: str, description: str, priority: int = 5,
                 dependencies: List[str] = None, task_type: str = "general",
                 payload: Dict = None) -> Dict:
        """添加任务"""
        with self._lock:
            task = {
                "task_id": task_id,
                "description": description,
                "priority": priority,
                "dependencies": dependencies or [],
                "task_type": task_type,
                "payload": payload or {},
                "status": "pending",
                "created_at": time.time(),
                "started_at": None,
                "completed_at": None,
                "result": None,
                "error": None,
                "retry_count": 0,
            }
            self.tasks.append(task)
            self._sort_tasks()
            return task

    def _sort_tasks(self):
        """按优先级排序"""
        self.tasks.sort(key=lambda t: (t["priority"], t["created_at"]))

    def get_next_task(self) -> Optional[Dict]:
        """获取下一个可执行任务（依赖已完成、未在运行）"""
        with self._lock:
            if len(self.running) >= self.max_concurrent:
                return None
            completed_ids = {t["task_id"] for t in self.completed}
            for task in self.tasks:
                if task["status"] != "pending":
                    continue
                if all(dep in completed_ids for dep in task["dependencies"]):
                    task["status"] = "running"
                    task["started_at"] = time.time()
                    self.running.append(task["task_id"])
                    return task
            return None

    def complete_task(self, task_id: str, result: Any = None) -> Optional[Dict]:
        """完成任务"""
        with self._lock:
            for task in self.tasks:
                if task["task_id"] == task_id:
                    task["status"] = "completed"
                    task["completed_at"] = time.time()
                    task["result"] = result
                    self.tasks.remove(task)
                    self.completed.append(task)
                    if task_id in self.running:
                        self.running.remove(task_id)
                    return task
            return None

    def fail_task(self, task_id: str, error: str, retry: bool = False) -> Optional[Dict]:
        """任务失败"""
        with self._lock:
            for task in self.tasks:
                if task["task_id"] == task_id:
                    task["error"] = error
                    task["retry_count"] += 1
                    if retry and task["retry_count"] < 3:
                        task["status"] = "pending"
                    else:
                        task["status"] = "failed"
                        task["completed_at"] = time.time()
                        self.tasks.remove(task)
                        self.failed.append(task)
                    if task_id in self.running:
                        self.running.remove(task_id)
                    return task
            return None

    def get_queue_stats(self) -> Dict:
        """获取队列统计"""
        with self._lock:
            return {
                "pending": len(self.tasks),
                "running": len(self.running),
                "completed": len(self.completed),
                "failed": len(self.failed),
                "total": len(self.tasks) + len(self.completed) + len(self.failed),
                "max_concurrent": self.max_concurrent,
                "by_type": self._count_by_type(),
            }

    def _count_by_type(self) -> Dict:
        types = {}
        for t in self.tasks + self.completed + self.failed:
            ttype = t.get("task_type", "general")
            types[ttype] = types.get(ttype, 0) + 1
        return types

    def get_pending_tasks(self) -> List[Dict]:
        """获取待处理任务"""
        return list(self.tasks)

    def clear_completed(self):
        """清理已完成任务"""
        self.completed.clear()
        self.failed.clear()
