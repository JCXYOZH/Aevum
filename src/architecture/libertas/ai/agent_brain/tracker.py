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



class GoalTracker:
    """目标追踪器 - 管理和追踪Agent的长期目标与子目标"""

    def __init__(self):
        self.goals: Dict[str, Dict[str, Any]] = {}
        self.active_goal_id: Optional[str] = None
        self.goal_history: List[Dict[str, Any]] = []

    def create_goal(self, description: str, priority: int = 5,
                    deadline: Optional[float] = None,
                    sub_goals: List[str] = None) -> Dict[str, Any]:
        """创建新目标"""
        goal_id = f"goal_{uuid.uuid4().hex[:8]}"
        goal = {
            "goal_id": goal_id,
            "description": description,
            "priority": priority,
            "status": "active",
            "progress": 0.0,
            "created_at": time.time(),
            "deadline": deadline,
            "sub_goals": [
                {"description": sg, "status": "pending", "progress": 0.0}
                for sg in (sub_goals or [])
            ],
            "milestones": [],
            "blockers": [],
        }
        self.goals[goal_id] = goal
        if not self.active_goal_id:
            self.active_goal_id = goal_id
        return goal

    def update_goal_progress(self, goal_id: str, progress: float,
                              milestone: str = "") -> Dict[str, Any]:
        """更新目标进度"""
        goal = self.goals.get(goal_id)
        if not goal:
            return {"success": False, "error": "目标不存在"}
        goal["progress"] = min(1.0, max(0.0, progress))
        if milestone:
            goal["milestones"].append({
                "description": milestone,
                "timestamp": time.time(),
                "progress_at_milestone": goal["progress"],
            })
        if goal["progress"] >= 1.0:
            goal["status"] = "completed"
            goal["completed_at"] = time.time()
            self.goal_history.append(goal)
        return {"success": True, "goal_id": goal_id, "progress": goal["progress"], "status": goal["status"]}

    def update_sub_goal(self, goal_id: str, sub_goal_index: int,
                         status: str, progress: float = 0.0) -> Dict[str, Any]:
        """更新子目标状态"""
        goal = self.goals.get(goal_id)
        if not goal or sub_goal_index >= len(goal["sub_goals"]):
            return {"success": False, "error": "目标或子目标不存在"}
        sg = goal["sub_goals"][sub_goal_index]
        sg["status"] = status
        sg["progress"] = min(1.0, max(0.0, progress))
        sg["updated_at"] = time.time()
        # 重新计算总进度
        if goal["sub_goals"]:
            avg_progress = sum(s["progress"] for s in goal["sub_goals"]) / len(goal["sub_goals"])
            goal["progress"] = avg_progress
        return {"success": True, "sub_goal": sg, "total_progress": goal["progress"]}

    def add_blocker(self, goal_id: str, blocker: str) -> Dict[str, Any]:
        """添加目标阻塞项"""
        goal = self.goals.get(goal_id)
        if not goal:
            return {"success": False, "error": "目标不存在"}
        goal["blockers"].append({
            "description": blocker,
            "reported_at": time.time(),
            "resolved": False,
        })
        goal["status"] = "blocked"
        return {"success": True, "blocker": blocker, "active_blockers": len(goal["blockers"])}

    def resolve_blocker(self, goal_id: str, blocker_index: int) -> Dict[str, Any]:
        """解决阻塞项"""
        goal = self.goals.get(goal_id)
        if not goal or blocker_index >= len(goal["blockers"]):
            return {"success": False, "error": "目标或阻塞项不存在"}
        goal["blockers"][blocker_index]["resolved"] = True
        goal["blockers"][blocker_index]["resolved_at"] = time.time()
        if all(b["resolved"] for b in goal["blockers"]):
            goal["status"] = "active"
        return {"success": True, "remaining_blockers": sum(1 for b in goal["blockers"] if not b["resolved"])}

    def get_active_goals(self) -> List[Dict[str, Any]]:
        """获取所有活跃目标"""
        return [g for g in self.goals.values() if g["status"] in ("active", "blocked")]

    def get_goal_stats(self) -> Dict[str, Any]:
        """获取目标统计"""
        total = len(self.goals) + len(self.goal_history)
        active = len(self.get_active_goals())
        completed = len(self.goal_history)
        avg_progress = sum(g["progress"] for g in self.goals.values()) / len(self.goals) if self.goals else 0
        return {
            "total_goals": total,
            "active": active,
            "completed": completed,
            "blocked": sum(1 for g in self.goals.values() if g["status"] == "blocked"),
            "average_progress": avg_progress,
            "active_goal_id": self.active_goal_id,
        }
