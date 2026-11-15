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



class CycleQualityAssessor:
    """循环质量评估器 - 多维度评估Agent循环的质量"""

    def __init__(self):
        self.cycle_records: List[Dict[str, Any]] = []
        self.quality_history: List[Dict[str, Any]] = []

    def record_cycle(self, cycle_data: Dict[str, Any]):
        """记录一次循环数据"""
        self.cycle_records.append(cycle_data)
        if len(self.cycle_records) > 1000:
            self.cycle_records = self.cycle_records[-1000:]

    def assess_cycle(self, cycle_data: Dict[str, Any]) -> Dict[str, Any]:
        """评估单次循环质量"""
        scores = {}
        # 1. 行动有效性（行动是否成功）
        action_success = cycle_data.get("action_success", True)
        scores["action_effectiveness"] = 1.0 if action_success else 0.2
        # 2. 决策质量（是否选择了最优行动）
        decision_confidence = cycle_data.get("decision_confidence", 0.5)
        scores["decision_quality"] = decision_confidence
        # 3. 效率（循环耗时）
        duration_ms = cycle_data.get("duration_ms", 5000)
        scores["efficiency"] = max(0, 1.0 - duration_ms / 30000.0)
        # 4. 进度贡献（是否推进了任务）
        progress_delta = cycle_data.get("progress_delta", 0.0)
        scores["progress_contribution"] = min(1.0, progress_delta * 5)
        # 5. 错误恢复（出错后是否能恢复）
        error_count = cycle_data.get("error_count", 0)
        recovered = cycle_data.get("recovered_from_error", False)
        if error_count == 0:
            scores["error_resilience"] = 1.0
        elif recovered:
            scores["error_resilience"] = 0.6
        else:
            scores["error_resilience"] = 0.2
        # 综合评分
        weights = {
            "action_effectiveness": 0.30,
            "decision_quality": 0.20,
            "efficiency": 0.15,
            "progress_contribution": 0.25,
            "error_resilience": 0.10,
        }
        overall = sum(scores[k] * weights[k] for k in scores)
        grade = "A" if overall >= 0.8 else ("B" if overall >= 0.6 else ("C" if overall >= 0.4 else "D"))
        assessment = {
            "cycle_number": cycle_data.get("cycle_number", 0),
            "overall_score": overall,
            "grade": grade,
            "dimension_scores": scores,
            "recommendations": self._generate_recommendations(scores),
        }
        self.quality_history.append(assessment)
        return assessment

    def _generate_recommendations(self, scores: Dict[str, float]) -> List[str]:
        """生成改进建议"""
        recs = []
        if scores["action_effectiveness"] < 0.5:
            recs.append("行动成功率低，建议检查工具参数和执行环境")
        if scores["decision_quality"] < 0.5:
            recs.append("决策置信度低，建议增加上下文信息或使用更保守的策略")
        if scores["efficiency"] < 0.3:
            recs.append("循环耗时过长，建议优化工具调用或减少不必要的步骤")
        if scores["progress_contribution"] < 0.3:
            recs.append("循环对任务进度贡献小，建议重新评估任务分解是否合理")
        if scores["error_resilience"] < 0.5:
            recs.append("错误恢复能力弱，建议增加错误处理和回退机制")
        if not recs:
            recs.append("循环质量良好，继续保持")
        return recs

    def get_trend(self, window: int = 20) -> Dict[str, Any]:
        """获取质量趋势"""
        recent = self.quality_history[-window:] if self.quality_history else []
        if not recent:
            return {"success": False, "error": "暂无质量记录"}
        avg_score = sum(r["overall_score"] for r in recent) / len(recent)
        # 计算趋势（前半段 vs 后半段）
        mid = len(recent) // 2
        if mid > 0:
            first_half = sum(r["overall_score"] for r in recent[:mid]) / mid
            second_half = sum(r["overall_score"] for r in recent[mid:]) / (len(recent) - mid)
            trend = "improving" if second_half > first_half + 0.05 else ("declining" if second_half < first_half - 0.05 else "stable")
        else:
            trend = "insufficient_data"
        grade_dist = {}
        for r in recent:
            g = r["grade"]
            grade_dist[g] = grade_dist.get(g, 0) + 1
        return {
            "success": True,
            "window_size": len(recent),
            "average_score": avg_score,
            "trend": trend,
            "grade_distribution": grade_dist,
            "latest_assessment": recent[-1] if recent else None,
        }

    def get_stats(self) -> Dict[str, Any]:
        """获取质量评估统计"""
        if not self.quality_history:
            return {"success": False, "error": "暂无质量记录"}
        total = len(self.quality_history)
        avg = sum(r["overall_score"] for r in self.quality_history) / total
        best = max(self.quality_history, key=lambda x: x["overall_score"])
        worst = min(self.quality_history, key=lambda x: x["overall_score"])
        return {
            "total_assessments": total,
            "average_score": avg,
            "best_score": best["overall_score"],
            "best_cycle": best["cycle_number"],
            "worst_score": worst["overall_score"],
            "worst_cycle": worst["cycle_number"],
            "cycle_records_count": len(self.cycle_records),
        }
