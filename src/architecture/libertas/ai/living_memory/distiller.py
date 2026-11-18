"""活的记忆系统职责：distiller。"""

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


class ExperienceDistiller:
    """经验沉淀器 - 任务完成后自动提炼可复用经验"""

    def __init__(self, min_task_length: int = 10,
                 importance_threshold: float = 0.6,
                 auto_distill: bool = True):
        self.min_task_length = min_task_length
        self.importance_threshold = importance_threshold
        self.auto_distill = auto_distill
        self.task_history: deque = deque(maxlen=200)
        self.distilled_count = 0
        self._lock = threading.RLock()

    def record_task(self, task: str, steps: List[Dict],
                    result: str, success: bool,
                    tools_used: Optional[List[str]] = None,
                    duration_ms: float = 0.0,
                    metadata: Optional[Dict] = None) -> str:
        """记录任务执行"""
        task_record = {
            "task_id": f"task_{uuid.uuid4().hex[:8]}",
            "task": task,
            "steps": steps,
            "result": result,
            "success": success,
            "tools_used": tools_used or [],
            "duration_ms": duration_ms,
            "metadata": metadata or {},
            "timestamp": time.time(),
            "distilled": False,
        }
        with self._lock:
            self.task_history.append(task_record)
        return task_record["task_id"]

    def distill(self, task_id: str) -> Optional[Dict[str, Any]]:
        """从任务记录中提炼经验"""
        with self._lock:
            task_record = None
            for t in self.task_history:
                if t["task_id"] == task_id:
                    task_record = t
                    break
        if not task_record:
            return None

        # 评估经验重要性
        importance = self._evaluate_importance(task_record)
        if importance < self.importance_threshold:
            return None

        # 提炼经验
        experience = self._extract_experience(task_record, importance)
        task_record["distilled"] = True
        self.distilled_count += 1
        return experience

    def _evaluate_importance(self, task_record: Dict) -> float:
        """评估经验重要性"""
        score = 0.0
        # 任务复杂度
        if len(task_record["steps"]) > 3:
            score += 0.2
        if len(task_record["steps"]) > 5:
            score += 0.1
        # 使用了工具
        if task_record["tools_used"]:
            score += 0.15
        # 任务成功
        if task_record["success"]:
            score += 0.2
        else:
            score += 0.1  # 失败经验也有价值
        # 任务长度
        if len(task_record["task"]) > self.min_task_length:
            score += 0.1
        # 耗时
        if task_record["duration_ms"] > 10000:
            score += 0.1
        # 多步骤
        if len(task_record["steps"]) > 0:
            score += 0.05
        return min(1.0, score)

    def _extract_experience(self, task_record: Dict,
                            importance: float) -> Dict[str, Any]:
        """提取经验内容"""
        # 构建经验文本
        experience_text = self._build_experience_text(task_record)

        # 提取关键步骤
        key_steps = self._extract_key_steps(task_record)

        # 提取工具使用模式
        tool_patterns = self._extract_tool_patterns(task_record)

        # 提取教训
        lessons = self._extract_lessons(task_record)

        return {
            "experience_id": f"exp_{uuid.uuid4().hex[:8]}",
            "source_task_id": task_record["task_id"],
            "content": experience_text,
            "importance": round(importance, 4),
            "task": task_record["task"],
            "success": task_record["success"],
            "key_steps": key_steps,
            "tool_patterns": tool_patterns,
            "lessons": lessons,
            "tools_used": task_record["tools_used"],
            "duration_ms": task_record["duration_ms"],
            "timestamp": time.time(),
            "tags": self._generate_tags(task_record),
        }

    def _build_experience_text(self, task_record: Dict) -> str:
        """构建经验文本"""
        lines = [f"任务: {task_record['task']}"]
        lines.append(f"结果: {'成功' if task_record['success'] else '失败'}")
        if task_record["tools_used"]:
            lines.append(f"使用工具: {', '.join(task_record['tools_used'])}")
        if task_record["steps"]:
            lines.append("\n关键步骤:")
            for i, step in enumerate(task_record["steps"][:10], 1):
                action = step.get("action", step.get("description", ""))
                result = step.get("result", "")
                lines.append(f"  {i}. {action}")
                if result:
                    lines.append(f"     结果: {str(result)[:100]}")
        if task_record["result"]:
            lines.append(f"\n最终结果: {str(task_record['result'])[:300]}")
        return "\n".join(lines)

    def _extract_key_steps(self, task_record: Dict) -> List[Dict]:
        """提取关键步骤"""
        key_steps = []
        for step in task_record["steps"]:
            if step.get("success") is False:
                key_steps.append({
                    "action": step.get("action", ""),
                    "error": step.get("error", ""),
                    "type": "failure",
                })
            elif step.get("important"):
                key_steps.append({
                    "action": step.get("action", ""),
                    "result": str(step.get("result", ""))[:100],
                    "type": "important",
                })
        return key_steps[:10]

    def _extract_tool_patterns(self, task_record: Dict) -> List[Dict]:
        """提取工具使用模式"""
        patterns = []
        tools = task_record.get("tools_used", [])
        if len(tools) >= 2:
            patterns.append({
                "pattern": " -> ".join(tools),
                "count": 1,
                "description": f"工具组合: {', '.join(tools)}",
            })
        return patterns

    def _extract_lessons(self, task_record: Dict) -> List[str]:
        """提取教训"""
        lessons = []
        if not task_record["success"]:
            lessons.append("任务失败，需要分析失败原因并改进策略")
        for step in task_record["steps"]:
            if step.get("success") is False and step.get("error"):
                lessons.append(f"步骤失败: {step.get('action', '')} - {step.get('error', '')}")
        if len(task_record["steps"]) > 5:
            lessons.append("任务步骤较多，可以考虑拆分或优化流程")
        return lessons[:5]

    def _generate_tags(self, task_record: Dict) -> List[str]:
        """生成标签"""
        tags = []
        if task_record["success"]:
            tags.append("成功经验")
        else:
            tags.append("失败教训")
        for tool in task_record["tools_used"]:
            tags.append(f"工具:{tool}")
        if len(task_record["steps"]) > 3:
            tags.append("复杂任务")
        return tags[:10]

    def get_undistilled_tasks(self) -> List[Dict]:
        """获取未提炼的任务"""
        return [t for t in self.task_history if not t["distilled"]]

    def auto_distill_all(self) -> List[Dict]:
        """自动提炼所有未提炼的任务"""
        if not self.auto_distill:
            return []
        results = []
        for task in list(self.task_history):
            if not task["distilled"]:
                experience = self.distill(task["task_id"])
                if experience:
                    results.append(experience)
        return results

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_tasks_recorded": len(self.task_history),
            "distilled_count": self.distilled_count,
            "auto_distill": self.auto_distill,
            "importance_threshold": self.importance_threshold,
            "undistilled": sum(1 for t in self.task_history if not t["distilled"]),
            "success_rate": round(
                sum(1 for t in self.task_history if t["success"]) / max(len(self.task_history), 1), 4
            ),
        }
