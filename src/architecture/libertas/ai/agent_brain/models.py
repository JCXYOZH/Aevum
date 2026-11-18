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


class AgentState:
    """Agent运行状态"""

    def __init__(self):
        self.state_id = f"state_{uuid.uuid4().hex[:8]}"
        self.current_phase = AgentPhase.IDLE
        self.previous_phase = AgentPhase.IDLE
        self.phase_start_time = 0.0
        self.phase_duration_ms = 0.0
        self.cycle_count = 0
        self.max_cycles = 100
        self.current_task_id = ""
        self.current_goal_id = ""
        self.token_used = 0
        self.token_budget = 100000
        self.error_count = 0
        self.consecutive_errors = 0
        self.max_consecutive_errors = 5
        self.success_count = 0
        self.total_actions = 0
        self.is_running = False
        self.is_paused = False
        self.should_stop = False
        self.last_action = ""
        self.last_result = ""
        self.last_error = ""
        self.thoughts: List[str] = []
        self.observations: List[str] = []
        self.reflections: List[str] = []
        self.phase_history: deque = deque(maxlen=200)
        self.metadata: Dict[str, Any] = {}

    def transition_to(self, phase: AgentPhase):
        """状态转换"""
        if self.current_phase != phase:
            self.previous_phase = self.current_phase
            self.current_phase = phase
            self.phase_start_time = time.time()
            self.phase_history.append({
                "from": self.previous_phase.value,
                "to": phase.value,
                "timestamp": time.time(),
                "cycle": self.cycle_count,
            })
            terminal.debug(f"状态转换: {self.previous_phase.value} -> {phase.value}", "agent_state")

    def record_action(self, action: str, result: str = "", success: bool = True):
        """记录行动"""
        self.total_actions += 1
        self.last_action = action
        self.last_result = result
        if success:
            self.success_count += 1
            self.consecutive_errors = 0
        else:
            self.error_count += 1
            self.consecutive_errors += 1

    def add_thought(self, thought: str):
        self.thoughts.append(thought)
        if len(self.thoughts) > 100:
            self.thoughts = self.thoughts[-100:]

    def add_observation(self, observation: str):
        self.observations.append(observation)
        if len(self.observations) > 100:
            self.observations = self.observations[-100:]

    def add_reflection(self, reflection: str):
        self.reflections.append(reflection)
        if len(self.reflections) > 100:
            self.reflections = self.reflections[-100:]

    def should_continue(self) -> bool:
        """判断是否继续循环"""
        if self.should_stop:
            return False
        if self.is_paused:
            return False
        if self.cycle_count >= self.max_cycles:
            return False
        if self.consecutive_errors >= self.max_consecutive_errors:
            return False
        if self.token_used >= self.token_budget:
            return False
        return True

    def get_phase_duration_ms(self) -> float:
        if self.phase_start_time:
            return (time.time() - self.phase_start_time) * 1000
        return 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "state_id": self.state_id,
            "current_phase": self.current_phase.value,
            "previous_phase": self.previous_phase.value,
            "cycle_count": self.cycle_count,
            "max_cycles": self.max_cycles,
            "current_task_id": self.current_task_id,
            "current_goal_id": self.current_goal_id,
            "token_used": self.token_used,
            "token_budget": self.token_budget,
            "error_count": self.error_count,
            "consecutive_errors": self.consecutive_errors,
            "success_count": self.success_count,
            "total_actions": self.total_actions,
            "is_running": self.is_running,
            "is_paused": self.is_paused,
            "should_stop": self.should_stop,
            "last_action": self.last_action[:200] if self.last_action else "",
            "last_error": self.last_error[:200] if self.last_error else "",
            "thoughts_count": len(self.thoughts),
            "observations_count": len(self.observations),
            "reflections_count": len(self.reflections),
            "phase_history_count": len(self.phase_history),
            "success_rate": round(self.success_count / max(self.total_actions, 1), 4),
        }

class Task:
    """Agent任务"""

    def __init__(self, description: str = "", task_type: str = "general",
                 priority: str = "medium", parent_id: str = ""):
        self.task_id = f"task_{uuid.uuid4().hex[:8]}"
        self.description = description
        self.task_type = task_type
        self.priority = priority
        self.parent_id = parent_id
        self.subtasks: List[str] = []
        self.status = TaskStatus.PENDING
        self.created_at = time.time()
        self.started_at = 0.0
        self.completed_at = 0.0
        self.duration_ms = 0.0
        self.progress = 0.0
        self.required_tools: List[str] = []
        self.required_memory: List[str] = []
        self.required_code: List[str] = []
        self.depends_on: List[str] = []
        self.result = ""
        self.error = ""
        self.attempts = 0
        self.max_attempts = 3
        self.metadata: Dict[str, Any] = {}

    def start(self):
        self.status = TaskStatus.IN_PROGRESS
        self.started_at = time.time()

    def complete(self, result: str = ""):
        self.status = TaskStatus.COMPLETED
        self.completed_at = time.time()
        self.duration_ms = (self.completed_at - self.started_at) * 1000 if self.started_at else 0
        self.progress = 1.0
        self.result = result

    def fail(self, error: str = ""):
        self.status = TaskStatus.FAILED
        self.completed_at = time.time()
        self.duration_ms = (self.completed_at - self.started_at) * 1000 if self.started_at else 0
        self.error = error
        self.attempts += 1

    def can_retry(self) -> bool:
        return self.attempts < self.max_attempts

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "description": self.description,
            "task_type": self.task_type,
            "priority": self.priority,
            "parent_id": self.parent_id,
            "subtasks_count": len(self.subtasks),
            "status": self.status.value,
            "progress": self.progress,
            "created_at": self.created_at,
            "duration_ms": round(self.duration_ms, 1),
            "required_tools": self.required_tools,
            "depends_on": self.depends_on,
            "attempts": self.attempts,
            "max_attempts": self.max_attempts,
            "result": self.result[:500] if self.result else "",
            "error": self.error[:500] if self.error else "",
        }

class Goal:
    """Agent目标"""

    def __init__(self, description: str = "", goal_type: str = "short_term",
                 parent_id: str = ""):
        self.goal_id = f"goal_{uuid.uuid4().hex[:8]}"
        self.description = description
        self.goal_type = goal_type
        self.parent_id = parent_id
        self.subgoals: List[str] = []
        self.tasks: List[str] = []
        self.status = TaskStatus.PENDING
        self.progress = 0.0
        self.created_at = time.time()
        self.completed_at = 0.0
        self.priority = "medium"
        self.success_criteria = ""
        self.metrics: Dict[str, Any] = {}
        self.metadata: Dict[str, Any] = {}

    def add_subgoal(self, subgoal_id: str):
        if subgoal_id not in self.subgoals:
            self.subgoals.append(subgoal_id)

    def add_task(self, task_id: str):
        if task_id not in self.tasks:
            self.tasks.append(task_id)

    def update_progress(self, progress: float):
        self.progress = max(0.0, min(1.0, progress))
        if self.progress >= 1.0:
            self.status = TaskStatus.COMPLETED
            self.completed_at = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "goal_id": self.goal_id,
            "description": self.description,
            "goal_type": self.goal_type,
            "parent_id": self.parent_id,
            "subgoals_count": len(self.subgoals),
            "tasks_count": len(self.tasks),
            "status": self.status.value,
            "progress": self.progress,
            "priority": self.priority,
            "success_criteria": self.success_criteria,
            "created_at": self.created_at,
        }

class CycleRecord:
    """单次循环记录"""

    def __init__(self, cycle_number: int = 0):
        self.record_id = f"cycle_{uuid.uuid4().hex[:8]}"
        self.cycle_number = cycle_number
        self.start_time = time.time()
        self.end_time = 0.0
        self.duration_ms = 0.0
        self.phases: List[Dict[str, Any]] = []
        self.thought = ""
        self.plan = ""
        self.decision = ""
        self.action = ""
        self.observation = ""
        self.reflection = ""
        self.learning = ""
        self.success = False
        self.error = ""
        self.token_used = 0
        self.metadata: Dict[str, Any] = {}

    def add_phase(self, phase: str, duration_ms: float, detail: str = ""):
        self.phases.append({
            "phase": phase,
            "duration_ms": round(duration_ms, 1),
            "detail": detail[:200],
            "timestamp": time.time(),
        })

    def complete(self, success: bool = True, error: str = ""):
        self.end_time = time.time()
        self.duration_ms = (self.end_time - self.start_time) * 1000
        self.success = success
        self.error = error

    def to_dict(self) -> Dict[str, Any]:
        return {
            "record_id": self.record_id,
            "cycle_number": self.cycle_number,
            "duration_ms": round(self.duration_ms, 1),
            "phases_count": len(self.phases),
            "phases": self.phases,
            "thought": self.thought[:300],
            "decision": self.decision[:300],
            "action": self.action[:300],
            "observation": self.observation[:300],
            "reflection": self.reflection[:300],
            "success": self.success,
            "error": self.error[:300],
            "token_used": self.token_used,
        }
