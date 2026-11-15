"""职责模块：engine。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple
from libertas.foundation.config import get_data_dir
import json
import os
from libertas.foundation.terminal import terminal
import threading
import time

from .constants import ORCHESTRATION_RULES
from .models import OrchTask
from .models import OrchTaskStatus
from .models import OrchestrationPlan
from .constants import RISK_AUTO
from .constants import RISK_SUGGEST

class OrchestrationEngine:
    """自动编排引擎（结合DAG编排和规则编排）"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "orchestration")
        os.makedirs(self.data_dir, exist_ok=True)
        self._plans: Dict[str, OrchestrationPlan] = {}
        self._templates: Dict[str, Callable[[], OrchestrationPlan]] = {}
        self._rules: List[Dict] = list(ORCHESTRATION_RULES)
        self._lock = threading.RLock()
        self._max_workers = 4
        self._callbacks: List[Callable] = []
        self._init_templates()
        self._load_persisted_plans()

    # ================================================================
    # 模板管理
    # ================================================================
    def _init_templates(self):
        self._templates["security_pipeline"] = self._security_pipeline_template
        self._templates["data_pipeline"] = self._data_pipeline_template
        self._templates["deploy_pipeline"] = self._deploy_pipeline_template
        self._templates["pentest_pipeline"] = self._pentest_pipeline_template
        self._templates["vuln_verify_pipeline"] = self._vuln_verify_pipeline_template

    def _security_pipeline_template(self) -> OrchestrationPlan:
        plan = OrchestrationPlan("安全扫描流水线", "完整的安全扫描流程")
        t1 = OrchTask(name="信息收集", task_type="normal", risk_level=RISK_AUTO)
        t2 = OrchTask(name="端口扫描", dependencies=[t1.task_id], risk_level=RISK_AUTO)
        t3 = OrchTask(name="漏洞扫描", dependencies=[t2.task_id], risk_level=RISK_SUGGEST)
        t4 = OrchTask(name="报告生成", dependencies=[t3.task_id], risk_level=RISK_AUTO)
        for t in [t1, t2, t3, t4]:
            plan.add_task(t)
        return plan

    def _pentest_pipeline_template(self) -> OrchestrationPlan:
        plan = OrchestrationPlan("渗透测试流水线", "完整的渗透测试流程")
        t1 = OrchTask(name="侦察收集", risk_level=RISK_AUTO)
        t2 = OrchTask(name="端口服务识别", dependencies=[t1.task_id], risk_level=RISK_AUTO)
        t3 = OrchTask(name="漏洞探测", dependencies=[t2.task_id], risk_level=RISK_SUGGEST)
        t4 = OrchTask(name="漏洞验证", dependencies=[t3.task_id], risk_level=RISK_SUGGEST)
        t5 = OrchTask(name="后渗透测试", dependencies=[t4.task_id], risk_level=RISK_SUGGEST,
                      compensation=lambda r: terminal.info("清理后渗透痕迹", "orchestration"))
        t6 = OrchTask(name="报告生成", dependencies=[t5.task_id], risk_level=RISK_AUTO)
        for t in [t1, t2, t3, t4, t5, t6]:
            plan.add_task(t)
        return plan

    def _vuln_verify_pipeline_template(self) -> OrchestrationPlan:
        plan = OrchestrationPlan("漏洞验证流水线", "漏洞探测、验证、利用、报告")
        t1 = OrchTask(name="漏洞情报收集", risk_level=RISK_AUTO)
        t2 = OrchTask(name="漏洞探测扫描", dependencies=[t1.task_id], risk_level=RISK_AUTO)
        t3 = OrchTask(name="PoC验证", dependencies=[t2.task_id], risk_level=RISK_SUGGEST)
        t4 = OrchTask(name="漏洞利用", dependencies=[t3.task_id], risk_level=RISK_SUGGEST,
                      compensation=lambda r: terminal.info("回滚漏洞利用", "orchestration"))
        t5 = OrchTask(name="报告生成", dependencies=[t4.task_id], risk_level=RISK_AUTO)
        for t in [t1, t2, t3, t4, t5]:
            plan.add_task(t)
        return plan

    def _data_pipeline_template(self) -> OrchestrationPlan:
        plan = OrchestrationPlan("数据处理流水线", "数据采集、处理、存储流程")
        t1 = OrchTask(name="数据采集", risk_level=RISK_AUTO)
        t2 = OrchTask(name="数据清洗", dependencies=[t1.task_id], risk_level=RISK_AUTO)
        t3 = OrchTask(name="数据分析", dependencies=[t2.task_id], risk_level=RISK_AUTO)
        t4 = OrchTask(name="数据存储", dependencies=[t3.task_id], risk_level=RISK_AUTO)
        for t in [t1, t2, t3, t4]:
            plan.add_task(t)
        return plan

    def _deploy_pipeline_template(self) -> OrchestrationPlan:
        plan = OrchestrationPlan("部署流水线", "构建、测试、部署流程")
        t1 = OrchTask(name="代码构建", risk_level=RISK_AUTO)
        t2 = OrchTask(name="单元测试", dependencies=[t1.task_id], risk_level=RISK_AUTO)
        t3 = OrchTask(name="集成测试", dependencies=[t2.task_id], risk_level=RISK_AUTO)
        t4 = OrchTask(name="部署发布", dependencies=[t3.task_id], risk_level=RISK_SUGGEST)
        t5 = OrchTask(name="验证回滚", dependencies=[t4.task_id], risk_level=RISK_SUGGEST,
                      compensation=lambda r: terminal.info("回滚部署", "orchestration"))
        for t in [t1, t2, t3, t4, t5]:
            plan.add_task(t)
        return plan

    # ================================================================
    # 计划管理
    # ================================================================
    def create_plan(self, name: str, description: str = "", template: str = "") -> OrchestrationPlan:
        if template and template in self._templates:
            plan = self._templates[template]()
            plan.name = name
            plan.description = description or plan.description
        else:
            plan = OrchestrationPlan(name, description)
        with self._lock:
            self._plans[plan.plan_id] = plan
        self._persist_plan(plan)
        return plan

    def get_plan(self, plan_id: str) -> Optional[OrchestrationPlan]:
        return self._plans.get(plan_id)

    def cancel_plan(self, plan_id: str) -> bool:
        plan = self._plans.get(plan_id)
        if plan:
            plan.status = "cancelled"
            for task in plan.tasks.values():
                if task.status in (OrchTaskStatus.PENDING, OrchTaskStatus.READY):
                    task.status = OrchTaskStatus.CANCELLED
            self._persist_plan(plan)
            return True
        return False

    def list_plans(self) -> List[OrchestrationPlan]:
        return sorted(self._plans.values(), key=lambda p: p.updated_at, reverse=True)

    def list_templates(self) -> List[str]:
        return list(self._templates.keys())

    # ================================================================
    # 规则编排（0.1.5版本的设计）
    # ================================================================
    def get_followup_tasks(self, tool_name: str, tool_result: Dict) -> List[Dict]:
        """根据工具结果生成后续任务建议（0.1.5版本的设计）"""
        suggestions = []
        for rule in self._rules:
            trigger = rule["trigger_tool"]
            if isinstance(trigger, (list, tuple)):
                if tool_name not in trigger:
                    continue
            elif tool_name != trigger:
                continue
            try:
                if not rule["condition"](tool_result):
                    continue
            except Exception:
                continue
            target = tool_result.get(rule.get("target_from", "target"), "")
            suggestions.append({
                "rule_name": rule["name"],
                "next_tool": rule["next_tool"],
                "target": target,
                "risk": rule["risk"],
                "description": rule["description"],
                "auto_execute": rule["risk"] == RISK_AUTO,
            })
        return suggestions

    def add_rule(self, rule: Dict):
        """添加编排规则"""
        self._rules.append(rule)

    def list_rules(self) -> List[Dict]:
        """列出所有编排规则"""
        return [{"name": r["name"], "description": r["description"],
                 "trigger_tool": r["trigger_tool"], "risk": r["risk"]}
                for r in self._rules]

    # ================================================================
    # 执行计划
    # ================================================================
    def execute_plan(self, plan_id: str, context: Optional[Dict] = None,
                     max_concurrent: int = 3, compensate_on_failure: bool = True) -> Dict[str, Any]:
        """执行编排计划"""
        plan = self._plans.get(plan_id)
        if not plan:
            return {"success": False, "error": "计划不存在"}

        valid, errors = plan.validate()
        if not valid:
            return {"success": False, "error": f"验证失败: {errors}"}

        plan.status = "running"
        plan.context = context or {}
        terminal.section(f"执行编排计划: {plan.name}")

        order = plan.topological_order()
        completed_ids = set()
        failed_ids = set()
        lock = threading.Lock()
        semaphore = threading.Semaphore(max_concurrent)

        def run_task(task: OrchTask):
            with semaphore:
                terminal.step(order.index(task) + 1, task.name)
                success = task.execute(plan.context)
                with lock:
                    if success:
                        completed_ids.add(task.task_id)
                        terminal.success(f"完成: {task.name} ({task.duration_ms:.0f}ms)", "orchestration")
                        # 触发全局回调
                        self._trigger_callbacks("task_success", plan, task)
                    else:
                        failed_ids.add(task.task_id)
                        terminal.error(f"失败: {task.name} - {task.error}", "orchestration")
                        self._trigger_callbacks("task_failed", plan, task)

        threads = []
        for task in order:
            while not task.can_start(completed_ids):
                if any(dep in failed_ids for dep in task.dependencies):
                    task.status = OrchTaskStatus.SKIPPED
                    break
                time.sleep(0.1)
            if task.status == OrchTaskStatus.SKIPPED:
                continue
            t = threading.Thread(target=run_task, args=(task,))
            t.start()
            threads.append(t)

        for t in threads:
            t.join()

        # 失败补偿
        if failed_ids and compensate_on_failure:
            terminal.warn("执行补偿操作...", "orchestration")
            for task in reversed(order):
                if task.task_id in completed_ids:
                    task.compensate()

        progress = plan.get_progress()
        plan.status = "completed" if not failed_ids else "failed"
        plan.updated_at = time.time()
        self._persist_plan(plan)

        self._trigger_callbacks("plan_complete", plan, None)

        return {
            "success": not failed_ids,
            "plan_id": plan_id,
            "progress": progress,
            "failed_tasks": list(failed_ids),
            "duration_ms": (time.time() - plan.created_at) * 1000,
        }

    # ================================================================
    # 回调
    # ================================================================
    def on_event(self, callback: Callable):
        """注册全局回调"""
        self._callbacks.append(callback)

    def _trigger_callbacks(self, event: str, plan: OrchestrationPlan, task: Optional[OrchTask]):
        for cb in self._callbacks:
            try:
                cb(event, plan, task)
            except Exception:
                pass

    # ================================================================
    # 持久化
    # ================================================================
    def _persist_plan(self, plan: OrchestrationPlan):
        """持久化计划"""
        try:
            plan_file = os.path.join(self.data_dir, f"{plan.plan_id}.json")
            with open(plan_file, "w", encoding="utf-8") as f:
                json.dump(plan.to_dict(), f, ensure_ascii=False, indent=2, default=str)
        except Exception as e:
            terminal.warn(f"持久化计划失败: {e}", "orchestration")

    def _load_persisted_plans(self):
        """加载持久化的计划"""
        try:
            if not os.path.isdir(self.data_dir):
                return
            for fn in os.listdir(self.data_dir):
                if not fn.endswith(".json"):
                    continue
                try:
                    with open(os.path.join(self.data_dir, fn), "r", encoding="utf-8") as f:
                        data = json.load(f)
                    plan = OrchestrationPlan.from_dict(data)
                    self._plans[plan.plan_id] = plan
                except Exception:
                    pass
        except Exception:
            pass

    # ================================================================
    # 统计
    # ================================================================
    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_plans": len(self._plans),
            "templates": self.list_templates(),
            "rules": len(self._rules),
            "by_status": {s: sum(1 for p in self._plans.values() if p.status == s)
                          for s in set(p.status for p in self._plans.values())},
        }
