"""能力增强职责：brain。"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
import time
import uuid
from collections import OrderedDict, defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from libertas.foundation.byte_stream import safe_decode


class BrainEnhancer:
    """Agent大脑增强器

    - 多轮对话状态管理
    - 任务动态优先级
    - 失败回退策略
    - 上下文窗口管理
    - 决策日志
    """

    def __init__(self):
        self.conversation_state: Dict[str, Dict] = {}
        self.task_priorities: Dict[str, float] = {}
        self.fallback_history: List[Dict] = []
        self.decision_log: List[Dict] = []
        self.context_window: List[Dict] = []
        self.max_context_size = 32000  # token估算

    def manage_state(self, conversation_id: str, message: str,
                     role: str = "user") -> Dict:
        """管理对话状态"""
        if conversation_id not in self.conversation_state:
            self.conversation_state[conversation_id] = {
                "turn_count": 0,
                "messages": [],
                "intent_history": [],
                "last_activity": time.time(),
                "context_summary": "",
            }

        state = self.conversation_state[conversation_id]
        state["turn_count"] += 1
        state["messages"].append({"role": role, "content": message[:500], "timestamp": time.time()})
        state["last_activity"] = time.time()

        # 限制消息历史
        if len(state["messages"]) > 50:
            state["messages"] = state["messages"][-50:]

        return {
            "conversation_id": conversation_id,
            "turn_count": state["turn_count"],
            "message_count": len(state["messages"]),
            "last_activity": state["last_activity"],
        }

    def prioritize_task(self, task_id: str, task: Dict) -> float:
        """动态任务优先级评分（0-100）"""
        score = 50.0  # 默认中等

        # 紧急程度
        if task.get("urgent"):
            score += 30
        if task.get("deadline"):
            deadline = task["deadline"]
            if isinstance(deadline, (int, float)):
                hours_left = (deadline - time.time()) / 3600
                if hours_left < 1:
                    score += 30
                elif hours_left < 24:
                    score += 15

        # 影响范围
        impact = task.get("impact", "normal")
        if impact == "critical":
            score += 20
        elif impact == "high":
            score += 10

        # 用户明确要求
        if task.get("user_requested"):
            score += 15

        # 依赖关系（被其他任务依赖的优先）
        if task.get("blocking_others"):
            score += 10

        score = min(100, max(0, score))
        self.task_priorities[task_id] = score
        return score

    def get_prioritized_tasks(self) -> List[Tuple[str, float]]:
        """获取按优先级排序的任务"""
        return sorted(self.task_priorities.items(), key=lambda x: x[1], reverse=True)

    def fallback(self, task_id: str, error: str,
                 attempt: int = 1) -> Dict:
        """失败回退策略"""
        strategies = [
            {"strategy": "retry", "description": "直接重试", "max_attempts": 3},
            {"strategy": "simplify", "description": "简化任务要求", "max_attempts": 2},
            {"strategy": "alternative_tool", "description": "换用替代工具", "max_attempts": 2},
            {"strategy": "split_task", "description": "拆分为子任务", "max_attempts": 1},
            {"strategy": "ask_user", "description": "请求用户介入", "max_attempts": 1},
            {"strategy": "skip_and_log", "description": "跳过并记录", "max_attempts": 1},
        ]

        current_strategy = None
        for s in strategies:
            if attempt <= s["max_attempts"]:
                current_strategy = s
                break

        if not current_strategy:
            current_strategy = strategies[-1]

        fallback_record = {
            "task_id": task_id,
            "error": error,
            "attempt": attempt,
            "strategy": current_strategy["strategy"],
            "description": current_strategy["description"],
            "timestamp": time.time(),
        }
        self.fallback_history.append(fallback_record)
        return fallback_record

    def manage_context(self, new_content: str, estimated_tokens: int = 0) -> Dict:
        """管理上下文窗口"""
        if estimated_tokens == 0:
            estimated_tokens = len(new_content) // 4  # 粗略估算

        self.context_window.append({
            "content": new_content[:1000],
            "tokens": estimated_tokens,
            "timestamp": time.time(),
        })

        # 超出窗口时压缩旧内容
        total_tokens = sum(c["tokens"] for c in self.context_window)
        removed = 0
        while total_tokens > self.max_context_size and len(self.context_window) > 1:
            old = self.context_window.pop(0)
            total_tokens -= old["tokens"]
            removed += 1

        return {
            "current_tokens": total_tokens,
            "max_tokens": self.max_context_size,
            "context_items": len(self.context_window),
            "removed_items": removed,
        }

    def log_decision(self, decision: str, reasoning: str,
                     outcome: str = "pending") -> Dict:
        """记录决策日志"""
        record = {
            "decision_id": f"dec_{uuid.uuid4().hex[:8]}",
            "decision": decision,
            "reasoning": reasoning,
            "outcome": outcome,
            "timestamp": time.time(),
        }
        self.decision_log.append(record)
        return record

    def get_statistics(self) -> Dict:
        return {
            "active_conversations": len(self.conversation_state),
            "total_turns": sum(s["turn_count"] for s in self.conversation_state.values()),
            "prioritized_tasks": len(self.task_priorities),
            "fallback_count": len(self.fallback_history),
            "decision_count": len(self.decision_log),
            "context_items": len(self.context_window),
        }
