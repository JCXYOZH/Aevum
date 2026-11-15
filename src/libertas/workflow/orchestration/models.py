"""职责模块：models。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.terminal import terminal
import threading
import time
import uuid

from .constants import RISK_SUGGEST

class OrchTaskStatus(Enum):
    PENDING = "pending"
    READY = "ready"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"
    COMPENSATED = "compensated"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"

class OrchTask:
    """编排任务"""

    def __init__(self, task_id: str = "", name: str = "",
                 handler: Optional[Callable] = None,
                 compensation: Optional[Callable] = None,
                 dependencies: Optional[List[str]] = None,
                 task_type: str = "normal",  # normal / condition / parallel / loop
                 condition: Optional[Callable[[Dict], bool]] = None,
                 max_retries: int = 3,
                 retry_delay: float = 5.0,
                 timeout: float = 300.0,
                 risk_level: str = RISK_SUGGEST,
                 args: tuple = (), kwargs: Optional[Dict] = None):
        self.task_id = task_id or f"orch_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.handler = handler
        self.compensation = compensation
        self.dependencies = dependencies or []
        self.task_type = task_type
        self.condition = condition
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.timeout = timeout
        self.risk_level = risk_level
        self.args = args
        self.kwargs = kwargs or {}
        self.status = OrchTaskStatus.PENDING
        self.result: Any = None
        self.error: str = ""
        self.start_time = 0.0
        self.end_time = 0.0
        self.duration_ms = 0.0
        self.retry_count = 0
        self.created_at = time.time()
        self.callbacks: List[Callable] = []

    def can_start(self, completed_ids: set) -> bool:
        return all(dep in completed_ids for dep in self.dependencies)

    def execute(self, context: Optional[Dict] = None) -> bool:
        """执行任务（支持超时控制）"""
        if not self.handler:
            self.status = OrchTaskStatus.SKIPPED
            return True

        # 条件任务：条件不满足则跳过
        if self.condition and not self.condition(context or {}):
            self.status = OrchTaskStatus.SKIPPED
            return True

        self.status = OrchTaskStatus.RUNNING
        self.start_time = time.time()

        # 触发开始回调
        self._trigger_callbacks("start")

        try:
            # 使用线程实现超时控制
            result_holder = {"value": None, "error": None, "done": False}

            def run_handler():
                try:
                    if context:
                        result_holder["value"] = self.handler(*self.args, **self.kwargs, context=context)
                    else:
                        result_holder["value"] = self.handler(*self.args, **self.kwargs)
                except Exception as e:
                    result_holder["error"] = e
                finally:
                    result_holder["done"] = True

            t = threading.Thread(target=run_handler, daemon=True)
            t.start()
            t.join(timeout=self.timeout)

            if not result_holder["done"]:
                self.status = OrchTaskStatus.TIMEOUT
                self.error = f"任务超时（{self.timeout}秒）"
                self._trigger_callbacks("timeout")
                return False

            if result_holder["error"]:
                raise result_holder["error"]

            self.result = result_holder["value"]
            self.status = OrchTaskStatus.SUCCESS
            self._trigger_callbacks("success")
            return True

        except Exception as e:
            self.error = str(e)
            if self.retry_count < self.max_retries:
                self.retry_count += 1
                self._trigger_callbacks("retry")
                time.sleep(self.retry_delay)
                return self.execute(context)
            self.status = OrchTaskStatus.FAILED
            self._trigger_callbacks("failed")
            return False
        finally:
            self.end_time = time.time()
            self.duration_ms = (self.end_time - self.start_time) * 1000

    def compensate(self) -> bool:
        """补偿操作（失败时回滚）"""
        if not self.compensation or self.status != OrchTaskStatus.SUCCESS:
            return False
        try:
            self.compensation(self.result)
            self.status = OrchTaskStatus.COMPENSATED
            return True
        except Exception:
            return False

    def _trigger_callbacks(self, event: str):
        """触发回调"""
        for cb in self.callbacks:
            try:
                cb(event, self)
            except Exception:
                pass

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id, "name": self.name,
            "task_type": self.task_type, "dependencies": self.dependencies,
            "status": self.status.value, "error": self.error,
            "duration_ms": self.duration_ms, "retry_count": self.retry_count,
            "risk_level": self.risk_level, "timeout": self.timeout,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "OrchTask":
        task = cls(
            task_id=data.get("task_id", ""),
            name=data.get("name", ""),
            task_type=data.get("task_type", "normal"),
            dependencies=data.get("dependencies", []),
            max_retries=data.get("max_retries", 3),
            retry_delay=data.get("retry_delay", 5.0),
            timeout=data.get("timeout", 300.0),
            risk_level=data.get("risk_level", RISK_SUGGEST),
        )
        task.status = OrchTaskStatus(data.get("status", "pending"))
        task.error = data.get("error", "")
        task.duration_ms = data.get("duration_ms", 0.0)
        task.retry_count = data.get("retry_count", 0)
        return task

class OrchestrationPlan:
    """编排计划（DAG）"""

    def __init__(self, name: str = "", description: str = ""):
        self.plan_id = f"plan_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.description = description
        self.tasks: Dict[str, OrchTask] = {}
        self.status = "created"
        self.created_at = time.time()
        self.updated_at = time.time()
        self.context: Dict[str, Any] = {}
        self.callbacks: List[Callable] = []

    def add_task(self, task: OrchTask) -> str:
        self.tasks[task.task_id] = task
        self.updated_at = time.time()
        return task.task_id

    def add_dynamic_task(self, task: OrchTask, after_task_id: str = "") -> str:
        """动态添加任务（执行过程中）"""
        if after_task_id and after_task_id in self.tasks:
            task.dependencies.append(after_task_id)
        self.tasks[task.task_id] = task
        self.updated_at = time.time()
        terminal.info(f"动态添加任务: {task.name}", "orchestration")
        return task.task_id

    def validate(self) -> Tuple[bool, List[str]]:
        errors = []
        # 检查依赖
        for task in self.tasks.values():
            for dep in task.dependencies:
                if dep not in self.tasks:
                    errors.append(f"任务 {task.name} 依赖不存在的任务 {dep}")
        # 环检测
        visited = set()
        rec_stack = set()

        def has_cycle(nid):
            visited.add(nid)
            rec_stack.add(nid)
            for dep in self.tasks[nid].dependencies:
                if dep not in visited:
                    if has_cycle(dep):
                        return True
                elif dep in rec_stack:
                    return True
            rec_stack.discard(nid)
            return False

        for tid in self.tasks:
            if tid not in visited and has_cycle(tid):
                errors.append("检测到循环依赖")
                break
        return len(errors) == 0, errors

    def topological_order(self) -> List[OrchTask]:
        in_degree = {tid: len(t.dependencies) for tid, t in self.tasks.items()}
        queue = [tid for tid, deg in in_degree.items() if deg == 0]
        result = []
        while queue:
            node = queue.pop(0)
            result.append(self.tasks[node])
            for tid, task in self.tasks.items():
                if node in task.dependencies:
                    in_degree[tid] -= 1
                    if in_degree[tid] == 0:
                        queue.append(tid)
        return result

    def get_progress(self) -> Dict[str, Any]:
        total = len(self.tasks)
        completed = sum(1 for t in self.tasks.values()
                        if t.status in (OrchTaskStatus.SUCCESS, OrchTaskStatus.SKIPPED,
                                        OrchTaskStatus.COMPENSATED))
        failed = sum(1 for t in self.tasks.values() if t.status == OrchTaskStatus.FAILED)
        running = sum(1 for t in self.tasks.values() if t.status == OrchTaskStatus.RUNNING)
        timeout = sum(1 for t in self.tasks.values() if t.status == OrchTaskStatus.TIMEOUT)
        return {
            "total": total, "completed": completed, "failed": failed,
            "running": running, "timeout": timeout,
            "percent": completed / total * 100 if total > 0 else 0,
        }

    def to_dict(self) -> Dict[str, Any]:
        return {
            "plan_id": self.plan_id, "name": self.name,
            "description": self.description, "status": self.status,
            "created_at": self.created_at, "updated_at": self.updated_at,
            "tasks": {tid: t.to_dict() for tid, t in self.tasks.items()},
            "progress": self.get_progress(),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "OrchestrationPlan":
        plan = cls(name=data.get("name", ""), description=data.get("description", ""))
        plan.plan_id = data.get("plan_id", plan.plan_id)
        plan.status = data.get("status", "created")
        plan.created_at = data.get("created_at", time.time())
        plan.updated_at = data.get("updated_at", time.time())
        for tid, t_data in data.get("tasks", {}).items():
            task = OrchTask.from_dict(t_data)
            plan.tasks[tid] = task
        return plan
