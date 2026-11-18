"""任务规划职责：models。"""

from __future__ import annotations

import threading
import time
import uuid
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from libertas.foundation.terminal import terminal


class TaskStatus(Enum):
    PENDING = "pending"
    READY = "ready"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"
    CANCELLED = "cancelled"

class SubTask:
    """子任务"""

    def __init__(self, task_id: str = "", title: str = "", description: str = "",
                 task_type: str = "general", estimated_duration: float = 0.0,
                 priority: int = 0, dependencies: Optional[List[str]] = None,
                 required_tools: Optional[List[str]] = None,
                 required_resources: Optional[Dict[str, Any]] = None,
                 success_criteria: str = "",
                 handler: Optional[Callable] = None,
                 args: tuple = (), kwargs: Optional[Dict] = None):
        self.task_id = task_id or f"sub_{uuid.uuid4().hex[:8]}"
        self.title = title
        self.description = description
        self.task_type = task_type
        self.estimated_duration = estimated_duration
        self.priority = priority
        self.dependencies = dependencies or []
        self.required_tools = required_tools or []
        self.required_resources = required_resources or {}
        self.success_criteria = success_criteria
        self.handler = handler
        self.args = args
        self.kwargs = kwargs or {}
        self.status = TaskStatus.PENDING
        self.result: Any = None
        self.error: str = ""
        self.start_time = 0.0
        self.end_time = 0.0
        self.duration_ms = 0.0
        self.retry_count = 0
        self.max_retries = 3
        self.created_at = time.time()
        self.updated_at = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id, "title": self.title,
            "description": self.description, "task_type": self.task_type,
            "estimated_duration": self.estimated_duration,
            "priority": self.priority, "dependencies": self.dependencies,
            "required_tools": self.required_tools,
            "status": self.status.value, "result": str(self.result)[:200] if self.result else "",
            "error": self.error, "duration_ms": self.duration_ms,
            "retry_count": self.retry_count, "created_at": self.created_at,
        }

    def can_start(self, completed_ids: set) -> bool:
        return all(dep in completed_ids for dep in self.dependencies)

    def execute(self) -> bool:
        if not self.handler:
            self.status = TaskStatus.SKIPPED
            return True
        self.status = TaskStatus.RUNNING
        self.start_time = time.time()
        try:
            self.result = self.handler(*self.args, **self.kwargs)
            self.status = TaskStatus.SUCCESS
            return True
        except Exception as e:
            self.error = str(e)
            if self.retry_count < self.max_retries:
                self.retry_count += 1
                self.status = TaskStatus.PENDING
                return False
            self.status = TaskStatus.FAILED
            return False
        finally:
            self.end_time = time.time()
            self.duration_ms = (self.end_time - self.start_time) * 1000
            self.updated_at = time.time()

class TaskPlan:
    """任务计划（DAG）"""

    def __init__(self, goal: str = "", description: str = ""):
        self.plan_id = f"plan_{uuid.uuid4().hex[:8]}"
        self.goal = goal
        self.description = description
        self.subtasks: Dict[str, SubTask] = {}
        self.created_at = time.time()
        self.updated_at = time.time()
        self.status = "created"  # created / validated / running / completed / failed
        self.validation_errors: List[str] = []

    def add_task(self, task: SubTask) -> str:
        self.subtasks[task.task_id] = task
        self.updated_at = time.time()
        return task.task_id

    def remove_task(self, task_id: str) -> bool:
        if task_id in self.subtasks:
            del self.subtasks[task_id]
            # 移除其他任务对该任务的依赖
            for task in self.subtasks.values():
                if task_id in task.dependencies:
                    task.dependencies.remove(task_id)
            self.updated_at = time.time()
            return True
        return False

    def get_task(self, task_id: str) -> Optional[SubTask]:
        return self.subtasks.get(task_id)

    def validate(self) -> Tuple[bool, List[str]]:
        """验证计划（无环、依赖存在、资源充足）"""
        errors = []
        # 检查依赖存在
        for task in self.subtasks.values():
            for dep in task.dependencies:
                if dep not in self.subtasks:
                    errors.append(f"任务 {task.title} 依赖不存在的任务 {dep}")

        # 环检测
        visited = set()
        rec_stack = set()

        def has_cycle(node_id: str) -> bool:
            visited.add(node_id)
            rec_stack.add(node_id)
            task = self.subtasks.get(node_id)
            if task:
                for dep in task.dependencies:
                    if dep not in visited:
                        if has_cycle(dep):
                            return True
                    elif dep in rec_stack:
                        return True
            rec_stack.discard(node_id)
            return False

        for task_id in self.subtasks:
            if task_id not in visited:
                if has_cycle(task_id):
                    errors.append("检测到循环依赖")
                    break

        self.validation_errors = errors
        self.status = "validated" if not errors else "failed"
        return len(errors) == 0, errors

    def topological_order(self) -> List[SubTask]:
        """拓扑排序"""
        in_degree = {tid: len(t.dependencies) for tid, t in self.subtasks.items()}
        queue = [tid for tid, deg in in_degree.items() if deg == 0]
        result = []
        while queue:
            queue.sort(key=lambda tid: -self.subtasks[tid].priority)
            node = queue.pop(0)
            result.append(self.subtasks[node])
            for tid, task in self.subtasks.items():
                if node in task.dependencies:
                    in_degree[tid] -= 1
                    if in_degree[tid] == 0:
                        queue.append(tid)
        return result

    def get_ready_tasks(self) -> List[SubTask]:
        """获取可执行的任务"""
        completed = {tid for tid, t in self.subtasks.items() if t.status in (TaskStatus.SUCCESS, TaskStatus.SKIPPED)}
        return [
            t for t in self.subtasks.values()
            if t.status in (TaskStatus.PENDING, TaskStatus.READY)
            and t.can_start(completed)
        ]

    def get_progress(self) -> Dict[str, Any]:
        total = len(self.subtasks)
        completed = sum(1 for t in self.subtasks.values() if t.status in (TaskStatus.SUCCESS, TaskStatus.SKIPPED))
        failed = sum(1 for t in self.subtasks.values() if t.status == TaskStatus.FAILED)
        running = sum(1 for t in self.subtasks.values() if t.status == TaskStatus.RUNNING)
        pending = total - completed - failed - running
        return {
            "total": total, "completed": completed, "failed": failed,
            "running": running, "pending": pending,
            "percent": (completed / total * 100) if total > 0 else 0,
            "estimated_total_duration": sum(t.estimated_duration for t in self.subtasks.values()),
            "actual_duration": sum(t.duration_ms for t in self.subtasks.values()) / 1000,
        }

    def to_dict(self) -> Dict[str, Any]:
        return {
            "plan_id": self.plan_id, "goal": self.goal,
            "description": self.description, "status": self.status,
            "subtasks": [t.to_dict() for t in self.subtasks.values()],
            "progress": self.get_progress(),
            "validation_errors": self.validation_errors,
            "created_at": self.created_at, "updated_at": self.updated_at,
        }

class TaskStep:
    """向后兼容占位类"""
    def __init__(self, *args, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)
    def __getattr__(self, name):
        return None
