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



class ContextManager:
    """上下文管理器 - 聚合记忆/工具/代码/对话历史，智能裁剪到token预算"""

    def __init__(self, max_tokens: int = 8000):
        self.manager_id = f"ctx_{uuid.uuid4().hex[:8]}"
        self.max_tokens = max_tokens
        self.context_items: List[Dict[str, Any]] = []
        self.conversation_history: deque = deque(maxlen=50)
        self._lock = threading.RLock()

    def add_item(self, item_type: str, content: str,
                 relevance: float = 0.5, source: str = "",
                 metadata: Optional[Dict] = None):
        """添加上下文项"""
        with self._lock:
            item = {
                "item_id": f"ctx_{uuid.uuid4().hex[:6]}",
                "type": item_type,
                "content": content,
                "relevance": relevance,
                "source": source,
                "tokens": self._estimate_tokens(content),
                "timestamp": time.time(),
                "metadata": metadata or {},
            }
            self.context_items.append(item)
            # 按相关性排序
            self.context_items.sort(key=lambda x: x["relevance"], reverse=True)

    def add_conversation(self, role: str, content: str):
        """添加对话历史"""
        with self._lock:
            self.conversation_history.append({
                "role": role,
                "content": content,
                "tokens": self._estimate_tokens(content),
                "timestamp": time.time(),
            })

    def build_context(self, query: str = "",
                      include_types: Optional[List[str]] = None,
                      max_tokens: int = 0) -> Dict[str, Any]:
        """构建上下文，智能裁剪到token预算"""
        budget = max_tokens or self.max_tokens
        context = {
            "query": query,
            "system_prompt": "",
            "conversation": [],
            "memory": [],
            "tools": [],
            "code": [],
            "other": [],
            "total_tokens": 0,
            "truncated": False,
        }

        used_tokens = 0
        # 1. 对话历史（最近的优先）
        for msg in reversed(self.conversation_history):
            if used_tokens + msg["tokens"] > budget * 0.4:
                context["truncated"] = True
                break
            context["conversation"].append(msg)
            used_tokens += msg["tokens"]
        context["conversation"].reverse()

        # 2. 相关上下文项（按相关性排序）
        for item in self.context_items:
            if include_types and item["type"] not in include_types:
                continue
            if used_tokens + item["tokens"] > budget:
                context["truncated"] = True
                break
            item_type = item["type"]
            if item_type in context:
                context[item_type].append(item)
            else:
                context["other"].append(item)
            used_tokens += item["tokens"]

        context["total_tokens"] = used_tokens
        return context

    def get_relevant_items(self, query: str, limit: int = 10,
                            item_type: str = "") -> List[Dict[str, Any]]:
        """获取最相关的上下文项"""
        query_lower = query.lower()
        scored = []
        for item in self.context_items:
            if item_type and item["type"] != item_type:
                continue
            score = item["relevance"]
            # 关键词匹配加分
            content_lower = item["content"].lower()
            query_words = set(re.findall(r'[\u4e00-\u9fff]|[a-zA-Z0-9]+', query_lower))
            content_words = set(re.findall(r'[\u4e00-\u9fff]|[a-zA-Z0-9]+', content_lower))
            overlap = len(query_words & content_words)
            score += overlap * 0.1
            scored.append((item, score))
        scored.sort(key=lambda x: x[1], reverse=True)
        return [item for item, _ in scored[:limit]]

    def clear(self):
        with self._lock:
            self.context_items.clear()
            self.conversation_history.clear()

    def _estimate_tokens(self, text: str) -> int:
        """估算token数（中文1字≈1.5token，英文1词≈1.3token）"""
        if not text:
            return 0
        chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
        english_words = len(re.findall(r'[a-zA-Z0-9]+', text))
        return int(chinese_chars * 1.5 + english_words * 1.3)

    def get_stats(self) -> Dict[str, Any]:
        return {
            "manager_id": self.manager_id,
            "max_tokens": self.max_tokens,
            "context_items": len(self.context_items),
            "conversation_messages": len(self.conversation_history),
            "total_context_tokens": sum(i["tokens"] for i in self.context_items),
            "by_type": dict(Counter(i["type"] for i in self.context_items)),
        }
