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



class DecisionEngine:
    """决策引擎 - 根据状态和目标选择下一步行动，多策略"""

    def __init__(self, strategy: str = "adaptive"):
        self.engine_id = f"dec_{uuid.uuid4().hex[:8]}"
        self.strategy = DecisionStrategy(strategy)
        self.decision_history: deque = deque(maxlen=200)
        self.action_scores: Dict[str, float] = defaultdict(float)
        self._lock = threading.RLock()

    def decide(self, available_actions: List[Dict[str, Any]],
               context: Optional[Dict] = None) -> Dict[str, Any]:
        """选择下一步行动"""
        context = context or {}
        if not available_actions:
            return {"action": "wait", "reason": "无可用行动", "confidence": 0.0}

        # 评分
        scored_actions = []
        for action in available_actions:
            score = self._score_action(action, context)
            scored_actions.append((action, score))

        # 根据策略选择
        selected = self._select_by_strategy(scored_actions)
        selected["confidence"] = round(selected.get("_score", 0) / max(sum(s for _, s in scored_actions), 1), 4)
        selected.pop("_score", None)

        with self._lock:
            self.decision_history.append({
                "action": selected.get("action", ""),
                "strategy": self.strategy.value,
                "confidence": selected["confidence"],
                "alternatives": len(available_actions),
                "timestamp": time.time(),
            })
            self.action_scores[selected.get("action", "")] += 1

        return selected

    def _score_action(self, action: Dict[str, Any], context: Dict) -> float:
        """为行动评分"""
        score = 0.0
        # 基础分
        score += action.get("priority", 0.5)
        # 历史成功率
        action_name = action.get("action", "")
        if action_name in self.action_scores:
            score += min(self.action_scores[action_name] * 0.1, 2.0)
        # 上下文匹配
        if action.get("required_context"):
            for key in action["required_context"]:
                if key in context:
                    score += 0.5
        # 风险惩罚
        risk = action.get("risk", "low")
        risk_penalty = {"low": 0, "medium": 0.3, "high": 0.8, "critical": 1.5}
        score -= risk_penalty.get(risk, 0.3)
        # 预期收益
        score += action.get("expected_value", 0.5)
        return max(0.01, score)

    def _select_by_strategy(self, scored_actions: List[Tuple[Dict, float]]) -> Dict[str, Any]:
        """根据策略选择行动"""
        scored_actions.sort(key=lambda x: x[1], reverse=True)

        if self.strategy == DecisionStrategy.GREEDY:
            # 选最高分
            action, score = scored_actions[0]
            action["_score"] = score
            action["reason"] = "贪心策略：选择当前最高评分行动"
            return action

        elif self.strategy == DecisionStrategy.EXPLORATORY:
            # 随机选择（偏向高分但有探索性）
            import random
            if len(scored_actions) > 1 and random.random() < 0.3:
                idx = random.randint(0, min(2, len(scored_actions) - 1))
            else:
                idx = 0
            action, score = scored_actions[idx]
            action["_score"] = score
            action["reason"] = "探索策略：尝试新方法"
            return action

        elif self.strategy == DecisionStrategy.CONSERVATIVE:
            # 选风险最低的
            safe_actions = [(a, s) for a, s in scored_actions
                          if a.get("risk", "high") in ("low", "medium")]
            if safe_actions:
                action, score = safe_actions[0]
            else:
                action, score = scored_actions[-1]  # 风险最低的（分数最低）
            action["_score"] = score
            action["reason"] = "保守策略：选择最稳妥的行动"
            return action

        elif self.strategy == DecisionStrategy.AGGRESSIVE:
            # 选预期收益最高的
            scored_by_value = sorted(scored_actions,
                                     key=lambda x: x[0].get("expected_value", 0),
                                     reverse=True)
            action, score = scored_by_value[0]
            action["_score"] = score
            action["reason"] = "激进策略：选择最快路径"
            return action

        else:  # ADAPTIVE
            # 根据上下文自适应
            # 如果连续失败，切换到保守
            # 如果任务简单，用贪心
            action, score = scored_actions[0]
            action["_score"] = score
            action["reason"] = "自适应策略：根据当前状态动态选择"
            return action

    def set_strategy(self, strategy: str):
        self.strategy = DecisionStrategy(strategy)

    def get_decision_history(self, limit: int = 20) -> List[Dict]:
        return list(reversed(self.decision_history))[-limit:]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "engine_id": self.engine_id,
            "strategy": self.strategy.value,
            "total_decisions": len(self.decision_history),
            "action_distribution": dict(Counter(self.action_scores).most_common(10)),
        }
