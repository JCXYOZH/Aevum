"""
core/task_queue.py - 后台任务队列与调度系统

任务队列、优先级调度、并发执行、任务依赖、重试、死信队列、任务持久化。
"""
import os
import json
import time
import uuid
import threading
import queue
import concurrent.futures
from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


# ================================================================
# 任务状态
# ================================================================
_current_task_local = threading.local()


def current_task() -> Optional["Task"]:
    """返回当前线程正在执行的 Task，不在任务上下文中时为 None。

    Task.execute() 只把 self.args 传给 handler，**不会注入 task 自身**。
    因此 handler 若需要上报进度或读任务信息，必须经由这个通道，
    否则进度条会永远停在 0（历史缺陷：视频生成正是如此）。
    """
    return getattr(_current_task_local, "task", None)


class TaskStatus(Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    RETRYING = "retrying"
    CANCELLED = "cancelled"
    DEAD_LETTER = "dead_letter"


# ================================================================
# 任务优先级
# ================================================================
class TaskPriority(Enum):
    LOW = 1
    NORMAL = 2
    HIGH = 3
    CRITICAL = 4


# ================================================================
# 任务对象
# ================================================================
class Task:
    """任务对象"""

    def __init__(self, name: str = "", handler: Optional[Callable] = None,
                 args: tuple = (), kwargs: Optional[Dict[str, Any]] = None,
                 priority: int = 2, max_retries: int = 3,
                 retry_delay: float = 5.0, timeout: float = 300.0,
                 dependencies: Optional[List[str]] = None,
                 task_type: str = "general"):
        self.task_id = f"task_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.handler = handler
        self.args = args
        self.kwargs = kwargs or {}
        self.priority = priority
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.timeout = timeout
        self.dependencies = dependencies or []
        self.task_type = task_type
        self.status = TaskStatus.PENDING
        self.result: Any = None
        self.error = ""
        self.retry_count = 0
        self.created_at = time.time()
        self.queued_at = 0.0
        self.started_at = 0.0
        self.completed_at = 0.0
        self.duration_ms = 0.0
        self.progress = 0.0
        self.progress_message = ""
        self.metadata: Dict[str, Any] = {}
        self.callback: Optional[Callable] = None
        self.error_callback: Optional[Callable] = None

    def can_start(self, completed_ids: set) -> bool:
        return all(dep in completed_ids for dep in self.dependencies)

    def execute(self) -> bool:
        if not self.handler:
            self.status = TaskStatus.SUCCESS
            return True
        self.status = TaskStatus.RUNNING
        self.started_at = time.time()
        try:
            self.result = self.handler(*self.args, **self.kwargs)
            self.status = TaskStatus.SUCCESS
            self.completed_at = time.time()
            self.duration_ms = (self.completed_at - self.started_at) * 1000
            if self.callback:
                try:
                    self.callback(self.result)
                except Exception:
                    pass
            return True
        except Exception as e:
            self.error = str(e)
            if self.retry_count < self.max_retries:
                self.retry_count += 1
                self.status = TaskStatus.RETRYING
                time.sleep(self.retry_delay)
                return self.execute()
            self.status = TaskStatus.FAILED
            self.completed_at = time.time()
            self.duration_ms = (self.completed_at - self.started_at) * 1000
            if self.error_callback:
                try:
                    self.error_callback(e)
                except Exception:
                    pass
            return False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "name": self.name,
            "priority": self.priority,
            "task_type": self.task_type,
            "status": self.status.value,
            "error": self.error,
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "duration_ms": round(self.duration_ms, 1),
            "progress": self.progress,
            "progress_message": self.progress_message,
            "dependencies": self.dependencies,
            "metadata": self.metadata,
        }


# ================================================================
# 任务队列管理器
# ================================================================
class TaskQueueManager:
    """后台任务队列与调度系统"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "task_queue")
        os.makedirs(self.data_dir, exist_ok=True)
        self._tasks: Dict[str, Task] = {}
        self._queue: "queue.PriorityQueue[Tuple[int, str]]" = queue.PriorityQueue()
        self._dead_letter: List[Task] = []
        self._lock = threading.RLock()
        self._running = False
        self._worker_thread: Optional[threading.Thread] = None
        self._max_workers = 4
        self._executor: Optional[concurrent.futures.ThreadPoolExecutor] = None
        self._completed_ids: set = set()
        self._task_callbacks: List[Callable] = []
        self._load()

    def _load(self):
        tasks_file = os.path.join(self.data_dir, "tasks.json")
        try:
            if os.path.exists(tasks_file):
                with open(tasks_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                # 只恢复未完成的任务元数据
                for t_data in data.get("tasks", []):
                    if t_data.get("status") in ("pending", "queued", "retrying"):
                        task = Task(name=t_data.get("name", ""))
                        task.task_id = t_data.get("task_id", task.task_id)
                        task.priority = t_data.get("priority", 2)
                        task.task_type = t_data.get("task_type", "general")
                        task.status = TaskStatus(t_data.get("status", "pending"))
                        task.retry_count = t_data.get("retry_count", 0)
                        task.dependencies = t_data.get("dependencies", [])
                        self._tasks[task.task_id] = task
        except Exception as e:
            terminal.warn(f"加载任务队列失败: {e}", "task_queue")

    def _save(self):
        tasks_file = os.path.join(self.data_dir, "tasks.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                "tasks": [t.to_dict() for t in self._tasks.values()
                         if t.status in (TaskStatus.PENDING, TaskStatus.QUEUED,
                                         TaskStatus.RUNNING, TaskStatus.RETRYING)],
                "dead_letter_count": len(self._dead_letter),
            }
            with open(tasks_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def submit(self, name: str, handler: Callable, args: tuple = (),
               kwargs: Optional[Dict] = None, priority: int = 2,
               max_retries: int = 3, timeout: float = 300.0,
               dependencies: Optional[List[str]] = None,
               task_type: str = "general",
               callback: Optional[Callable] = None,
               error_callback: Optional[Callable] = None) -> str:
        """提交任务"""
        task = Task(
            name=name, handler=handler, args=args, kwargs=kwargs,
            priority=priority, max_retries=max_retries, timeout=timeout,
            dependencies=dependencies, task_type=task_type,
        )
        task.callback = callback
        task.error_callback = error_callback

        with self._lock:
            self._tasks[task.task_id] = task
            self._queue.put((-priority, task.task_id))
            task.status = TaskStatus.QUEUED
            task.queued_at = time.time()
            self._save()

        terminal.info(f"任务已提交: {name} (优先级: {priority})", "task_queue")
        return task.task_id

    def submit_simple(self, func: Callable, *args, **kwargs) -> str:
        """简单提交任务"""
        name = kwargs.pop("name", func.__name__)
        priority = kwargs.pop("priority", 2)
        return self.submit(name, func, args, kwargs, priority=priority)

    def get_task(self, task_id: str) -> Optional[Task]:
        return self._tasks.get(task_id)

    def cancel_task(self, task_id: str) -> bool:
        task = self._tasks.get(task_id)
        if task and task.status in (TaskStatus.PENDING, TaskStatus.QUEUED):
            task.status = TaskStatus.CANCELLED
            self._save()
            return True
        return False

    def retry_task(self, task_id: str) -> bool:
        task = self._tasks.get(task_id)
        if task and task.status in (TaskStatus.FAILED, TaskStatus.DEAD_LETTER):
            task.status = TaskStatus.PENDING
            task.retry_count = 0
            task.error = ""
            self._queue.put((-task.priority, task.task_id))
            self._save()
            return True
        return False

    def get_task_progress(self, task_id: str) -> Optional[Dict[str, Any]]:
        task = self._tasks.get(task_id)
        if not task:
            return None
        return {
            "task_id": task.task_id,
            "name": task.name,
            "status": task.status.value,
            "progress": task.progress,
            "progress_message": task.progress_message,
            "retry_count": task.retry_count,
            "error": task.error,
            "duration_ms": task.duration_ms,
        }

    def list_tasks(self, status: str = "", task_type: str = "",
                    limit: int = 50) -> List[Task]:
        tasks = list(self._tasks.values())
        if status:
            tasks = [t for t in tasks if t.status.value == status]
        if task_type:
            tasks = [t for t in tasks if t.task_type == task_type]
        tasks.sort(key=lambda t: t.created_at, reverse=True)
        return tasks[:limit]

    def get_queue_size(self) -> int:
        return self._queue.qsize()

    def get_dead_letter(self, limit: int = 50) -> List[Task]:
        return list(reversed(self._dead_letter[-limit:]))

    def clear_dead_letter(self):
        self._dead_letter.clear()

    def start_workers(self, max_workers: int = 4):
        """启动工作线程"""
        if self._running:
            return
        self._running = True
        self._max_workers = max_workers
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)

        def _worker_loop():
            while self._running:
                try:
                    _, task_id = self._queue.get(timeout=1.0)
                    task = self._tasks.get(task_id)
                    if not task or task.status == TaskStatus.CANCELLED:
                        continue
                    # 检查依赖
                    if not task.can_start(self._completed_ids):
                        # 重新入队
                        self._queue.put((-task.priority, task_id))
                        time.sleep(0.1)
                        continue
                    # 执行
                    future = self._executor.submit(self._execute_task, task)
                    future.add_done_callback(lambda f, t=task: self._on_task_complete(t))
                except queue.Empty:
                    continue
                except Exception as e:
                    terminal.warn(f"任务队列工作线程错误: {e}", "task_queue")

        self._worker_thread = threading.Thread(target=_worker_loop, daemon=True)
        self._worker_thread.start()
        terminal.info(f"任务队列已启动 ({max_workers}个工作线程)", "task_queue")

    def _execute_task(self, task: Task):
        """执行任务"""
        # 让 handler 能通过 current_task() 拿到自己的任务对象（用于上报进度）。
        _current_task_local.task = task
        try:
            task.execute()
        finally:
            _current_task_local.task = None

    def _on_task_complete(self, task: Task):
        """任务完成回调"""
        with self._lock:
            if task.status == TaskStatus.SUCCESS:
                self._completed_ids.add(task.task_id)
            elif task.status == TaskStatus.FAILED:
                if task.retry_count >= task.max_retries:
                    self._dead_letter.append(task)
                    task.status = TaskStatus.DEAD_LETTER
            self._save()
        for callback in self._task_callbacks:
            try:
                callback(task)
            except Exception:
                pass

    def stop_workers(self, wait: bool = True):
        """停止工作线程"""
        self._running = False
        if self._executor:
            self._executor.shutdown(wait=wait)
        if self._worker_thread:
            self._worker_thread.join(timeout=10)
        terminal.info("任务队列已停止", "task_queue")

    def on_task_complete(self, callback: Callable):
        self._task_callbacks.append(callback)

    def wait_for_task(self, task_id: str, timeout: float = 300.0) -> Optional[Task]:
        """等待任务完成"""
        start = time.time()
        while time.time() - start < timeout:
            task = self._tasks.get(task_id)
            if task and task.status in (TaskStatus.SUCCESS, TaskStatus.FAILED,
                                         TaskStatus.CANCELLED, TaskStatus.DEAD_LETTER):
                return task
            time.sleep(0.1)
        return self._tasks.get(task_id)

    def get_stats(self) -> Dict[str, Any]:
        total = len(self._tasks)
        by_status = {}
        for task in self._tasks.values():
            by_status[task.status.value] = by_status.get(task.status.value, 0) + 1
        return {
            "total_tasks": total,
            "by_status": by_status,
            "queue_size": self._queue.qsize(),
            "dead_letter_count": len(self._dead_letter),
            "running": self._running,
            "max_workers": self._max_workers,
            "completed_ids": len(self._completed_ids),
            "avg_duration_ms": (sum(t.duration_ms for t in self._tasks.values()
                                    if t.status == TaskStatus.SUCCESS) /
                               max(1, sum(1 for t in self._tasks.values()
                                          if t.status == TaskStatus.SUCCESS))),
        }


# 全局任务队列管理器
_task_queue_manager = TaskQueueManager()


def get_task_queue_manager() -> TaskQueueManager:
    return _task_queue_manager


def submit_task(name: str, handler: Callable, **kwargs) -> str:
    return _task_queue_manager.submit(name, handler, **kwargs)


# 向后兼容：旧版类名别名
TaskQueue = TaskQueueManager
