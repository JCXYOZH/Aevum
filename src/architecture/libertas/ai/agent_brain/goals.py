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



class GoalManager:
    """目标管理 - 长期/短期/子目标层级管理，进度追踪"""

    def __init__(self):
        self.manager_id = f"goal_{uuid.uuid4().hex[:8]}"
        self.goals: Dict[str, Goal] = {}
        self.active_goal_id = ""
        self._lock = threading.RLock()

    def create_goal(self, description: str, goal_type: str = "short_term",
                    parent_id: str = "", priority: str = "medium",
                    success_criteria: str = "") -> Goal:
        """创建目标"""
        goal = Goal(description, goal_type, parent_id)
        goal.priority = priority
        goal.success_criteria = success_criteria
        with self._lock:
            self.goals[goal.goal_id] = goal
            if parent_id and parent_id in self.goals:
                self.goals[parent_id].add_subgoal(goal.goal_id)
        return goal

    def set_active_goal(self, goal_id: str) -> bool:
        if goal_id in self.goals:
            self.active_goal_id = goal_id
            return True
        return False

    def get_active_goal(self) -> Optional[Goal]:
        return self.goals.get(self.active_goal_id)

    def add_task_to_goal(self, goal_id: str, task_id: str) -> bool:
        goal = self.goals.get(goal_id)
        if goal:
            goal.add_task(task_id)
            return True
        return False

    def update_goal_progress(self, goal_id: str, progress: float) -> bool:
        goal = self.goals.get(goal_id)
        if goal:
            goal.update_progress(progress)
            # 更新父目标进度
            if goal.parent_id and goal.parent_id in self.goals:
                parent = self.goals[goal.parent_id]
                subgoals = [self.goals.get(sg) for sg in parent.subgoals if sg in self.goals]
                if subgoals:
                    avg_progress = sum(sg.progress for sg in subgoals) / len(subgoals)
                    parent.update_progress(avg_progress)
            return True
        return False

    def get_goal_tree(self, goal_id: str = "", depth: int = 3) -> Dict[str, Any]:
        """获取目标树"""
        if not goal_id:
            goal_id = self.active_goal_id
        goal = self.goals.get(goal_id)
        if not goal:
            return {}

        tree = goal.to_dict()
        tree["subgoals"] = []
        if depth > 0:
            for sg_id in goal.subgoals:
                sub_tree = self.get_goal_tree(sg_id, depth - 1)
                if sub_tree:
                    tree["subgoals"].append(sub_tree)
        return tree

    def get_goals_by_type(self, goal_type: str) -> List[Goal]:
        return [g for g in self.goals.values() if g.goal_type == goal_type]

    def get_pending_goals(self) -> List[Goal]:
        return [g for g in self.goals.values() if g.status == TaskStatus.PENDING]

    def get_in_progress_goals(self) -> List[Goal]:
        return [g for g in self.goals.values() if g.status == TaskStatus.IN_PROGRESS]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "manager_id": self.manager_id,
            "total_goals": len(self.goals),
            "active_goal": self.active_goal_id,
            "by_type": dict(Counter(g.goal_type for g in self.goals.values())),
            "by_status": dict(Counter(g.status.value for g in self.goals.values())),
            "pending": len(self.get_pending_goals()),
            "in_progress": len(self.get_in_progress_goals()),
            "completed": len([g for g in self.goals.values() if g.status == TaskStatus.COMPLETED]),
        }
