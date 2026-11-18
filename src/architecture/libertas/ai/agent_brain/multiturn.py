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



class MultiTurnContext:
    """多轮上下文管理器 - 管理对话历史、上下文窗口、关键信息提取"""

    def __init__(self, max_turns: int = 20, max_tokens: int = 8000):
        self.turns = []
        self.max_turns = max_turns
        self.max_tokens = max_tokens
        self.key_info = {}
        self.entities = set()
        self.topics = []

    def add_turn(self, role: str, content: str, metadata: Dict = None):
        """添加一轮对话"""
        turn = {
            "turn_id": len(self.turns) + 1,
            "role": role,
            "content": content,
            "metadata": metadata or {},
            "timestamp": time.time(),
            "tokens": self._estimate_tokens(content),
        }
        self.turns.append(turn)
        # 提取关键信息
        self._extract_key_info(turn)
        # 控制上下文窗口
        self._truncate()
        return turn

    def _estimate_tokens(self, text: str) -> int:
        """估算token数（中文约1.5字/token，英文约4字符/token）"""
        return max(1, len(text) // 3)

    def _extract_key_info(self, turn: Dict):
        """从对话中提取关键信息"""
        content = turn["content"]
        # 简单实体提取（数字、URL、IP等）
        import re
        # IP地址
        ips = re.findall(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', content)
        for ip in ips:
            self.entities.add(f"ip:{ip}")
        # URL
        urls = re.findall(r'https?://\S+', content)
        for url in urls:
            self.entities.add(f"url:{url}")
        # 域名
        domains = re.findall(r'\b[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\b', content)
        for domain in domains:
            self.entities.add(f"domain:{domain}")

    def _truncate(self):
        """截断上下文，保持在窗口内"""
        # 按轮数截断
        while len(self.turns) > self.max_turns:
            self.turns.pop(0)
        # 按token数截断
        total_tokens = sum(t["tokens"] for t in self.turns)
        while total_tokens > self.max_tokens and len(self.turns) > 2:
            removed = self.turns.pop(0)
            total_tokens -= removed["tokens"]

    def get_context(self, include_turns: int = 0) -> List[Dict]:
        """获取上下文"""
        if include_turns > 0:
            return self.turns[-include_turns:]
        return list(self.turns)

    def get_context_text(self, include_turns: int = 0) -> str:
        """获取文本格式的上下文"""
        turns = self.get_context(include_turns)
        return "\n".join(f"[{t['role']}]: {t['content']}" for t in turns)

    def get_entities(self) -> List[str]:
        """获取提取的实体"""
        return list(self.entities)

    def get_summary(self) -> Dict:
        """获取上下文摘要"""
        return {
            "total_turns": len(self.turns),
            "total_tokens": sum(t["tokens"] for t in self.turns),
            "entities": list(self.entities),
            "first_turn_time": self.turns[0]["timestamp"] if self.turns else None,
            "last_turn_time": self.turns[-1]["timestamp"] if self.turns else None,
            "roles": list(set(t["role"] for t in self.turns)),
        }

    def clear(self):
        """清空上下文"""
        self.turns.clear()
        self.entities.clear()
        self.key_info.clear()

    def search_context(self, query: str, limit: int = 5) -> List[Dict]:
        """在上下文中搜索相关轮次"""
        results = []
        query_words = set(query.lower().split())
        for turn in self.turns:
            turn_words = set(turn["content"].lower().split())
            overlap = len(query_words & turn_words)
            if overlap > 0:
                results.append({"turn": turn, "relevance": overlap})
        results.sort(key=lambda x: -x["relevance"])
        return results[:limit]
