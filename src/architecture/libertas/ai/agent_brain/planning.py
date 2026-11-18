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



class TaskPlanner:
    """任务规划器 - 将需求分解为可执行的子任务序列，动态调整"""

    def __init__(self):
        self.planner_id = f"plan_{uuid.uuid4().hex[:8]}"
        self.tasks: Dict[str, Task] = {}
        self.task_queue: deque = deque()
        self.completed_tasks: deque = deque(maxlen=200)
        self.failed_tasks: deque = deque(maxlen=100)
        self._lock = threading.RLock()

    def plan(self, requirement: str, context: Optional[Dict] = None) -> List[Task]:
        """将需求分解为任务序列"""
        context = context or {}
        tasks = []

        # 分析需求类型，选择分解策略
        requirement_lower = requirement.lower()

        # 策略1：代码开发任务
        if any(kw in requirement_lower for kw in ["开发", "编写", "实现", "写代码", "create", "develop", "implement"]):
            tasks = self._plan_development(requirement, context)
        # 策略2：代码修改任务
        elif any(kw in requirement_lower for kw in ["修改", "优化", "重构", "修复", "fix", "modify", "refactor"]):
            tasks = self._plan_modification(requirement, context)
        # 策略3：网络安全任务
        elif any(kw in requirement_lower for kw in ["扫描", "渗透", "漏洞", "安全", "scan", "vuln", "security"]):
            tasks = self._plan_security(requirement, context)
        # 策略4：信息查询任务
        elif any(kw in requirement_lower for kw in ["查询", "搜索", "查找", "分析", "search", "query", "analyze"]):
            tasks = self._plan_research(requirement, context)
        # 策略5：通用任务
        else:
            tasks = self._plan_general(requirement, context)

        # 注册任务
        for task in tasks:
            with self._lock:
                self.tasks[task.task_id] = task
                self.task_queue.append(task.task_id)

        return tasks

    def _plan_development(self, requirement: str, context: Dict) -> List[Task]:
        """开发任务分解"""
        tasks = []
        # 1. 理解需求
        t1 = Task("理解需求，明确功能边界和技术约束", "analysis", "high")
        t1.required_memory = ["similar_projects", "tech_stack_preferences"]
        tasks.append(t1)
        # 2. 设计方案
        t2 = Task("设计技术方案和接口定义", "design", "high")
        t2.depends_on = [t1.task_id]
        tasks.append(t2)
        # 3. 编写代码
        t3 = Task("编写核心代码实现", "coding", "critical")
        t3.depends_on = [t2.task_id]
        t3.required_code = ["project_structure"]
        tasks.append(t3)
        # 4. 语法检查
        t4 = Task("语法检查和导入验证", "verification", "medium")
        t4.depends_on = [t3.task_id]
        tasks.append(t4)
        # 5. 功能测试
        t5 = Task("功能测试和边界验证", "testing", "medium")
        t5.depends_on = [t4.task_id]
        tasks.append(t5)
        # 6. 代码审查
        t6 = Task("代码审查和优化建议", "review", "low")
        t6.depends_on = [t5.task_id]
        tasks.append(t6)
        return tasks

    def _plan_modification(self, requirement: str, context: Dict) -> List[Task]:
        """修改任务分解"""
        tasks = []
        t1 = Task("定位需要修改的代码位置", "analysis", "high")
        t1.required_code = ["code_search"]
        tasks.append(t1)
        t2 = Task("分析修改影响范围", "analysis", "high")
        t2.depends_on = [t1.task_id]
        tasks.append(t2)
        t3 = Task("执行代码修改", "coding", "critical")
        t3.depends_on = [t2.task_id]
        tasks.append(t3)
        t4 = Task("验证修改后语法和功能", "verification", "high")
        t4.depends_on = [t3.task_id]
        tasks.append(t4)
        t5 = Task("运行相关测试确保无回归", "testing", "medium")
        t5.depends_on = [t4.task_id]
        tasks.append(t5)
        return tasks

    def _plan_security(self, requirement: str, context: Dict) -> List[Task]:
        """安全任务分解"""
        tasks = []
        t1 = Task("信息收集：目标侦察和资产发现", "recon", "high")
        t1.required_tools = ["whois_lookup", "dns_lookup", "nmap_scan"]
        tasks.append(t1)
        t2 = Task("端口扫描和服务识别", "scanning", "high")
        t2.depends_on = [t1.task_id]
        t2.required_tools = ["nmap_scan", "masscan_scan"]
        tasks.append(t2)
        t3 = Task("漏洞扫描和检测", "vuln_scan", "high")
        t3.depends_on = [t2.task_id]
        t3.required_tools = ["nikto_scan", "sqlmap_scan"]
        tasks.append(t3)
        t4 = Task("结果分析和报告生成", "analysis", "medium")
        t4.depends_on = [t3.task_id]
        tasks.append(t4)
        return tasks

    def _plan_research(self, requirement: str, context: Dict) -> List[Task]:
        """研究任务分解"""
        tasks = []
        t1 = Task("记忆库检索相关知识", "memory_search", "high")
        t1.required_memory = ["knowledge_base"]
        tasks.append(t1)
        t2 = Task("代码库搜索相关实现", "code_search", "medium")
        t2.required_code = ["codebase"]
        tasks.append(t2)
        t3 = Task("工具库查询可用工具", "tool_search", "medium")
        t3.required_tools = ["tool_registry"]
        tasks.append(t3)
        t4 = Task("综合分析和结论生成", "analysis", "high")
        t4.depends_on = [t1.task_id, t2.task_id, t3.task_id]
        tasks.append(t4)
        return tasks

    def _plan_general(self, requirement: str, context: Dict) -> List[Task]:
        """通用任务分解"""
        tasks = []
        t1 = Task("理解需求和上下文", "analysis", "high")
        tasks.append(t1)
        t2 = Task("制定执行计划", "planning", "high")
        t2.depends_on = [t1.task_id]
        tasks.append(t2)
        t3 = Task("执行核心操作", "execution", "critical")
        t3.depends_on = [t2.task_id]
        tasks.append(t3)
        t4 = Task("验证结果和总结", "verification", "medium")
        t4.depends_on = [t3.task_id]
        tasks.append(t4)
        return tasks

    def get_next_task(self) -> Optional[Task]:
        """获取下一个可执行任务"""
        with self._lock:
            # 按优先级排序队列中的任务
            ready_tasks = []
            for task_id in list(self.task_queue):
                task = self.tasks.get(task_id)
                if not task or task.status != TaskStatus.PENDING:
                    continue
                # 检查依赖
                deps_met = all(
                    self.tasks.get(dep_id, Task("")).status == TaskStatus.COMPLETED
                    for dep_id in task.depends_on
                )
                if deps_met:
                    ready_tasks.append(task)

            if not ready_tasks:
                return None

            # 按优先级排序
            priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
            ready_tasks.sort(key=lambda t: priority_order.get(t.priority, 2))
            return ready_tasks[0]

    def start_task(self, task_id: str) -> bool:
        task = self.tasks.get(task_id)
        if task and task.status == TaskStatus.PENDING:
            task.start()
            return True
        return False

    def complete_task(self, task_id: str, result: str = "") -> bool:
        task = self.tasks.get(task_id)
        if task:
            task.complete(result)
            with self._lock:
                self.completed_tasks.append(task_id)
                if task_id in self.task_queue:
                    self.task_queue.remove(task_id)
            return True
        return False

    def fail_task(self, task_id: str, error: str = "") -> bool:
        task = self.tasks.get(task_id)
        if task:
            task.fail(error)
            with self._lock:
                self.failed_tasks.append(task_id)
                if task_id in self.task_queue:
                    self.task_queue.remove(task_id)
            return True
        return False

    def retry_task(self, task_id: str) -> bool:
        task = self.tasks.get(task_id)
        if task and task.can_retry():
            task.status = TaskStatus.PENDING
            task.error = ""
            with self._lock:
                self.task_queue.append(task_id)
            return True
        return False

    def insert_task(self, task: Task, priority: str = "high") -> str:
        """动态插入任务"""
        task.priority = priority
        with self._lock:
            self.tasks[task.task_id] = task
            self.task_queue.append(task.task_id)
        return task.task_id

    def get_task(self, task_id: str) -> Optional[Task]:
        return self.tasks.get(task_id)

    def get_pending_tasks(self) -> List[Task]:
        return [t for t in self.tasks.values() if t.status == TaskStatus.PENDING]

    def get_in_progress_tasks(self) -> List[Task]:
        return [t for t in self.tasks.values() if t.status == TaskStatus.IN_PROGRESS]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "planner_id": self.planner_id,
            "total_tasks": len(self.tasks),
            "pending": len(self.get_pending_tasks()),
            "in_progress": len(self.get_in_progress_tasks()),
            "completed": len(self.completed_tasks),
            "failed": len(self.failed_tasks),
            "queue_size": len(self.task_queue),
        }
