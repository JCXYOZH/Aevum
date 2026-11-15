"""
core/scheduler.py - 定时任务调度器

支持一次性(at)、周期性(cron)、间隔(every)、条件触发四种调度，
持久化、并发控制、错误重试、死信队列。
"""
import os
import json
import time
import uuid
import threading
import queue
from typing import Any, Callable, Dict, List, Optional
from datetime import datetime, timedelta
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


# ================================================================
# Cron 表达式解析器
# ================================================================
class CronExpression:
    """Cron 表达式解析器（分 时 日 月 周）"""

    def __init__(self, expression: str):
        self.expression = expression.strip()
        self.parts = self.expression.split()
        if len(self.parts) != 5:
            raise ValueError(f"无效的 cron 表达式（需要5个字段）: {expression}")
        self.minute = self._parse_field(self.parts[0], 0, 59)
        self.hour = self._parse_field(self.parts[1], 0, 23)
        self.day_of_month = self._parse_field(self.parts[2], 1, 31)
        self.month = self._parse_field(self.parts[3], 1, 12)
        self.day_of_week = self._parse_field(self.parts[4], 0, 6)

    def _parse_field(self, field: str, min_val: int, max_val: int) -> set:
        values = set()
        for part in field.split(","):
            if "/" in part:
                base, step = part.split("/", 1)
                step = int(step)
                if base == "*":
                    start, end = min_val, max_val
                elif "-" in base:
                    start, end = map(int, base.split("-", 1))
                else:
                    start, end = int(base), max_val
                values.update(range(start, end + 1, step))
            elif "-" in part:
                start, end = map(int, part.split("-", 1))
                values.update(range(start, end + 1))
            elif part == "*":
                values.update(range(min_val, max_val + 1))
            elif part == "?":
                values.update(range(min_val, max_val + 1))
            elif part == "L":
                values.add(max_val)
            else:
                values.add(int(part))
        return values

    def matches(self, dt: datetime) -> bool:
        return (
            dt.minute in self.minute and
            dt.hour in self.hour and
            dt.day in self.day_of_month and
            dt.month in self.month and
            dt.weekday() in self.day_of_week
        )

    def next_run(self, after: Optional[datetime] = None) -> datetime:
        """计算下一次运行时间"""
        dt = (after or datetime.now()).replace(second=0, microsecond=0) + timedelta(minutes=1)
        for _ in range(366 * 24 * 60):  # 最多搜索一年
            if self.matches(dt):
                return dt
            dt += timedelta(minutes=1)
        raise ValueError(f"无法计算下一次运行时间: {self.expression}")


# ================================================================
# 定时任务
# ================================================================
class ScheduledTask:
    """定时任务"""

    def __init__(self, task_id: str = "", name: str = "",
                 schedule_type: str = "interval",  # once / cron / interval / condition
                 cron_expression: str = "",
                 interval_seconds: float = 0.0,
                 run_at: float = 0.0,
                 condition: Optional[Callable[[], bool]] = None,
                 callback: Optional[Callable] = None,
                 args: tuple = (), kwargs: Optional[Dict] = None,
                 enabled: bool = True,
                 max_retries: int = 3,
                 retry_delay: float = 5.0,
                 catch_up: bool = False,
                 tags: Optional[List[str]] = None):
        self.task_id = task_id or f"task_{uuid.uuid4().hex[:8]}"
        self.name = name or self.task_id
        self.schedule_type = schedule_type
        self.cron_expression = cron_expression
        self.interval_seconds = interval_seconds
        self.run_at = run_at
        self.condition = condition
        self.callback = callback
        self.args = args
        self.kwargs = kwargs or {}
        self.enabled = enabled
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.catch_up = catch_up
        self.tags = tags or []
        self.created_at = time.time()
        self.next_run = 0.0
        self.last_run = 0.0
        self.last_duration = 0.0
        self.last_status = ""
        self.last_error = ""
        self.run_count = 0
        self.success_count = 0
        self.failure_count = 0
        self.retry_count = 0
        self._cron: Optional[CronExpression] = None
        if cron_expression:
            try:
                self._cron = CronExpression(cron_expression)
            except ValueError:
                pass
        self._calculate_next_run()

    def _calculate_next_run(self):
        now = time.time()
        if self.schedule_type == "once":
            self.next_run = self.run_at
        elif self.schedule_type == "interval":
            if self.last_run == 0:
                self.next_run = now + self.interval_seconds
            else:
                self.next_run = self.last_run + self.interval_seconds
        elif self.schedule_type == "cron" and self._cron:
            try:
                self.next_run = self._cron.next_run().timestamp()
            except ValueError:
                self.next_run = 0
        elif self.schedule_type == "condition":
            self.next_run = now + 1.0  # 条件任务每秒检查

    def should_run(self) -> bool:
        if not self.enabled:
            return False
        now = time.time()
        if self.schedule_type == "condition":
            try:
                return self.condition() if self.condition else False
            except Exception:
                return False
        return now >= self.next_run and self.next_run > 0

    def execute(self) -> bool:
        """执行任务"""
        if not self.callback:
            return False
        start = time.time()
        self.last_run = start
        self.run_count += 1
        try:
            self.callback(*self.args, **self.kwargs)
            self.last_status = "success"
            self.last_error = ""
            self.success_count += 1
            self.retry_count = 0
            return True
        except Exception as e:
            self.last_status = "failed"
            self.last_error = str(e)
            self.failure_count += 1
            if self.retry_count < self.max_retries:
                self.retry_count += 1
                self.next_run = time.time() + self.retry_delay
                terminal.warn(f"任务 [{self.name}] 失败，将在 {self.retry_delay}s 后重试 ({self.retry_count}/{self.max_retries}): {e}", "scheduler")
            else:
                terminal.error(f"任务 [{self.name}] 失败，已达最大重试次数: {e}", "scheduler")
            return False
        finally:
            self.last_duration = (time.time() - start) * 1000
            if self.last_status == "success" or self.retry_count >= self.max_retries:
                self._calculate_next_run()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id, "name": self.name,
            "schedule_type": self.schedule_type,
            "cron_expression": self.cron_expression,
            "interval_seconds": self.interval_seconds,
            "run_at": self.run_at, "enabled": self.enabled,
            "max_retries": self.max_retries, "retry_delay": self.retry_delay,
            "next_run": self.next_run, "last_run": self.last_run,
            "last_duration": self.last_duration, "last_status": self.last_status,
            "last_error": self.last_error, "run_count": self.run_count,
            "success_count": self.success_count, "failure_count": self.failure_count,
            "tags": self.tags, "created_at": self.created_at,
            "next_run_time": datetime.fromtimestamp(self.next_run).strftime("%Y-%m-%d %H:%M:%S") if self.next_run > 0 else "",
        }


# ================================================================
# 调度器
# ================================================================
class TaskScheduler:
    """定时任务调度器"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "scheduler")
        os.makedirs(self.data_dir, exist_ok=True)
        self._tasks: Dict[str, ScheduledTask] = {}
        self._lock = threading.RLock()
        self._running = False
        self._scheduler_thread: Optional[threading.Thread] = None
        self._execution_queue: "queue.Queue[Optional[ScheduledTask]]" = queue.Queue(maxsize=1000)
        self._worker_threads: List[threading.Thread] = []
        self._max_workers = 4
        self._dead_letter: List[Dict[str, Any]] = []
        self._load()

    def add_task(self, task: ScheduledTask) -> str:
        with self._lock:
            self._tasks[task.task_id] = task
            self._save()
        terminal.info(f"添加定时任务: {task.name} ({task.schedule_type})", "scheduler")
        return task.task_id

    def add_interval_task(self, name: str, callback: Callable, interval_seconds: float,
                          args: tuple = (), kwargs: Optional[Dict] = None, **opts) -> str:
        task = ScheduledTask(name=name, schedule_type="interval",
                             interval_seconds=interval_seconds, callback=callback,
                             args=args, kwargs=kwargs, **opts)
        return self.add_task(task)

    def add_cron_task(self, name: str, callback: Callable, cron_expression: str,
                      args: tuple = (), kwargs: Optional[Dict] = None, **opts) -> str:
        task = ScheduledTask(name=name, schedule_type="cron",
                             cron_expression=cron_expression, callback=callback,
                             args=args, kwargs=kwargs, **opts)
        return self.add_task(task)

    def add_once_task(self, name: str, callback: Callable, run_at: float,
                     args: tuple = (), kwargs: Optional[Dict] = None, **opts) -> str:
        task = ScheduledTask(name=name, schedule_type="once",
                             run_at=run_at, callback=callback,
                             args=args, kwargs=kwargs, **opts)
        return self.add_task(task)

    def remove_task(self, task_id: str) -> bool:
        with self._lock:
            if task_id in self._tasks:
                del self._tasks[task_id]
                self._save()
                return True
            return False

    def get_task(self, task_id: str) -> Optional[ScheduledTask]:
        return self._tasks.get(task_id)

    def list_tasks(self, enabled_only: bool = False, tag: str = "") -> List[ScheduledTask]:
        with self._lock:
            tasks = list(self._tasks.values())
        if enabled_only:
            tasks = [t for t in tasks if t.enabled]
        if tag:
            tasks = [t for t in tasks if tag in t.tags]
        return sorted(tasks, key=lambda t: t.next_run if t.next_run > 0 else float("inf"))

    def enable_task(self, task_id: str) -> bool:
        task = self._tasks.get(task_id)
        if task:
            task.enabled = True
            task._calculate_next_run()
            return True
        return False

    def disable_task(self, task_id: str) -> bool:
        task = self._tasks.get(task_id)
        if task:
            task.enabled = False
            return True
        return False

    def trigger_task(self, task_id: str) -> bool:
        """手动触发任务"""
        task = self._tasks.get(task_id)
        if task and task.callback:
            try:
                self._execution_queue.put(task, block=False)
                return True
            except queue.Full:
                return False
        return False

    def start(self, max_workers: int = 4):
        """启动调度器"""
        if self._running:
            return
        self._running = True
        self._max_workers = max_workers
        self._scheduler_thread = threading.Thread(
            target=self._scheduler_loop, daemon=True, name="TaskScheduler"
        )
        self._scheduler_thread.start()
        for i in range(max_workers):
            t = threading.Thread(target=self._worker_loop, daemon=True, name=f"SchedulerWorker-{i}")
            t.start()
            self._worker_threads.append(t)
        terminal.info(f"定时任务调度器已启动（{max_workers} 个工作线程）", "scheduler")

    def stop(self, wait: bool = True):
        self._running = False
        if wait:
            if self._scheduler_thread:
                self._scheduler_thread.join(timeout=5)
            for _ in self._worker_threads:
                self._execution_queue.put(None)
            for t in self._worker_threads:
                t.join(timeout=5)
        self._save()
        terminal.info("定时任务调度器已停止", "scheduler")

    def _scheduler_loop(self):
        while self._running:
            try:
                now = time.time()
                with self._lock:
                    tasks = list(self._tasks.values())
                for task in tasks:
                    if task.should_run():
                        try:
                            self._execution_queue.put(task, block=False)
                        except queue.Full:
                            pass
                time.sleep(1)
            except Exception as e:
                terminal.error(f"调度器循环异常: {e}", "scheduler")
                time.sleep(5)

    def _worker_loop(self):
        while self._running:
            try:
                task = self._execution_queue.get(timeout=1.0)
                if task is None:
                    break
                task.execute()
                if task.schedule_type == "once" and task.last_status == "success":
                    with self._lock:
                        self._tasks.pop(task.task_id, None)
                self._execution_queue.task_done()
            except queue.Empty:
                continue
            except Exception as e:
                terminal.error(f"调度器工作线程异常: {e}", "scheduler")

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            total = len(self._tasks)
            enabled = sum(1 for t in self._tasks.values() if t.enabled)
            by_type = {}
            total_runs = 0
            total_success = 0
            total_failure = 0
            for task in self._tasks.values():
                by_type[task.schedule_type] = by_type.get(task.schedule_type, 0) + 1
                total_runs += task.run_count
                total_success += task.success_count
                total_failure += task.failure_count
            return {
                "total": total, "enabled": enabled, "disabled": total - enabled,
                "by_type": by_type, "total_runs": total_runs,
                "total_success": total_success, "total_failure": total_failure,
                "running": self._running, "workers": len(self._worker_threads),
                "dead_letter": len(self._dead_letter),
            }

    def get_upcoming(self, limit: int = 10) -> List[Dict[str, Any]]:
        tasks = [t for t in self._tasks.values() if t.enabled and t.next_run > 0]
        tasks.sort(key=lambda t: t.next_run)
        return [t.to_dict() for t in tasks[:limit]]

    def _save(self):
        try:
            data_file = os.path.join(self.data_dir, "tasks.json")
            data = {
                "version": "1.0",
                "updated_at": time.time(),
                "tasks": [t.to_dict() for t in self._tasks.values()],
            }
            with open(data_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def _load(self):
        try:
            data_file = os.path.join(self.data_dir, "tasks.json")
            if os.path.exists(data_file):
                with open(data_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                # 注意：加载的任务没有 callback，需要重新注册
                for item in data.get("tasks", []):
                    task = ScheduledTask(
                        task_id=item["task_id"], name=item.get("name", ""),
                        schedule_type=item.get("schedule_type", "interval"),
                        cron_expression=item.get("cron_expression", ""),
                        interval_seconds=item.get("interval_seconds", 0),
                        run_at=item.get("run_at", 0),
                        enabled=item.get("enabled", True),
                    )
                    task.run_count = item.get("run_count", 0)
                    task.success_count = item.get("success_count", 0)
                    task.failure_count = item.get("failure_count", 0)
                    self._tasks[task.task_id] = task
        except Exception:
            pass


# 全局调度器
_scheduler = TaskScheduler()


def get_scheduler() -> TaskScheduler:
    return _scheduler


def schedule_task(name: str, callback: Callable, **kwargs) -> str:
    return _scheduler.add_interval_task(name, callback, kwargs.pop("interval_seconds", 60), **kwargs)
