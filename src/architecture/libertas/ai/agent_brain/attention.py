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



class AttentionMechanism:
    """注意力机制 - 在大量信息中聚焦相关内容"""

    def __init__(self):
        self.attention_id = f"att_{uuid.uuid4().hex[:8]}"
        self.attention_weights: Dict[str, float] = defaultdict(float)
        self.focus_history: deque = deque(maxlen=100)
        self._lock = threading.RLock()

    def focus(self, query: str, candidates: List[Dict[str, Any]],
              limit: int = 10, attention_type: str = "semantic") -> List[Dict[str, Any]]:
        """聚焦最相关的候选内容"""
        if not candidates:
            return []

        # 计算注意力分数
        scored = []
        for candidate in candidates:
            score = self._compute_attention_score(query, candidate, attention_type)
            candidate["_attention_score"] = score
            scored.append(candidate)

        # 归一化（softmax）
        scores = [c["_attention_score"] for c in scored]
        max_score = max(scores) if scores else 1
        exp_scores = [math.exp(s - max_score) for s in scores]
        total = sum(exp_scores) or 1
        for i, candidate in enumerate(scored):
            candidate["_attention_weight"] = round(exp_scores[i] / total, 4)

        # 排序并返回top-k
        scored.sort(key=lambda x: x["_attention_score"], reverse=True)
        result = scored[:limit]

        with self._lock:
            self.focus_history.append({
                "query": query[:100],
                "candidates": len(candidates),
                "selected": len(result),
                "top_score": result[0]["_attention_score"] if result else 0,
                "timestamp": time.time(),
            })
            # 更新注意力权重
            for item in result:
                key = item.get("id", item.get("name", str(id(item))))
                self.attention_weights[key] += item["_attention_weight"]

        return result

    def _compute_attention_score(self, query: str, candidate: Dict[str, Any],
                                  attention_type: str) -> float:
        """计算注意力分数"""
        score = 0.0
        query_lower = query.lower()

        if attention_type == "semantic":
            # 语义注意力：关键词重叠 + 内容相关性
            content = str(candidate.get("content", candidate.get("description", ""))).lower()
            query_words = set(re.findall(r'[\u4e00-\u9fff]|[a-zA-Z0-9]+', query_lower))
            content_words = set(re.findall(r'[\u4e00-\u9fff]|[a-zA-Z0-9]+', content))
            overlap = len(query_words & content_words)
            score = overlap * 2.0
            # 完整短语匹配加分
            if query_lower in content:
                score += 5.0

        elif attention_type == "recency":
            # 时间注意力：越新分数越高
            timestamp = candidate.get("timestamp", time.time())
            age = time.time() - timestamp
            score = max(0, 10 - age / 3600)  # 1小时内满分，之后递减

        elif attention_type == "frequency":
            # 频率注意力：出现次数越多分数越高
            key = candidate.get("id", candidate.get("name", ""))
            score = self.attention_weights.get(key, 0.0)

        elif attention_type == "priority":
            # 优先级注意力
            priority = candidate.get("priority", "medium")
            priority_scores = {"critical": 10, "high": 7, "medium": 5, "low": 2}
            score = priority_scores.get(priority, 5)

        else:  # combined
            score = (self._compute_attention_score(query, candidate, "semantic") * 0.5 +
                    self._compute_attention_score(query, candidate, "recency") * 0.2 +
                    self._compute_attention_score(query, candidate, "frequency") * 0.15 +
                    self._compute_attention_score(query, candidate, "priority") * 0.15)

        # 基础相关性
        score += candidate.get("relevance", 0.5) * 3
        return score

    def get_attention_weights(self, limit: int = 20) -> List[Tuple[str, float]]:
        return sorted(self.attention_weights.items(), key=lambda x: x[1], reverse=True)[:limit]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "attention_id": self.attention_id,
            "focus_count": len(self.focus_history),
            "tracked_items": len(self.attention_weights),
            "top_focused": self.get_attention_weights(10),
        }
