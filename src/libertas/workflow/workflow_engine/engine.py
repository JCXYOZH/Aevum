"""工作流职责：engine。"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

from .models import NodeStatus
from .models import WorkflowDefinition
from .models import WorkflowExecution
from .models import WorkflowNode

class WorkflowEngine:
    """自动化工作流引擎"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "workflows")
        os.makedirs(self.data_dir, exist_ok=True)
        self._workflows: Dict[str, WorkflowDefinition] = {}
        self._executions: Dict[str, WorkflowExecution] = {}
        self._templates: Dict[str, WorkflowDefinition] = {}
        self._lock = threading.RLock()
        self._running = False
        self._worker_thread: Optional[threading.Thread] = None
        self._execution_queue: List[str] = []
        self._node_handlers: Dict[str, Callable] = {}
        self._init_templates()
        self._load()

    def _init_templates(self):
        """初始化工作流模板"""
        # 数据处理流水线模板
        data_pipeline = WorkflowDefinition("数据处理流水线", "数据采集、处理、存储的标准流水线", "data")
        data_pipeline.is_template = True
        start = WorkflowNode("start", "开始", "start")
        collect = WorkflowNode("collect", "数据采集", "task")
        process = WorkflowNode("process", "数据处理", "task")
        validate = WorkflowNode("validate", "数据校验", "condition")
        store = WorkflowNode("store", "数据存储", "task")
        end = WorkflowNode("end", "结束", "end")
        data_pipeline.add_node(start)
        data_pipeline.add_node(collect)
        data_pipeline.add_node(process)
        data_pipeline.add_node(validate)
        data_pipeline.add_node(store)
        data_pipeline.add_node(end)
        data_pipeline.connect("start", "collect")
        data_pipeline.connect("collect", "process")
        data_pipeline.connect("process", "validate")
        validate.true_next = "store"
        validate.false_next = "end"
        data_pipeline.connect("store", "end")
        self._templates[data_pipeline.workflow_id] = data_pipeline

        # 安全扫描流水线模板
        security_pipeline = WorkflowDefinition("安全扫描流水线", "漏洞扫描、分析、报告的标准流水线", "security")
        security_pipeline.is_template = True
        s_start = WorkflowNode("s_start", "开始", "start")
        s_scan = WorkflowNode("s_scan", "漏洞扫描", "task")
        s_analyze = WorkflowNode("s_analyze", "风险分析", "task")
        s_report = WorkflowNode("s_report", "生成报告", "task")
        s_notify = WorkflowNode("s_notify", "发送通知", "task")
        s_end = WorkflowNode("s_end", "结束", "end")
        security_pipeline.add_node(s_start)
        security_pipeline.add_node(s_scan)
        security_pipeline.add_node(s_analyze)
        security_pipeline.add_node(s_report)
        security_pipeline.add_node(s_notify)
        security_pipeline.add_node(s_end)
        security_pipeline.connect("s_start", "s_scan")
        security_pipeline.connect("s_scan", "s_analyze")
        security_pipeline.connect("s_analyze", "s_report")
        security_pipeline.connect("s_report", "s_notify")
        security_pipeline.connect("s_notify", "s_end")
        self._templates[security_pipeline.workflow_id] = security_pipeline

    def _load(self):
        workflows_file = os.path.join(self.data_dir, "workflows.json")
        try:
            if os.path.exists(workflows_file):
                with open(workflows_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for w_data in data.get("workflows", []):
                    wf = WorkflowDefinition(
                        name=w_data.get("name", ""),
                        description=w_data.get("description", ""),
                        category=w_data.get("category", "general"),
                    )
                    wf.workflow_id = w_data.get("workflow_id", wf.workflow_id)
                    wf.version = w_data.get("version", "1.0.0")
                    wf.tags = w_data.get("tags", [])
                    wf.usage_count = w_data.get("usage_count", 0)
                    wf.start_node_id = w_data.get("start_node_id", "")
                    wf.end_node_id = w_data.get("end_node_id", "")
                    for n_data in w_data.get("nodes", []):
                        node = WorkflowNode(
                            node_id=n_data.get("node_id", ""),
                            name=n_data.get("name", ""),
                            node_type=n_data.get("node_type", "task"),
                        )
                        node.next_nodes = n_data.get("next_nodes", [])
                        node.condition = n_data.get("condition", "")
                        wf.nodes[node.node_id] = node
                    self._workflows[wf.workflow_id] = wf
        except Exception as e:
            terminal.warn(f"加载工作流失败: {e}", "workflow")

    def _save(self):
        workflows_file = os.path.join(self.data_dir, "workflows.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                "workflows": [w.to_dict() for w in self._workflows.values()],
            }
            with open(workflows_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def create_workflow(self, name: str, description: str = "",
                        category: str = "general") -> WorkflowDefinition:
        wf = WorkflowDefinition(name, description, category)
        with self._lock:
            self._workflows[wf.workflow_id] = wf
            self._save()
        return wf

    def create_from_template(self, template_id: str, name: str = "") -> Optional[WorkflowDefinition]:
        template = self._templates.get(template_id)
        if not template:
            # 按名称查找
            for t in self._templates.values():
                if t.name == template_id:
                    template = t
                    break
        if not template:
            return None
        wf = WorkflowDefinition(name or template.name, template.description, template.category)
        wf.variables = dict(template.variables)
        for node in template.nodes.values():
            new_node = WorkflowNode(node.node_id, node.name, node.node_type)
            new_node.next_nodes = list(node.next_nodes)
            new_node.condition = node.condition
            new_node.true_next = node.true_next
            new_node.false_next = node.false_next
            wf.nodes[new_node.node_id] = new_node
        wf.start_node_id = template.start_node_id
        wf.end_node_id = template.end_node_id
        with self._lock:
            self._workflows[wf.workflow_id] = wf
            self._save()
        return wf

    def get_workflow(self, workflow_id: str) -> Optional[WorkflowDefinition]:
        return self._workflows.get(workflow_id)

    def list_workflows(self, category: str = "", limit: int = 50) -> List[WorkflowDefinition]:
        wfs = list(self._workflows.values())
        if category:
            wfs = [w for w in wfs if w.category == category]
        wfs.sort(key=lambda w: w.created_at, reverse=True)
        return wfs[:limit]

    def list_templates(self) -> List[WorkflowDefinition]:
        return list(self._templates.values())

    def delete_workflow(self, workflow_id: str) -> bool:
        with self._lock:
            if workflow_id in self._workflows:
                del self._workflows[workflow_id]
                self._save()
                return True
        return False

    def register_node_handler(self, node_type: str, handler: Callable):
        self._node_handlers[node_type] = handler

    def execute(self, workflow_id: str,
                input_data: Optional[Dict] = None) -> Optional[WorkflowExecution]:
        """执行工作流"""
        wf = self._workflows.get(workflow_id)
        if not wf:
            return None

        valid, errors = wf.validate()
        if not valid:
            terminal.error(f"工作流验证失败: {errors}", "workflow")
            return None

        execution = WorkflowExecution(workflow_id, input_data)
        execution.status = "running"
        execution.started_at = time.time()
        execution.context = dict(input_data or {})

        with self._lock:
            self._executions[execution.execution_id] = execution
            wf.usage_count += 1
            self._save()

        # 执行工作流
        self._execute_node(wf, wf.start_node_id, execution)

        execution.completed_at = time.time()
        execution.duration_ms = (execution.completed_at - execution.started_at) * 1000

        if execution.status == "running":
            execution.status = "success"

        terminal.info(f"工作流执行完成: {wf.name} ({execution.duration_ms:.0f}ms, {execution.status})", "workflow")
        return execution

    def _execute_node(self, wf: WorkflowDefinition, node_id: str,
                      execution: WorkflowExecution):
        """执行单个节点"""
        if not node_id or node_id not in wf.nodes:
            return

        node = wf.nodes[node_id]
        execution.current_node_id = node_id
        node.status = NodeStatus.RUNNING
        node.started_at = time.time()
        execution.add_log("info", f"执行节点: {node.name}", node_id)

        try:
            if node.node_type == "start":
                node.status = NodeStatus.SUCCESS
            elif node.node_type == "end":
                node.status = NodeStatus.SUCCESS
                execution.output_data = dict(execution.context)
                return
            elif node.node_type == "delay":
                time.sleep(node.delay_seconds)
                node.status = NodeStatus.SUCCESS
            elif node.node_type == "condition":
                # 简单条件评估
                result = self._evaluate_condition(node.condition, execution.context)
                node.status = NodeStatus.SUCCESS
                node.output_data = {"result": result}
                next_node = node.true_next if result else node.false_next
                if next_node:
                    self._execute_node(wf, next_node, execution)
                    return
            elif node.node_type == "task":
                if node.handler:
                    result = node.handler(node.input_data, execution.context)
                    node.output_data = result if isinstance(result, dict) else {"result": result}
                    execution.context.update(node.output_data)
                elif node.name in self._node_handlers:
                    result = self._node_handlers[node.name](node.input_data, execution.context)
                    node.output_data = result if isinstance(result, dict) else {"result": result}
                    execution.context.update(node.output_data)
                node.status = NodeStatus.SUCCESS
            else:
                node.status = NodeStatus.SUCCESS

            node.completed_at = time.time()
            node.duration_ms = (node.completed_at - node.started_at) * 1000
            execution.executed_nodes.append(node_id)
            execution.node_results[node_id] = node.output_data

            # 执行后续节点
            for next_id in node.next_nodes:
                self._execute_node(wf, next_id, execution)

        except Exception as e:
            node.status = NodeStatus.FAILED
            node.error = str(e)
            node.completed_at = time.time()
            node.duration_ms = (node.completed_at - node.started_at) * 1000
            execution.status = "failed"
            execution.error = f"节点 {node.name} 执行失败: {e}"
            execution.add_log("error", str(e), node_id)

            if node.on_failure:
                try:
                    node.on_failure(e)
                except Exception:
                    pass

    def _evaluate_condition(self, condition: str, context: Dict) -> bool:
        """简单条件评估"""
        if not condition:
            return True
        try:
            # 支持简单的变量比较
            result = eval(condition, {"__builtins__": {}}, context)
            return bool(result)
        except Exception:
            return False

    def get_execution(self, execution_id: str) -> Optional[WorkflowExecution]:
        return self._executions.get(execution_id)

    def list_executions(self, workflow_id: str = "",
                        status: str = "", limit: int = 50) -> List[WorkflowExecution]:
        execs = list(self._executions.values())
        if workflow_id:
            execs = [e for e in execs if e.workflow_id == workflow_id]
        if status:
            execs = [e for e in execs if e.status == status]
        execs.sort(key=lambda e: e.started_at, reverse=True)
        return execs[:limit]

    def cancel_execution(self, execution_id: str) -> bool:
        execution = self._executions.get(execution_id)
        if execution and execution.status == "running":
            execution.status = "cancelled"
            return True
        return False

    def get_available_tools(self) -> List[Dict[str, Any]]:
        """返回工作流可用的节点类型（供前端工作流编辑器使用）"""
        return [
            {"type": "start", "name": "开始", "description": "工作流起点", "icon": "play"},
            {"type": "task", "name": "任务", "description": "执行一个任务或工具调用", "icon": "tool"},
            {"type": "condition", "name": "条件", "description": "条件判断分支", "icon": "branch"},
            {"type": "end", "name": "结束", "description": "工作流终点", "icon": "stop"},
        ]

    def get_stats(self) -> Dict[str, Any]:
        total_executions = len(self._executions)
        success = sum(1 for e in self._executions.values() if e.status == "success")
        failed = sum(1 for e in self._executions.values() if e.status == "failed")
        return {
            "total_workflows": len(self._workflows),
            "templates": len(self._templates),
            "total_executions": total_executions,
            "success": success,
            "failed": failed,
            "running": sum(1 for e in self._executions.values() if e.status == "running"),
            "success_rate": round(success / max(total_executions, 1), 4),
            "avg_duration_ms": (sum(e.duration_ms for e in self._executions.values()) /
                                max(total_executions, 1)),
            "total_nodes": sum(len(w.nodes) for w in self._workflows.values()),
            "by_category": {c: len([w for w in self._workflows.values() if w.category == c])
                           for c in set(w.category for w in self._workflows.values())},
        }
