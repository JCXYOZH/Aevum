"""任务规划职责：planner。"""

from __future__ import annotations

import threading
import time
import uuid
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from libertas.foundation.terminal import terminal

from .models import SubTask
from .models import TaskPlan
from .models import TaskStatus

class TaskPlanner:
    """多步骤任务分解器"""

    def __init__(self):
        self._plans: Dict[str, TaskPlan] = {}
        self._templates: Dict[str, Callable[[str], TaskPlan]] = {}
        self._lock = threading.RLock()
        self._init_templates()

    def _init_templates(self):
        """初始化常用任务模板"""
        self._templates["security_scan"] = self._security_scan_template
        self._templates["data_sync"] = self._data_sync_template
        self._templates["report_generation"] = self._report_generation_template
        self._templates["system_maintenance"] = self._system_maintenance_template

    def _security_scan_template(self, target: str) -> TaskPlan:
        plan = TaskPlan(goal=f"安全扫描: {target}", description="完整的安全扫描流程")
        t1 = SubTask(title="信息收集", description="收集目标基本信息", task_type="recon",
                      estimated_duration=30, priority=10)
        t2 = SubTask(title="端口扫描", description="扫描开放端口和服务", task_type="scan",
                      estimated_duration=60, dependencies=[t1.task_id], priority=9)
        t3 = SubTask(title="漏洞扫描", description="检测已知漏洞", task_type="vuln",
                      estimated_duration=120, dependencies=[t2.task_id], priority=8)
        t4 = SubTask(title="Web应用扫描", description="扫描Web应用漏洞", task_type="web",
                      estimated_duration=90, dependencies=[t2.task_id], priority=7)
        t5 = SubTask(title="生成报告", description="汇总扫描结果", task_type="report",
                      estimated_duration=30, dependencies=[t3.task_id, t4.task_id], priority=10)
        for t in [t1, t2, t3, t4, t5]:
            plan.add_task(t)
        return plan

    def _data_sync_template(self, target: str) -> TaskPlan:
        plan = TaskPlan(goal=f"数据同步: {target}", description="多设备数据同步流程")
        t1 = SubTask(title="差异分析", description="分析本地与远程差异", estimated_duration=10)
        t2 = SubTask(title="增量上传", description="上传变更数据", dependencies=[t1.task_id], estimated_duration=60)
        t3 = SubTask(title="增量下载", description="下载远程变更", dependencies=[t1.task_id], estimated_duration=60)
        t4 = SubTask(title="冲突解决", description="解决同步冲突", dependencies=[t2.task_id, t3.task_id], estimated_duration=30)
        t5 = SubTask(title="完整性校验", description="校验同步后数据完整性", dependencies=[t4.task_id], estimated_duration=15)
        for t in [t1, t2, t3, t4, t5]:
            plan.add_task(t)
        return plan

    def _report_generation_template(self, target: str) -> TaskPlan:
        plan = TaskPlan(goal=f"报告生成: {target}", description="自动化报告生成流程")
        t1 = SubTask(title="数据收集", description="收集报告所需数据", estimated_duration=30)
        t2 = SubTask(title="数据分析", description="分析和计算指标", dependencies=[t1.task_id], estimated_duration=20)
        t3 = SubTask(title="图表生成", description="生成可视化图表", dependencies=[t2.task_id], estimated_duration=15)
        t4 = SubTask(title="报告渲染", description="渲染最终报告", dependencies=[t3.task_id], estimated_duration=10)
        t5 = SubTask(title="分发报告", description="发送给相关人员", dependencies=[t4.task_id], estimated_duration=5)
        for t in [t1, t2, t3, t4, t5]:
            plan.add_task(t)
        return plan

    def _system_maintenance_template(self, target: str) -> TaskPlan:
        plan = TaskPlan(goal=f"系统维护: {target}", description="系统维护流程")
        t1 = SubTask(title="健康检查", description="检查系统健康状态", estimated_duration=10)
        t2 = SubTask(title="数据备份", description="备份关键数据", dependencies=[t1.task_id], estimated_duration=60)
        t3 = SubTask(title="清理缓存", description="清理过期缓存", dependencies=[t1.task_id], estimated_duration=15)
        t4 = SubTask(title="日志轮转", description="轮转和归档日志", dependencies=[t1.task_id], estimated_duration=10)
        t5 = SubTask(title="验证恢复", description="验证系统恢复正常", dependencies=[t2.task_id, t3.task_id, t4.task_id], estimated_duration=10)
        for t in [t1, t2, t3, t4, t5]:
            plan.add_task(t)
        return plan

    def create_plan(self, goal: str, description: str = "", template: str = "") -> TaskPlan:
        """创建任务计划"""
        if template and template in self._templates:
            plan = self._templates[template](goal)
            plan.goal = goal
            plan.description = description or plan.description
        else:
            plan = TaskPlan(goal=goal, description=description)
        with self._lock:
            self._plans[plan.plan_id] = plan
        return plan

    def decompose(self, goal: str, description: str = "",
                  decomposition_hints: Optional[List[str]] = None) -> TaskPlan:
        """分解复杂目标为子任务"""
        plan = TaskPlan(goal=goal, description=description)
        # 基于目标关键词的简单分解
        goal_lower = goal.lower()
        if any(kw in goal_lower for kw in ["扫描", "scan", "安全", "security"]):
            return self.create_plan(goal, description, template="security_scan")
        elif any(kw in goal_lower for kw in ["同步", "sync", "备份", "backup"]):
            return self.create_plan(goal, description, template="data_sync")
        elif any(kw in goal_lower for kw in ["报告", "report", "生成"]):
            return self.create_plan(goal, description, template="report_generation")
        elif any(kw in goal_lower for kw in ["维护", "maintenance", "清理"]):
            return self.create_plan(goal, description, template="system_maintenance")

        # 通用分解：准备 -> 执行 -> 验证
        t1 = SubTask(title="准备阶段", description="准备执行环境和资源", task_type="setup",
                      estimated_duration=10, priority=10)
        t2 = SubTask(title="执行阶段", description="执行核心任务", task_type="execute",
                      estimated_duration=60, dependencies=[t1.task_id], priority=9)
        t3 = SubTask(title="验证阶段", description="验证执行结果", task_type="verify",
                      estimated_duration=15, dependencies=[t2.task_id], priority=10)
        for t in [t1, t2, t3]:
            plan.add_task(t)

        if decomposition_hints:
            for i, hint in enumerate(decomposition_hints):
                task = SubTask(title=f"子任务 {i+1}: {hint}", description=hint,
                               task_type="custom", estimated_duration=30)
                plan.add_task(task)

        with self._lock:
            self._plans[plan.plan_id] = plan
        return plan

    def get_plan(self, plan_id: str) -> Optional[TaskPlan]:
        return self._plans.get(plan_id)

    def list_plans(self) -> List[TaskPlan]:
        return sorted(self._plans.values(), key=lambda p: p.updated_at, reverse=True)

    def execute_plan(self, plan_id: str, max_concurrent: int = 3) -> bool:
        """执行任务计划"""
        plan = self._plans.get(plan_id)
        if not plan:
            return False

        valid, errors = plan.validate()
        if not valid:
            terminal.error(f"计划验证失败: {errors}", "task_planner")
            return False

        plan.status = "running"
        terminal.section(f"执行任务计划: {plan.goal}")

        order = plan.topological_order()
        completed_ids = set()
        lock = threading.Lock()
        semaphore = threading.Semaphore(max_concurrent)

        def run_task(task: SubTask):
            with semaphore:
                terminal.step(order.index(task) + 1, task.title)
                success = task.execute()
                with lock:
                    if success:
                        completed_ids.add(task.task_id)
                        terminal.success(f"完成: {task.title} ({task.duration_ms:.0f}ms)", "task_planner")
                    else:
                        terminal.error(f"失败: {task.title} - {task.error}", "task_planner")

        threads = []
        for task in order:
            # 等待依赖完成
            while not task.can_start(completed_ids):
                if any(self.subtasks.get(dep, SubTask()).status == TaskStatus.FAILED for dep in task.dependencies):
                    task.status = TaskStatus.SKIPPED
                    break
                time.sleep(0.1)
            if task.status == TaskStatus.SKIPPED:
                continue
            t = threading.Thread(target=run_task, args=(task,))
            t.start()
            threads.append(t)

        for t in threads:
            t.join()

        progress = plan.get_progress()
        if progress["failed"] > 0:
            plan.status = "failed"
            terminal.error(f"计划执行完成（有失败）: {progress['completed']}/{progress['total']} 成功", "task_planner")
        else:
            plan.status = "completed"
            terminal.success(f"计划执行完成: {progress['completed']}/{progress['total']} 成功", "task_planner")

        return progress["failed"] == 0

    def cancel_plan(self, plan_id: str) -> bool:
        plan = self._plans.get(plan_id)
        if plan:
            for task in plan.subtasks.values():
                if task.status in (TaskStatus.PENDING, TaskStatus.READY):
                    task.status = TaskStatus.CANCELLED
            plan.status = "cancelled"
            return True
        return False

    def get_stats(self) -> Dict[str, Any]:
        total = len(self._plans)
        by_status = {}
        for plan in self._plans.values():
            by_status[plan.status] = by_status.get(plan.status, 0) + 1
        return {
            "total_plans": total,
            "by_status": by_status,
            "templates": list(self._templates.keys()),
        }
