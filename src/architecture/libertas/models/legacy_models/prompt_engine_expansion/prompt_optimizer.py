"""
models/prompt_engine_expansion.py - 提示词引擎综合扩展模块

高级提示词管理：提示词模板库、提示词优化器、少样本示例管理器、
提示词版本控制、提示词A/B测试、提示词效果评估器、动态提示词组装器。
"""
import os
import json
import time
import uuid
import math
import hashlib
import threading
import re
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter
from enum import Enum
from libertas.foundation.terminal import terminal


# ================================================================
# 提示词类型
# ================================================================
from .prompt_type import *  # noqa: F401,F403

class PromptOptimizer:
    """提示词优化器"""

    def __init__(self):
        self.optimizer_id = f"opt_{uuid.uuid4().hex[:8]}"
        self.optimization_history: deque = deque(maxlen=200)
        self.techniques = [
            "clear_instructions",
            "structured_output",
            "few_shot_examples",
            "chain_of_thought",
            "role_assignment",
            "context_provision",
            "constraint_specification",
            "example_diversity",
        ]
        self._lock = threading.RLock()

    def analyze_prompt(self, prompt: str) -> Dict[str, Any]:
        """分析提示词质量"""
        analysis = {
            "length": len(prompt),
            "word_count": len(prompt.split()),
            "has_instruction": any(kw in prompt for kw in ["请", "需要", "必须", "应该", "please", "must", "should", "need"]),
            "has_constraints": any(kw in prompt for kw in ["不超过", "限制", "必须", "不能", "limit", "constraint", "must not"]),
            "has_examples": any(kw in prompt for kw in ["例如", "比如", "例子", "example", "for instance"]),
            "has_structure": any(kw in prompt for kw in ["步骤", "格式", "结构", "step", "format", "structure"]),
            "has_role": any(kw in prompt for kw in ["你是", "作为", "扮演", "you are", "act as", "role"]),
            "has_context": any(kw in prompt for kw in ["背景", "上下文", "context", "background"]),
            "variables": re.findall(r'\{(\w+)\}', prompt),
        }
        # 质量评分
        score = 0.0
        if analysis["length"] > 50:
            score += 0.1
        if analysis["has_instruction"]:
            score += 0.15
        if analysis["has_constraints"]:
            score += 0.1
        if analysis["has_examples"]:
            score += 0.15
        if analysis["has_structure"]:
            score += 0.15
        if analysis["has_role"]:
            score += 0.1
        if analysis["has_context"]:
            score += 0.1
        if analysis["variables"]:
            score += 0.05
        analysis["quality_score"] = round(min(score, 1.0), 4)
        analysis["quality_level"] = (
            "excellent" if score >= 0.8 else
            "good" if score >= 0.6 else
            "fair" if score >= 0.4 else
            "poor"
        )
        return analysis

    def suggest_improvements(self, prompt: str) -> List[Dict[str, str]]:
        """建议改进"""
        analysis = self.analyze_prompt(prompt)
        suggestions = []
        if not analysis["has_instruction"]:
            suggestions.append({
                "technique": "clear_instructions",
                "suggestion": "添加明确的指令，说明需要做什么",
                "example": "请分析以下文本的情感倾向...",
            })
        if not analysis["has_constraints"]:
            suggestions.append({
                "technique": "constraint_specification",
                "suggestion": "添加约束条件，如输出长度、格式限制",
                "example": "回答不超过200字，使用列表格式",
            })
        if not analysis["has_examples"]:
            suggestions.append({
                "technique": "few_shot_examples",
                "suggestion": "添加1-3个示例，展示期望的输入输出格式",
                "example": "示例：输入=... 输出=...",
            })
        if not analysis["has_structure"]:
            suggestions.append({
                "technique": "structured_output",
                "suggestion": "指定输出结构，如JSON格式或分步骤",
                "example": "请按以下JSON格式输出：{\"result\": ...}",
            })
        if not analysis["has_role"]:
            suggestions.append({
                "technique": "role_assignment",
                "suggestion": "分配角色，让模型以特定身份回答",
                "example": "你是一位资深的软件工程师...",
            })
        if not analysis["has_context"]:
            suggestions.append({
                "technique": "context_provision",
                "suggestion": "提供背景信息，帮助模型理解上下文",
                "example": "背景：这是一个电商平台的用户评论分析任务...",
            })
        return suggestions

    def optimize(self, prompt: str, techniques: Optional[List[str]] = None) -> Dict[str, Any]:
        """优化提示词"""
        analysis = self.analyze_prompt(prompt)
        suggestions = self.suggest_improvements(prompt)
        techniques_to_apply = techniques or [s["technique"] for s in suggestions[:3]]

        optimized = prompt
        applied = []

        if "role_assignment" in techniques_to_apply and not analysis["has_role"]:
            optimized = "你是一位专业的助手。\n\n" + optimized
            applied.append("role_assignment")

        if "structured_output" in techniques_to_apply and not analysis["has_structure"]:
            optimized += "\n\n请以清晰的结构输出结果。"
            applied.append("structured_output")

        if "constraint_specification" in techniques_to_apply and not analysis["has_constraints"]:
            optimized += "\n\n请确保回答准确、简洁。"
            applied.append("constraint_specification")

        result = {
            "original": prompt,
            "optimized": optimized,
            "original_analysis": analysis,
            "optimized_analysis": self.analyze_prompt(optimized),
            "suggestions": suggestions,
            "applied_techniques": applied,
            "improvement_score": round(
                self.analyze_prompt(optimized)["quality_score"] - analysis["quality_score"], 4
            ),
        }

        self.optimization_history.append({
            "timestamp": time.time(),
            "original_score": analysis["quality_score"],
            "optimized_score": result["optimized_analysis"]["quality_score"],
            "applied": applied,
        })

        return result

    def get_optimization_history(self, limit: int = 50) -> List[Dict]:
        return list(reversed(self.optimization_history))[-limit:]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "optimizer_id": self.optimizer_id,
            "total_optimizations": len(self.optimization_history),
            "avg_improvement": (
                sum(h["optimized_score"] - h["original_score"] for h in self.optimization_history) /
                max(len(self.optimization_history), 1)
            ),
            "supported_techniques": self.techniques,
        }

class FewShotManager:
    """少样本示例管理器"""

    def __init__(self):
        self.manager_id = f"fsm_{uuid.uuid4().hex[:8]}"
        self.examples: Dict[str, FewShotExample] = {}
        self._lock = threading.RLock()

    def add_example(self, input_text: str, output_text: str,
                    explanation: str = "", category: str = "general",
                    difficulty: int = 1) -> str:
        example = FewShotExample(input_text, output_text, explanation, category, difficulty)
        with self._lock:
            self.examples[example.example_id] = example
        return example.example_id

    def get_example(self, example_id: str) -> Optional[FewShotExample]:
        return self.examples.get(example_id)

    def remove_example(self, example_id: str) -> bool:
        with self._lock:
            return self.examples.pop(example_id, None) is not None

    def list_examples(self, category: str = "", difficulty: int = 0,
                       limit: int = 50) -> List[FewShotExample]:
        examples = list(self.examples.values())
        if category:
            examples = [e for e in examples if e.category == category]
        if difficulty > 0:
            examples = [e for e in examples if e.difficulty == difficulty]
        examples.sort(key=lambda e: e.usage_count, reverse=True)
        return examples[:limit]

    def select_examples(self, task: str, count: int = 3,
                         category: str = "") -> List[FewShotExample]:
        """为任务选择最合适的示例"""
        candidates = self.list_examples(category=category, limit=100)
        if not candidates:
            return []
        # 简单相关性评分
        task_words = set(task.lower().split())
        scored = []
        for example in candidates:
            input_words = set(example.input_text.lower().split())
            overlap = len(task_words & input_words)
            score = overlap + example.helpfulness_score * 2
            scored.append((example, score))
        scored.sort(key=lambda x: x[1], reverse=True)
        selected = [s[0] for s in scored[:count]]
        for example in selected:
            example.usage_count += 1
        return selected

    def format_few_shot(self, examples: List[FewShotExample],
                         include_explanation: bool = True) -> str:
        """格式化为少样本提示词"""
        parts = []
        for i, example in enumerate(examples, 1):
            parts.append(f"示例 {i}：")
            parts.append(f"输入：{example.input_text}")
            parts.append(f"输出：{example.output_text}")
            if include_explanation and example.explanation:
                parts.append(f"说明：{example.explanation}")
            parts.append("")
        return "\n".join(parts)

    def rate_example(self, example_id: str, helpfulness: float):
        """评价示例有用性"""
        example = self.examples.get(example_id)
        if example:
            example.helpfulness_score = (
                (example.helpfulness_score * example.usage_count + helpfulness) /
                (example.usage_count + 1)
            )

    def get_stats(self) -> Dict[str, Any]:
        return {
            "manager_id": self.manager_id,
            "total_examples": len(self.examples),
            "categories": list(set(e.category for e in self.examples.values())),
            "total_usage": sum(e.usage_count for e in self.examples.values()),
            "avg_helpfulness": (
                sum(e.helpfulness_score for e in self.examples.values()) /
                max(len(self.examples), 1)
            ),
            "by_difficulty": {d: sum(1 for e in self.examples.values() if e.difficulty == d)
                              for d in range(1, 6)},
        }
