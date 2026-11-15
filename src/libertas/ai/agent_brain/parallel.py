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



class ParallelTaskExecutor:
    """并行任务执行器 - 支持并行执行、进度追踪、结果聚合"""

    def __init__(self, max_workers: int = 4):
        self.max_workers = max_workers
        self.results = {}
        self.errors = {}
        self.progress = {}

    def execute_parallel(self, tasks: List[Dict], executor_fn: Callable = None) -> Dict:
        """并行执行任务列表

        Args:
            tasks: 任务列表，每个任务包含task_id和payload
            executor_fn: 执行函数，接收task参数，返回结果

        Returns:
            执行结果汇总
        """
        if not tasks:
            return {"success": True, "total": 0, "results": {}}

        import concurrent.futures
        start_time = time.time()
        self.results = {}
        self.errors = {}
        self.progress = {t["task_id"]: "pending" for t in tasks}

        def run_task(task):
            task_id = task["task_id"]
            self.progress[task_id] = "running"
            try:
                if executor_fn:
                    result = executor_fn(task)
                else:
                    result = self._default_executor(task)
                self.results[task_id] = result
                self.progress[task_id] = "completed"
                return task_id, result, None
            except Exception as e:
                self.errors[task_id] = str(e)
                self.progress[task_id] = "failed"
                return task_id, None, str(e)

        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = [executor.submit(run_task, task) for task in tasks]
            for future in concurrent.futures.as_completed(futures):
                try:
                    future.result()
                except Exception:
                    pass

        total_time = (time.time() - start_time) * 1000
        return {
            "success": len(self.errors) == 0,
            "total": len(tasks),
            "success_count": len(self.results),
            "failed_count": len(self.errors),
            "results": self.results,
            "errors": self.errors,
            "total_duration_ms": total_time,
            "avg_duration_ms": total_time / len(tasks) if tasks else 0,
        }

    def _default_executor(self, task: Dict) -> Any:
        """默认执行器（根据task_type分发）"""
        task_type = task.get("task_type", "general")
        payload = task.get("payload", {})
        if task_type == "tool":
            # 工具执行需要外部注入tool_library
            return {"note": "需要注入tool_library执行器"}
        elif task_type == "code":
            return {"note": "需要注入codebase执行器"}
        else:
            return {"task_id": task["task_id"], "payload": payload}

    def get_progress(self) -> Dict:
        """获取执行进度"""
        total = len(self.progress)
        completed = sum(1 for v in self.progress.values() if v == "completed")
        failed = sum(1 for v in self.progress.values() if v == "failed")
        running = sum(1 for v in self.progress.values() if v == "running")
        return {
            "total": total,
            "completed": completed,
            "failed": failed,
            "running": running,
            "pending": total - completed - failed - running,
            "progress_percent": (completed + failed) / total * 100 if total > 0 else 0,
            "details": self.progress,
        }

    def execute_with_dependencies(self, tasks: List[Dict], executor_fn: Callable = None) -> Dict:
        """按依赖关系执行任务（有依赖的任务等待依赖完成）"""
        task_map = {t["task_id"]: t for t in tasks}
        completed = set()
        results = {}
        errors = {}
        start_time = time.time()

        while len(completed) < len(tasks):
            # 找到所有依赖已完成的待执行任务
            ready = []
            for task in tasks:
                tid = task["task_id"]
                if tid in completed or tid in errors:
                    continue
                deps = task.get("dependencies", [])
                if all(d in completed for d in deps):
                    ready.append(task)
            if not ready:
                # 死锁检测
                remaining = [t["task_id"] for t in tasks if t["task_id"] not in completed and t["task_id"] not in errors]
                errors["_deadlock"] = f"任务依赖死锁，剩余任务: {remaining}"
                break
            # 并行执行ready任务
            batch_result = self.execute_parallel(ready, executor_fn)
            results.update(batch_result.get("results", {}))
            errors.update(batch_result.get("errors", {}))
            completed.update(batch_result.get("results", {}).keys())

        total_time = (time.time() - start_time) * 1000
        return {
            "success": len(errors) == 0,
            "total": len(tasks),
            "success_count": len(results),
            "failed_count": len(errors),
            "results": results,
            "errors": errors,
            "total_duration_ms": total_time,
        }
