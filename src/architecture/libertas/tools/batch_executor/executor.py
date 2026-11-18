"""职责模块：executor。"""

from __future__ import annotations

from typing import Dict, List, Any, Optional, Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
import json, os, secrets, sqlite3, threading, time

from .models import BatchTaskStatus, ToolResult, ToolTask
from .parser import extract_tasks_from_reply
from libertas.foundation.config import get_data_dir

class BatchExecutor:
    """批量工具执行器：作业管理 + 线程池并行执行 + SQLite持久化"""

    def __init__(self, db_path: str = "", scanner=None, max_workers: int = 5,
                 per_task_timeout: float = 30.0, session_id: str = "",
                 progress_cb: Optional[Callable] = None):
        if not db_path:
            db_path = self._default_db_path()
        self.db_path = db_path
        self.scanner = scanner
        self.max_workers = max(1, min(max_workers, 10))
        self.per_task_timeout = per_task_timeout
        self.session_id = session_id
        self.progress_cb = progress_cb
        self._lock = threading.Lock()
        self._cancel_flags = {}  # job_id -> bool
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._init_db()

    @staticmethod
    def _default_db_path() -> str:
        """默认数据库路径跟随 LIBERTAS_DATA_DIR，避免数据根搬家后分裂。"""
        return os.path.join(get_data_dir(), "batch.db")

    def _get_conn(self) -> sqlite3.Connection:
        """获取数据库连接"""
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_db(self):
        """初始化数据库表结构"""
        with self._lock, self._get_conn() as conn:
            # 作业表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    name TEXT DEFAULT '',
                    description TEXT DEFAULT '',
                    status TEXT DEFAULT 'pending',
                    total_tasks INTEGER DEFAULT 0,
                    completed_tasks INTEGER DEFAULT 0,
                    failed_tasks INTEGER DEFAULT 0,
                    created_at REAL NOT NULL,
                    started_at REAL,
                    completed_at REAL,
                    results TEXT DEFAULT '[]'
                )
            """)
            # 任务表
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    tool_name TEXT NOT NULL,
                    target TEXT DEFAULT '',
                    kwargs TEXT DEFAULT '{}',
                    status TEXT DEFAULT 'pending',
                    result TEXT DEFAULT '',
                    error TEXT DEFAULT '',
                    duration REAL DEFAULT 0,
                    task_index INTEGER DEFAULT 0,
                    created_at REAL NOT NULL,
                    completed_at REAL,
                    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_job ON tasks(job_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)")

    # ============================================================
    # 作业管理
    # ============================================================

    def create_job(self, name: str = "", description: str = "") -> str:
        """创建作业，返回 job_id"""
        job_id = secrets.token_hex(8)
        now = time.time()
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "INSERT INTO jobs (id, name, description, status, created_at) VALUES (?,?,?,?,?)",
                (job_id, name, description, BatchTaskStatus.PENDING.value, now)
            )
        self._cancel_flags[job_id] = False
        return job_id

    def add_task(self, job_id: str, task: ToolTask) -> bool:
        """向作业添加任务"""
        task_id = secrets.token_hex(8)
        now = time.time()
        with self._lock, self._get_conn() as conn:
            job = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not job:
                return False
            conn.execute(
                "INSERT INTO tasks (id, job_id, tool_name, target, kwargs, status, task_index, created_at) VALUES (?,?,?,?,?,?,?,?)",
                (task_id, job_id, task.tool_name, task.target,
                 json.dumps(task.kwargs, ensure_ascii=False),
                 BatchTaskStatus.PENDING.value, task.index, now)
            )
            conn.execute("UPDATE jobs SET total_tasks = total_tasks + 1 WHERE id=?", (job_id,))
        return True

    def add_tasks_from_reply(self, job_id: str, reply: str) -> int:
        """从模型回复中提取任务并添加到作业，返回添加的任务数"""
        tasks = extract_tasks_from_reply(reply)
        count = 0
        for task in tasks:
            if self.add_task(job_id, task):
                count += 1
        return count

    def cancel_job(self, job_id: str) -> bool:
        """取消作业"""
        self._cancel_flags[job_id] = True
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "UPDATE jobs SET status=? WHERE id=? AND status IN (?,?)",
                (BatchTaskStatus.CANCELLED.value, job_id,
                 BatchTaskStatus.PENDING.value, BatchTaskStatus.RUNNING.value)
            )
            conn.execute(
                "UPDATE tasks SET status=? WHERE job_id=? AND status IN (?,?)",
                (BatchTaskStatus.CANCELLED.value, job_id,
                 BatchTaskStatus.PENDING.value, BatchTaskStatus.RUNNING.value)
            )
        return True

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """获取作业信息"""
        with self._lock, self._get_conn() as conn:
            job = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not job:
                return None
            tasks = conn.execute(
                "SELECT * FROM tasks WHERE job_id=? ORDER BY task_index", (job_id,)
            ).fetchall()
            job_dict = dict(job)
            job_dict["tasks"] = [dict(t) for t in tasks]
            job_dict["results"] = json.loads(job_dict.get("results", "[]") or "[]")
            return job_dict

    def get_job_progress(self, job_id: str) -> Dict[str, Any]:
        """获取作业进度"""
        with self._lock, self._get_conn() as conn:
            job = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not job:
                return {"success": False, "error": "作业不存在"}
            tasks = conn.execute(
                "SELECT status, COUNT(*) as cnt FROM tasks WHERE job_id=? GROUP BY status",
                (job_id,)
            ).fetchall()
            status_counts = {t["status"]: t["cnt"] for t in tasks}
            total = job["total_tasks"]
            completed = status_counts.get(BatchTaskStatus.COMPLETED.value, 0)
            failed = status_counts.get(BatchTaskStatus.FAILED.value, 0)
            cancelled = status_counts.get(BatchTaskStatus.CANCELLED.value, 0)
            timeout = status_counts.get(BatchTaskStatus.TIMEOUT.value, 0)
            running = status_counts.get(BatchTaskStatus.RUNNING.value, 0)
            pending = status_counts.get(BatchTaskStatus.PENDING.value, 0)
            progress = (completed + failed + cancelled + timeout) / total * 100 if total > 0 else 0
            return {
                "success": True,
                "job_id": job_id,
                "name": job["name"],
                "status": job["status"],
                "total": total,
                "completed": completed,
                "failed": failed,
                "cancelled": cancelled,
                "timeout": timeout,
                "running": running,
                "pending": pending,
                "progress_percent": round(progress, 1),
                "created_at": job["created_at"],
                "started_at": job["started_at"],
                "completed_at": job["completed_at"],
            }

    def list_jobs(self, status: str = "", limit: int = 50) -> List[Dict[str, Any]]:
        """列出作业"""
        with self._lock, self._get_conn() as conn:
            if status:
                rows = conn.execute(
                    "SELECT * FROM jobs WHERE status=? ORDER BY created_at DESC LIMIT ?",
                    (status, limit)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)
                ).fetchall()
            return [dict(r) for r in rows]

    def delete_job(self, job_id: str) -> bool:
        """删除作业（级联删除任务）"""
        with self._lock, self._get_conn() as conn:
            conn.execute("DELETE FROM jobs WHERE id=?", (job_id,))
        self._cancel_flags.pop(job_id, None)
        return True

    # ============================================================
    # 执行
    # ============================================================

    def execute_job(self, job_id: str) -> Dict[str, Any]:
        """执行作业中的所有任务（并行+超时+进度）"""
        job = self.get_job(job_id)
        if not job:
            return {"success": False, "error": "作业不存在"}

        tasks_data = job.get("tasks", [])
        if not tasks_data:
            return {"success": False, "error": "作业没有任务"}

        # 转换为 ToolTask 列表
        tool_tasks = []
        for t in tasks_data:
            task = ToolTask(
                tool_name=t["tool_name"],
                target=t.get("target", ""),
                kwargs=json.loads(t.get("kwargs", "{}") or "{}"),
                index=t.get("task_index", 0),
            )
            tool_tasks.append(task)

        # 更新作业状态为运行中
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "UPDATE jobs SET status=?, started_at=? WHERE id=?",
                (BatchTaskStatus.RUNNING.value, time.time(), job_id)
            )

        # 执行所有任务
        results = self.execute_all(tool_tasks, job_id=job_id)

        # 保存结果到作业
        results_json = json.dumps([
            {
                "task": {"tool_name": r.task.tool_name, "target": r.task.target, "kwargs": r.task.kwargs},
                "success": r.success,
                "error": r.error,
                "duration": r.duration,
                "timed_out": r.timed_out,
            }
            for r in results
        ], ensure_ascii=False)

        # 统计
        success_count = sum(1 for r in results if r.success and not r.timed_out)
        fail_count = len(results) - success_count

        with self._lock, self._get_conn() as conn:
            conn.execute(
                "UPDATE jobs SET status=?, completed_tasks=?, failed_tasks=?, completed_at=?, results=? WHERE id=?",
                (BatchTaskStatus.COMPLETED.value, success_count, fail_count, time.time(), results_json, job_id)
            )

        return {
            "success": True,
            "job_id": job_id,
            "total": len(results),
            "success_count": success_count,
            "fail_count": fail_count,
            "results": results,
            "formatted": self.format_results(results),
        }

    def execute_all(self, tasks: List[ToolTask], job_id: str = "") -> List[ToolResult]:
        """并行执行所有任务，返回结果列表（按原始顺序）。
        单任务超时后标记为timed_out并跳过，不等待卡死线程。
        """
        if not tasks:
            return []

        # 获取工具执行器
        gov_executor = None
        try:
            from libertas.tools.tool_governance import get_executor, detect_tool_type
            gov_executor = get_executor(self.scanner)
        except Exception:
            pass

        results = [None] * len(tasks)
        completed = 0
        total = len(tasks)
        lock = threading.Lock()
        # 全局截止时间
        global_deadline = time.time() + max(self.per_task_timeout * 2, 10) * min(total, 5) + 10

        def _run_one(task: ToolTask) -> ToolResult:
            if job_id and self._cancel_flags.get(job_id, False):
                return ToolResult(task=task, success=False, error="已取消", timed_out=False)

            if self.progress_cb:
                try:
                    self.progress_cb("task_start", index=task.index, total=total,
                                     tool=task.tool_name, target=task.target[:50])
                except Exception:
                    pass

            # 更新任务状态为运行中
            if job_id:
                try:
                    with self._lock, self._get_conn() as conn:
                        conn.execute(
                            "UPDATE tasks SET status=? WHERE job_id=? AND tool_name=? AND target=? AND task_index=?",
                            (BatchTaskStatus.RUNNING.value, job_id, task.tool_name, task.target, task.index)
                        )
                except Exception:
                    pass

            start = time.time()
            try:
                if gov_executor:
                    tool_type = detect_tool_type(task.tool_name, self.scanner)
                    result = gov_executor.execute(
                        task.tool_name, tool_type,
                        {"target": task.target, **task.kwargs},
                        session_id=self.session_id,
                        auto_approve=False,
                        caller_type="ai",
                    )
                else:
                    # 没有工具执行器，尝试直接调用 native_tools
                    try:
                        from ..tools import native_tools as _nt
                        if task.tool_name in _nt.NATIVE_TOOLS:
                            # 走统一绑定入口：func(target=...) 这种按关键字传 target
                            # 的写法对 dns_lookup 这类签名（首个形参是 domain、另有
                            # **_extra）会把 target 吞进 **_extra，domain 依旧缺失，
                            # 直接抛 "missing 1 required positional argument: 'domain'"。
                            result = _nt.run_native_tool(
                                task.tool_name, target=task.target, **task.kwargs)
                        else:
                            result = {"success": False, "error": f"工具 {task.tool_name} 不存在"}
                    except Exception as e:
                        result = {"success": False, "error": str(e)}

                duration = time.time() - start
                if duration > self.per_task_timeout:
                    self._update_task_result(job_id, task, BatchTaskStatus.TIMEOUT.value, "", "超时", duration)
                    return ToolResult(task=task, success=result.get("success", False),
                                      data=result.get("data", {}),
                                      error=result.get("error", ""),
                                      duration=duration, timed_out=True)
                if result.get("success"):
                    self._update_task_result(job_id, task, BatchTaskStatus.COMPLETED.value,
                                             json.dumps(result.get("data", {}), ensure_ascii=False), "", duration)
                    return ToolResult(task=task, success=True,
                                      data=result.get("data", {}),
                                      duration=duration)
                else:
                    self._update_task_result(job_id, task, BatchTaskStatus.FAILED.value,
                                             "", result.get("error", "执行失败"), duration)
                    return ToolResult(task=task, success=False,
                                      error=result.get("error", "执行失败"),
                                      duration=duration)
            except Exception as e:
                duration = time.time() - start
                self._update_task_result(job_id, task, BatchTaskStatus.FAILED.value, "", str(e)[:200], duration)
                return ToolResult(task=task, success=False, error=str(e)[:200],
                                  duration=duration)

        pool = ThreadPoolExecutor(max_workers=self.max_workers)
        future_map = {}
        for task in tasks:
            future = pool.submit(_run_one, task)
            future_map[future] = task

        try:
            for future in as_completed(future_map, timeout=max(global_deadline - time.time(), 1)):
                task = future_map[future]
                try:
                    result = future.result(timeout=1)
                except Exception as e:
                    result = ToolResult(task=task, success=False,
                                        error=f"执行异常: {e}", timed_out=False)

                results[task.index] = result
                with lock:
                    completed += 1
                    if self.progress_cb:
                        try:
                            self.progress_cb("task_done", index=task.index, total=total,
                                             completed=completed, tool=task.tool_name,
                                             target=task.target[:50],
                                             success=result.success and not result.timed_out,
                                             duration=result.duration)
                        except Exception:
                            pass
        except TimeoutError:
            # 全局超时，未完成的任务标记为超时
            for future, task in future_map.items():
                if results[task.index] is None:
                    results[task.index] = ToolResult(
                        task=task, success=False,
                        error=f"超过{self.per_task_timeout}s未完成", timed_out=True)
                    if self.progress_cb:
                        try:
                            self.progress_cb("task_done", index=task.index, total=total,
                                             completed=completed, tool=task.tool_name,
                                             target=task.target[:50], success=False,
                                             duration=self.per_task_timeout)
                        except Exception:
                            pass
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

        return results

    def _update_task_result(self, job_id: str, task: ToolTask, status: str,
                            result: str, error: str, duration: float):
        """更新任务结果到数据库"""
        if not job_id:
            return
        try:
            with self._lock, self._get_conn() as conn:
                conn.execute(
                    "UPDATE tasks SET status=?, result=?, error=?, duration=?, completed_at=? WHERE job_id=? AND tool_name=? AND target=? AND task_index=?",
                    (status, result, error, duration, time.time(), job_id,
                     task.tool_name, task.target, task.index)
                )
        except Exception:
            pass

    # ============================================================
    # 结果格式化
    # ============================================================

    @staticmethod
    def format_results(results: List[ToolResult], max_chars_per_result: int = 500) -> str:
        """将所有结果格式化为注入模型的文本"""
        if not results:
            return ""
        total = len(results)
        success_count = sum(1 for r in results if r.success and not r.timed_out)
        fail_count = total - success_count

        lines = [f"【批量工具执行结果: {success_count}成功/{fail_count}失败/共{total}个】"]
        for r in results:
            lines.append(r.summary(max_chars=max_chars_per_result))
            lines.append("")

        if fail_count > 0:
            failed = [r.task.label() for r in results if not r.success or r.timed_out]
            lines.append(f"失败/跳过的任务: {', '.join(failed)}")

        return "\n".join(lines)

    # ============================================================
    # 统计
    # ============================================================

    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        with self._lock, self._get_conn() as conn:
            total_jobs = conn.execute("SELECT COUNT(*) as c FROM jobs").fetchone()["c"]
            completed_jobs = conn.execute("SELECT COUNT(*) as c FROM jobs WHERE status='completed'").fetchone()["c"]
            failed_jobs = conn.execute("SELECT COUNT(*) as c FROM jobs WHERE status='failed'").fetchone()["c"]
            running_jobs = conn.execute("SELECT COUNT(*) as c FROM jobs WHERE status='running'").fetchone()["c"]
            total_tasks = conn.execute("SELECT COUNT(*) as c FROM tasks").fetchone()["c"]
            completed_tasks = conn.execute("SELECT COUNT(*) as c FROM tasks WHERE status='completed'").fetchone()["c"]
            failed_tasks = conn.execute("SELECT COUNT(*) as c FROM tasks WHERE status='failed'").fetchone()["c"]
            timeout_tasks = conn.execute("SELECT COUNT(*) as c FROM tasks WHERE status='timeout'").fetchone()["c"]
        return {
            "total_jobs": total_jobs,
            "completed_jobs": completed_jobs,
            "failed_jobs": failed_jobs,
            "running_jobs": running_jobs,
            "total_tasks": total_tasks,
            "completed_tasks": completed_tasks,
            "failed_tasks": failed_tasks,
            "timeout_tasks": timeout_tasks,
            "success_rate": round(completed_tasks / total_tasks * 100, 1) if total_tasks > 0 else 0,
            "db_path": self.db_path,
        }
