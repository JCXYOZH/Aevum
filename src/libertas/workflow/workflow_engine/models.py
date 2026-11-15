"""工作流职责：models。"""

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


class NodeType(Enum):
    START = "start"
    END = "end"
    TASK = "task"
    CONDITION = "condition"
    PARALLEL = "parallel"
    JOIN = "join"
    LOOP = "loop"
    DELAY = "delay"
    SCRIPT = "script"
    WEBHOOK = "webhook"
    APPROVAL = "approval"

class NodeStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"
    CANCELLED = "cancelled"
    WAITING = "waiting"

class WorkflowNode:
    """工作流节点"""

    def __init__(self, node_id: str = "", name: str = "",
                 node_type: str = "task",
                 handler: Optional[Callable] = None):
        self.node_id = node_id or f"node_{uuid.uuid4().hex[:6]}"
        self.name = name
        self.node_type = node_type
        self.handler = handler
        self.status = NodeStatus.PENDING
        self.input_data: Dict[str, Any] = {}
        self.output_data: Dict[str, Any] = {}
        self.error = ""
        self.started_at = 0.0
        self.completed_at = 0.0
        self.duration_ms = 0.0
        self.retry_count = 0
        self.max_retries = 3
        self.retry_delay = 5.0
        self.timeout = 300.0
        self.next_nodes: List[str] = []  # node_ids
        self.condition: str = ""  # 条件表达式
        self.true_next: str = ""  # 条件为真时的下一个节点
        self.false_next: str = ""  # 条件为假时的下一个节点
        self.loop_count = 0
        self.max_loops = 100
        self.delay_seconds = 0.0
        self.metadata: Dict[str, Any] = {}
        self.on_success: Optional[Callable] = None
        self.on_failure: Optional[Callable] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "node_id": self.node_id,
            "name": self.name,
            "node_type": self.node_type,
            "status": self.status.value,
            "error": self.error,
            "duration_ms": round(self.duration_ms, 1),
            "retry_count": self.retry_count,
            "next_nodes": self.next_nodes,
            "condition": self.condition,
            "metadata": self.metadata,
        }

class WorkflowDefinition:
    """工作流定义"""

    def __init__(self, name: str = "", description: str = "",
                 category: str = "general"):
        self.workflow_id = f"wf_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.description = description
        self.category = category
        self.nodes: Dict[str, WorkflowNode] = {}
        self.start_node_id = ""
        self.end_node_id = ""
        self.created_at = time.time()
        self.updated_at = time.time()
        self.version = "1.0.0"
        self.tags: List[str] = []
        self.variables: Dict[str, Any] = {}
        self.is_template = False
        self.usage_count = 0
        self.metadata: Dict[str, Any] = {}

    def add_node(self, node: WorkflowNode) -> str:
        self.nodes[node.node_id] = node
        if node.node_type == "start" and not self.start_node_id:
            self.start_node_id = node.node_id
        if node.node_type == "end" and not self.end_node_id:
            self.end_node_id = node.node_id
        return node.node_id

    def connect(self, from_node: str, to_node: str):
        if from_node in self.nodes:
            self.nodes[from_node].next_nodes.append(to_node)

    def validate(self) -> Tuple[bool, List[str]]:
        """验证工作流"""
        errors = []
        if not self.start_node_id:
            errors.append("缺少开始节点")
        if not self.end_node_id:
            errors.append("缺少结束节点")
        if self.start_node_id and self.start_node_id not in self.nodes:
            errors.append("开始节点不存在")
        # 检查所有节点都有出口（除了结束节点）
        for node in self.nodes.values():
            if node.node_type != "end" and not node.next_nodes and not node.true_next:
                errors.append(f"节点 {node.name} 没有后续节点")
        return len(errors) == 0, errors

    def to_dict(self) -> Dict[str, Any]:
        return {
            "workflow_id": self.workflow_id,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "nodes": [n.to_dict() for n in self.nodes.values()],
            "start_node_id": self.start_node_id,
            "end_node_id": self.end_node_id,
            "version": self.version,
            "tags": self.tags,
            "usage_count": self.usage_count,
        }

class WorkflowExecution:
    """工作流执行实例"""

    def __init__(self, workflow_id: str = "", input_data: Optional[Dict] = None):
        self.execution_id = f"exec_{uuid.uuid4().hex[:8]}"
        self.workflow_id = workflow_id
        self.status = "pending"  # pending / running / success / failed / cancelled
        self.input_data = input_data or {}
        self.output_data: Dict[str, Any] = {}
        self.context: Dict[str, Any] = {}
        self.started_at = 0.0
        self.completed_at = 0.0
        self.duration_ms = 0.0
        self.error = ""
        self.current_node_id = ""
        self.executed_nodes: List[str] = []
        self.node_results: Dict[str, Dict[str, Any]] = {}
        self.logs: List[Dict[str, Any]] = []
        self.metadata: Dict[str, Any] = {}

    def add_log(self, level: str, message: str, node_id: str = ""):
        self.logs.append({
            "timestamp": time.time(),
            "level": level,
            "message": message,
            "node_id": node_id,
        })

    def to_dict(self) -> Dict[str, Any]:
        return {
            "execution_id": self.execution_id,
            "workflow_id": self.workflow_id,
            "status": self.status,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "duration_ms": round(self.duration_ms, 1),
            "error": self.error,
            "current_node_id": self.current_node_id,
            "executed_count": len(self.executed_nodes),
            "log_count": len(self.logs),
        }

class WorkflowStep:
    """向后兼容占位类"""
    def __init__(self, *args, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)
    def __getattr__(self, name):
        return None
