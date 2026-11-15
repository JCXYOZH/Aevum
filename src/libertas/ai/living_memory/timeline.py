"""活的记忆系统职责：timeline。"""

from __future__ import annotations

import hashlib
import json
import math
import os
import pickle
import re
import threading
import time
import uuid
from collections import Counter, defaultdict, deque
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from libertas.foundation.terminal import terminal
from .core import LivingMemory


class MemoryTimeline:
    """记忆时间线 - 按时间维度组织、查询、可视化记忆"""

    def __init__(self, memory: "LivingMemory"):
        self.memory = memory

    def get_timeline(self, start_time: float = 0, end_time: float = 0,
                     memory_type: str = "", limit: int = 100) -> List[Dict]:
        """获取时间线范围内的记忆"""
        all_memories = []
        if hasattr(self.memory, 'memories'):
            all_memories = list(self.memory.memories.values()) if isinstance(self.memory.memories, dict) else self.memory.memories
        result = []
        for mem in all_memories:
            created = mem.get("created_at", 0) if isinstance(mem, dict) else getattr(mem, "created_at", 0)
            if start_time and created < start_time:
                continue
            if end_time and created > end_time:
                continue
            mtype = mem.get("memory_type", "") if isinstance(mem, dict) else getattr(mem, "memory_type", "")
            if memory_type and mtype != memory_type:
                continue
            result.append({
                "memory_id": mem.get("memory_id", "") if isinstance(mem, dict) else getattr(mem, "memory_id", ""),
                "content": mem.get("content", "")[:200] if isinstance(mem, dict) else getattr(mem, "content", "")[:200],
                "memory_type": mtype,
                "created_at": created,
                "created_at_str": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(created)) if created else "",
                "activation_count": mem.get("activation_count", 0) if isinstance(mem, dict) else getattr(mem, "activation_count", 0),
                "tags": mem.get("tags", []) if isinstance(mem, dict) else getattr(mem, "tags", []),
            })
        result.sort(key=lambda x: x["created_at"])
        return result[:limit]

    def get_today_memories(self) -> List[Dict]:
        """获取今天的记忆"""
        today_start = time.time() - 86400
        return self.get_timeline(start_time=today_start)

    def get_week_memories(self) -> List[Dict]:
        """获取本周的记忆"""
        week_start = time.time() - 86400 * 7
        return self.get_timeline(start_time=week_start)

    def get_memory_by_date(self, date_str: str) -> List[Dict]:
        """按日期获取记忆 (格式: YYYY-MM-DD)"""
        try:
            start = time.mktime(time.strptime(date_str, "%Y-%m-%d"))
            end = start + 86400
            return self.get_timeline(start_time=start, end_time=end)
        except Exception:
            return []

    def get_daily_stats(self, days: int = 30) -> List[Dict]:
        """获取每日记忆统计"""
        stats = []
        now = time.time()
        for i in range(days):
            day_start = now - (days - i) * 86400
            day_end = day_start + 86400
            day_memories = self.get_timeline(start_time=day_start, end_time=day_end)
            stats.append({
                "date": time.strftime("%Y-%m-%d", time.localtime(day_start)),
                "count": len(day_memories),
                "types": self._count_types(day_memories),
            })
        return stats

    def _count_types(self, memories: List[Dict]) -> Dict[str, int]:
        """统计记忆类型分布"""
        types = {}
        for mem in memories:
            t = mem.get("memory_type", "unknown")
            types[t] = types.get(t, 0) + 1
        return types

    def generate_timeline_report(self, days: int = 7) -> str:
        """生成时间线报告（Markdown格式）"""
        stats = self.get_daily_stats(days)
        lines = ["# 记忆时间线报告", ""]
        lines.append(f"## 最近{days}天统计")
        lines.append("")
        lines.append("| 日期 | 记忆数 | 主要类型 |")
        lines.append("|------|--------|----------|")
        total = 0
        for s in stats:
            total += s["count"]
            main_type = max(s["types"].items(), key=lambda x: x[1])[0] if s["types"] else "-"
            lines.append(f"| {s['date']} | {s['count']} | {main_type} |")
        lines.append("")
        lines.append(f"**总计**: {total} 条记忆")
        return "\n".join(lines)

class MemoryReplay:
    """记忆回放 - 根据当前场景检索并按重要性排序回放相关记忆"""

    def __init__(self, memory: "LivingMemory"):
        self.memory = memory
        self.replay_history: List[Dict[str, Any]] = []

    def replay(self, context: str, limit: int = 10,
               memory_type: str = "", min_activation: float = 0.0) -> List[Dict]:
        """根据上下文回放相关记忆"""
        # 1. 检索相关记忆
        results = []
        if hasattr(self.memory, 'search'):
            try:
                results = self.memory.search(context, limit=limit * 2)
            except Exception:
                results = []
        # 2. 过滤和排序
        filtered = []
        for mem in results:
            mtype = mem.get("memory_type", "") if isinstance(mem, dict) else getattr(mem, "memory_type", "")
            if memory_type and mtype != memory_type:
                continue
            activation = mem.get("current_activation", 0.5) if isinstance(mem, dict) else getattr(mem, "current_activation", 0.5)
            if activation < min_activation:
                continue
            relevance = mem.get("relevance", 0.5) if isinstance(mem, dict) else 0.5
            # 综合评分 = 相关度 * 0.6 + 激活度 * 0.4
            score = relevance * 0.6 + activation * 0.4
            filtered.append({
                "memory": mem,
                "relevance": relevance,
                "activation": activation,
                "replay_score": score,
            })
        filtered.sort(key=lambda x: -x["replay_score"])
        # 3. 记录回放历史
        self.replay_history.append({
            "context": context,
            "timestamp": time.time(),
            "results_count": len(filtered[:limit]),
        })
        return filtered[:limit]

    def replay_for_decision(self, decision_context: str) -> Dict[str, Any]:
        """为决策回放记忆（返回成功经验和失败教训）"""
        # 回放成功经验
        successes = self.replay(f"成功经验 {decision_context}", limit=5)
        # 回放失败教训
        failures = self.replay(f"失败教训 {decision_context}", limit=5)
        # 回放相关知识
        knowledge = self.replay(f"知识 {decision_context}", limit=5, memory_type="knowledge")
        return {
            "success_experiences": successes,
            "failure_lessons": failures,
            "related_knowledge": knowledge,
            "recommendation": self._generate_recommendation(successes, failures),
        }

    def _generate_recommendation(self, successes: List, failures: List) -> str:
        """基于回放记忆生成建议"""
        if not successes and not failures:
            return "无相关历史记忆，建议谨慎决策并记录经验"
        if successes and not failures:
            return "有成功经验可参考，建议沿用成功策略"
        if failures and not successes:
            return "有失败教训需注意，建议避免重蹈覆辙"
        return f"有{len(successes)}条成功经验和{len(failures)}条失败教训，建议综合参考"

    def get_replay_stats(self) -> Dict[str, Any]:
        """获取回放统计"""
        if not self.replay_history:
            return {"total_replays": 0}
        return {
            "total_replays": len(self.replay_history),
            "last_replay": self.replay_history[-1],
            "avg_results": sum(r["results_count"] for r in self.replay_history) / len(self.replay_history),
        }
