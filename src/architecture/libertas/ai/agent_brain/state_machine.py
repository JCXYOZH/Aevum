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



class AgentStateMachine:
    """Agent状态机 - 管理七阶段循环的状态转换"""

    def __init__(self):
        self.machine_id = f"fsm_{uuid.uuid4().hex[:8]}"
        self.state = AgentState()
        self.transition_rules: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        self._lock = threading.RLock()
        self._init_default_rules()

    def _init_default_rules(self):
        """初始化默认状态转换规则"""
        # 正常循环流程
        self.add_rule("idle", "perceive", condition="有新任务输入")
        self.add_rule("idle", "plan", condition="直接开始规划")
        self.add_rule("perceive", "think", condition="感知完成")
        self.add_rule("think", "plan", condition="理解完成")
        self.add_rule("plan", "decide", condition="规划完成")
        self.add_rule("decide", "execute", condition="决策完成")
        self.add_rule("execute", "observe", condition="执行完成")
        self.add_rule("observe", "reflect", condition="观察完成")
        self.add_rule("reflect", "learn", condition="反思完成")
        self.add_rule("learn", "perceive", condition="学习完成，继续循环")
        self.add_rule("learn", "complete", condition="任务完成")
        self.add_rule("learn", "idle", condition="无更多任务")
        # 异常流程
        self.add_rule("*", "error", condition="发生不可恢复错误")
        self.add_rule("error", "perceive", condition="错误恢复")
        self.add_rule("*", "paused", condition="人工暂停")
        self.add_rule("paused", "perceive", condition="恢复运行")

    def add_rule(self, from_phase: str, to_phase: str, condition: str = "",
                 action: str = "", priority: int = 0):
        """添加状态转换规则"""
        with self._lock:
            self.transition_rules[from_phase].append({
                "from": from_phase,
                "to": to_phase,
                "condition": condition,
                "action": action,
                "priority": priority,
                "created_at": time.time(),
            })

    def can_transition(self, from_phase: str, to_phase: str) -> bool:
        """检查是否可以转换"""
        rules = self.transition_rules.get(from_phase, [])
        rules.extend(self.transition_rules.get("*", []))
        for rule in rules:
            if rule["to"] == to_phase:
                return True
        return False

    def transition(self, to_phase: AgentPhase) -> bool:
        """执行状态转换"""
        with self._lock:
            from_phase = self.state.current_phase.value
            # 如果已经是目标状态，直接返回成功
            if from_phase == to_phase.value:
                return True
            if self.can_transition(from_phase, to_phase.value):
                self.state.transition_to(to_phase)
                return True
            terminal.warn(f"非法状态转换: {from_phase} -> {to_phase.value}", "state_machine")
            return False

    def get_current_phase(self) -> AgentPhase:
        return self.state.current_phase

    def get_valid_transitions(self) -> List[str]:
        """获取当前状态可转换的目标状态"""
        from_phase = self.state.current_phase.value
        targets = set()
        for rule in self.transition_rules.get(from_phase, []):
            targets.add(rule["to"])
        for rule in self.transition_rules.get("*", []):
            targets.add(rule["to"])
        return list(targets)

    def get_state(self) -> AgentState:
        return self.state

    def reset(self):
        """重置状态机"""
        with self._lock:
            self.state = AgentState()

    def get_stats(self) -> Dict[str, Any]:
        return {
            "machine_id": self.machine_id,
            "current_phase": self.state.current_phase.value,
            "cycle_count": self.state.cycle_count,
            "total_rules": sum(len(r) for r in self.transition_rules.values()),
            "phase_history": list(self.state.phase_history)[-10:],
        }
