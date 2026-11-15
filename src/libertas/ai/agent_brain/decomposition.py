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



class SubGoalDecomposer:
    """子目标分解器 - 基于任务类型自动分解复杂需求"""

    def __init__(self):
        self.decomposition_templates: Dict[str, List[str]] = {
            "code_development": [
                "理解需求，明确功能边界和技术约束",
                "设计技术方案和接口定义",
                "编写核心代码实现",
                "语法检查和导入验证",
                "编写单元测试",
                "运行测试并修复问题",
                "代码审查和优化",
                "文档编写",
            ],
            "security_audit": [
                "信息收集：目标识别和资产发现",
                "端口扫描和服务识别",
                "漏洞扫描和配置检查",
                "漏洞验证和风险评估",
                "生成安全审计报告",
                "提供修复建议",
            ],
            "research": [
                "明确研究问题和范围",
                "收集相关资料和文献",
                "整理和分析资料",
                "形成初步结论",
                "验证结论的可靠性",
                "撰写研究报告",
            ],
            "debugging": [
                "复现问题并收集错误信息",
                "分析错误堆栈和日志",
                "定位问题根因",
                "设计修复方案",
                "实施修复",
                "验证修复效果",
                "回归测试",
            ],
        }

    def decompose(self, requirement: str, task_type: str = "") -> Dict[str, Any]:
        """分解需求为子目标"""
        # 自动识别任务类型
        if not task_type:
            task_type = self._detect_task_type(requirement)
        # 获取模板
        template = self.decomposition_templates.get(task_type)
        if not template:
            # 默认分解模板
            template = [
                "理解需求",
                "制定计划",
                "执行核心任务",
                "验证结果",
                "总结和文档",
            ]
        # 基于需求定制子目标
        sub_goals = []
        for i, step in enumerate(template):
            sub_goals.append({
                "index": i,
                "description": step,
                "status": "pending",
                "progress": 0.0,
                "estimated_complexity": self._estimate_complexity(step, requirement),
            })
        return {
            "success": True,
            "requirement": requirement,
            "detected_type": task_type,
            "sub_goals": sub_goals,
            "total_steps": len(sub_goals),
            "estimated_complexity": sum(s["estimated_complexity"] for s in sub_goals),
        }

    def _detect_task_type(self, requirement: str) -> str:
        """自动检测任务类型"""
        req_lower = requirement.lower()
        type_keywords = {
            "code_development": ["开发", "编写", "实现", "代码", "函数", "模块", "功能", "develop", "code", "implement", "function", "module"],
            "security_audit": ["安全", "审计", "扫描", "漏洞", "渗透", "检测", "security", "audit", "scan", "vulnerability", "pentest"],
            "research": ["研究", "调研", "分析", "调查", "research", "analyze", "investigate", "survey"],
            "debugging": ["修复", "调试", "错误", "bug", "问题", "fix", "debug", "error", "issue", "bug"],
        }
        scores = {}
        for ttype, keywords in type_keywords.items():
            scores[ttype] = sum(1 for kw in keywords if kw in req_lower)
        best_type = max(scores, key=scores.get)
        return best_type if scores[best_type] > 0 else "general"

    def _estimate_complexity(self, step: str, requirement: str) -> float:
        """估算步骤复杂度（1-10）"""
        complexity = 3.0
        if any(w in step for w in ["编写", "实现", "开发", "write", "implement", "develop"]):
            complexity += 3
        if any(w in step for w in ["测试", "验证", "test", "verify", "validate"]):
            complexity += 1
        if any(w in step for w in ["设计", "规划", "design", "plan"]):
            complexity += 1
        if len(requirement) > 200:
            complexity += 1
        return min(10.0, complexity)

    def add_template(self, task_type: str, steps: List[str]):
        """添加自定义分解模板"""
        self.decomposition_templates[task_type] = steps

    def get_available_templates(self) -> List[str]:
        """获取可用模板列表"""
        return list(self.decomposition_templates.keys())
