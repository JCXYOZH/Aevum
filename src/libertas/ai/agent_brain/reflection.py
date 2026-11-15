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



class ReflectionLearner:
    """反思与学习 - 执行后反思，从成功/失败中学习，更新策略"""

    def __init__(self):
        self.learner_id = f"learn_{uuid.uuid4().hex[:8]}"
        self.reflections: deque = deque(maxlen=500)
        self.lessons: Dict[str, Dict[str, Any]] = {}
        self.strategy_adjustments: List[Dict[str, Any]] = []
        self.success_patterns: Counter = Counter()
        self.failure_patterns: Counter = Counter()
        self._lock = threading.RLock()

    def reflect(self, action: str, result: str, success: bool,
                context: Optional[Dict] = None) -> Dict[str, Any]:
        """执行后反思"""
        context = context or {}
        reflection = {
            "reflection_id": f"ref_{uuid.uuid4().hex[:8]}",
            "action": action,
            "result": result[:500],
            "success": success,
            "context_summary": {k: str(v)[:100] for k, v in list(context.items())[:10]},
            "timestamp": time.time(),
            "analysis": "",
            "lesson": "",
            "adjustment": "",
        }

        # 分析成功/失败原因
        if success:
            reflection["analysis"] = self._analyze_success(action, context)
            reflection["lesson"] = self._extract_lesson(action, True, context)
            self.success_patterns[action] += 1
        else:
            reflection["analysis"] = self._analyze_failure(action, result, context)
            reflection["lesson"] = self._extract_lesson(action, False, context)
            self.failure_patterns[action] += 1
            # 策略调整建议
            reflection["adjustment"] = self._suggest_adjustment(action, result, context)

        # 保存经验教训
        if reflection["lesson"]:
            lesson_key = hashlib.md5(f"{action}_{success}".encode()).hexdigest()[:12]
            with self._lock:
                self.lessons[lesson_key] = {
                    "action": action,
                    "success": success,
                    "lesson": reflection["lesson"],
                    "context": reflection["context_summary"],
                    "timestamp": time.time(),
                    "usage_count": 0,
                }

        with self._lock:
            self.reflections.append(reflection)

        return reflection

    def _analyze_success(self, action: str, context: Dict) -> str:
        """分析成功原因"""
        reasons = []
        if context.get("planning_quality") == "good":
            reasons.append("规划质量高，任务分解合理")
        if context.get("tool_choice") == "appropriate":
            reasons.append("工具选择恰当")
        if context.get("error_handling") == "effective":
            reasons.append("错误处理有效")
        if not reasons:
            reasons.append("执行流程顺畅，未遇到重大障碍")
        return "; ".join(reasons)

    def _analyze_failure(self, action: str, result: str, context: Dict) -> str:
        """分析失败原因"""
        reasons = []
        result_lower = result.lower()
        if "timeout" in result_lower or "超时" in result:
            reasons.append("执行超时，可能需要优化效率或增加超时时间")
        if "permission" in result_lower or "权限" in result:
            reasons.append("权限不足，需要提升权限或选择替代方案")
        if "not found" in result_lower or "不存在" in result:
            reasons.append("目标不存在，需要先验证目标有效性")
        if "syntax" in result_lower or "语法" in result:
            reasons.append("语法错误，需要加强代码质量检查")
        if "dependency" in result_lower or "依赖" in result:
            reasons.append("依赖缺失，需要先安装依赖")
        if not reasons:
            reasons.append("未知原因，需要更详细的错误分析")
        return "; ".join(reasons)

    def _extract_lesson(self, action: str, success: bool, context: Dict) -> str:
        """提取经验教训"""
        if success:
            return f"行动'{action}'成功，可复用此方法。关键成功因素：规划清晰、工具恰当、及时验证。"
        else:
            return f"行动'{action}'失败，需改进。建议：增加前置验证、准备备选方案、加强错误处理。"

    def _suggest_adjustment(self, action: str, result: str, context: Dict) -> str:
        """建议策略调整"""
        result_lower = result.lower()
        if "timeout" in result_lower:
            return "增加超时时间或优化执行效率，考虑拆分大任务"
        if "permission" in result_lower:
            return "检查权限配置，或选择不需要高权限的替代方案"
        if "not found" in result_lower:
            return "增加目标验证步骤，确保目标存在后再执行"
        if "syntax" in result_lower:
            return "执行前增加语法检查步骤，使用更严格的代码生成"
        return "回顾执行流程，识别瓶颈环节，准备备选方案"

    def get_lessons(self, action: str = "", success: Optional[bool] = None,
                    limit: int = 20) -> List[Dict[str, Any]]:
        """获取经验教训"""
        lessons = list(self.lessons.values())
        if action:
            lessons = [l for l in lessons if action in l["action"]]
        if success is not None:
            lessons = [l for l in lessons if l["success"] == success]
        return lessons[:limit]

    def get_success_rate(self, action: str = "") -> float:
        """获取行动成功率"""
        if action:
            success = self.success_patterns.get(action, 0)
            failure = self.failure_patterns.get(action, 0)
            return round(success / max(success + failure, 1), 4)
        total_success = sum(self.success_patterns.values())
        total_failure = sum(self.failure_patterns.values())
        return round(total_success / max(total_success + total_failure, 1), 4)

    def get_stats(self) -> Dict[str, Any]:
        return {
            "learner_id": self.learner_id,
            "total_reflections": len(self.reflections),
            "total_lessons": len(self.lessons),
            "success_count": sum(self.success_patterns.values()),
            "failure_count": sum(self.failure_patterns.values()),
            "overall_success_rate": self.get_success_rate(),
            "top_success_actions": self.success_patterns.most_common(5),
            "top_failure_actions": self.failure_patterns.most_common(5),
        }
