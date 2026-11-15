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
from .prompt_optimizer import *  # noqa: F401,F403

class PromptABTester:
    """提示词A/B测试器"""

    def __init__(self):
        self.tester_id = f"ab_{uuid.uuid4().hex[:8]}"
        self.experiments: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()

    def create_experiment(self, name: str, prompt_a: str, prompt_b: str,
                          description: str = "") -> str:
        experiment_id = f"exp_{uuid.uuid4().hex[:6]}"
        self.experiments[experiment_id] = {
            "experiment_id": experiment_id,
            "name": name,
            "prompt_a": prompt_a,
            "prompt_b": prompt_b,
            "description": description,
            "created_at": time.time(),
            "status": "running",
            "results_a": [],
            "results_b": [],
            "metrics": {
                "a": {"count": 0, "avg_quality": 0.0, "avg_latency": 0.0, "total_tokens": 0},
                "b": {"count": 0, "avg_quality": 0.0, "avg_latency": 0.0, "total_tokens": 0},
            },
        }
        return experiment_id

    def record_result(self, experiment_id: str, variant: str,
                      quality: float, latency_ms: float, tokens: int = 0):
        exp = self.experiments.get(experiment_id)
        if not exp or exp["status"] != "running":
            return
        variant_key = variant.lower()
        if variant_key not in ("a", "b"):
            return
        metrics = exp["metrics"][variant_key]
        metrics["count"] += 1
        metrics["avg_quality"] = (
            (metrics["avg_quality"] * (metrics["count"] - 1) + quality) / metrics["count"]
        )
        metrics["avg_latency"] = (
            (metrics["avg_latency"] * (metrics["count"] - 1) + latency_ms) / metrics["count"]
        )
        metrics["total_tokens"] += tokens
        exp[f"results_{variant_key}"].append({
            "quality": quality,
            "latency_ms": latency_ms,
            "tokens": tokens,
            "timestamp": time.time(),
        })

    def get_winner(self, experiment_id: str) -> Dict[str, Any]:
        exp = self.experiments.get(experiment_id)
        if not exp:
            return {"error": "experiment not found"}
        metrics_a = exp["metrics"]["a"]
        metrics_b = exp["metrics"]["b"]
        if metrics_a["count"] == 0 or metrics_b["count"] == 0:
            return {"status": "insufficient_data"}
        # 综合评分：质量(0.6) + 延迟(0.2) + token效率(0.2)
        score_a = metrics_a["avg_quality"] * 0.6 + (1 - min(metrics_a["avg_latency"] / 5000, 1)) * 0.2
        score_b = metrics_b["avg_quality"] * 0.6 + (1 - min(metrics_b["avg_latency"] / 5000, 1)) * 0.2
        winner = "a" if score_a > score_b else "b" if score_b > score_a else "tie"
        return {
            "experiment_id": experiment_id,
            "winner": winner,
            "score_a": round(score_a, 4),
            "score_b": round(score_b, 4),
            "margin": round(abs(score_a - score_b), 4),
            "metrics_a": metrics_a,
            "metrics_b": metrics_b,
            "confidence": "high" if abs(score_a - score_b) > 0.1 else "medium" if abs(score_a - score_b) > 0.05 else "low",
        }

    def stop_experiment(self, experiment_id: str) -> bool:
        exp = self.experiments.get(experiment_id)
        if exp:
            exp["status"] = "completed"
            exp["completed_at"] = time.time()
            return True
        return False

    def list_experiments(self, status: str = "") -> List[Dict]:
        experiments = list(self.experiments.values())
        if status:
            experiments = [e for e in experiments if e["status"] == status]
        return experiments

    def get_stats(self) -> Dict[str, Any]:
        return {
            "tester_id": self.tester_id,
            "total_experiments": len(self.experiments),
            "running": sum(1 for e in self.experiments.values() if e["status"] == "running"),
            "completed": sum(1 for e in self.experiments.values() if e["status"] == "completed"),
        }

class DynamicPromptAssembler:
    """动态提示词组装器"""

    def __init__(self, template_library: Optional[PromptTemplateLibrary] = None,
                 few_shot_manager: Optional[FewShotManager] = None):
        self.assembler_id = f"dpa_{uuid.uuid4().hex[:8]}"
        self.template_library = template_library or PromptTemplateLibrary()
        self.few_shot_manager = few_shot_manager or FewShotManager()
        self.assembly_history: deque = deque(maxlen=200)
        self._lock = threading.RLock()

    def assemble(self, task: str, context: str = "",
                 template_id: str = "", examples_count: int = 0,
                 system_prompt: str = "", variables: Optional[Dict] = None,
                 include_chain_of_thought: bool = False) -> Dict[str, Any]:
        """组装提示词"""
        components = []

        # 1. 系统提示词
        if system_prompt:
            components.append(("system", system_prompt))
        else:
            components.append(("system", "你是一位专业、准确、有帮助的AI助手。"))

        # 2. 角色/身份
        role = self._infer_role(task)
        if role:
            components.append(("role", f"请以{role}的身份回答。"))

        # 3. 上下文
        if context:
            components.append(("context", f"背景信息：\n{context}"))

        # 4. 少样本示例
        if examples_count > 0:
            examples = self.few_shot_manager.select_examples(task, examples_count)
            if examples:
                formatted = self.few_shot_manager.format_few_shot(examples)
                components.append(("few_shot", formatted))

        # 5. 模板
        if template_id:
            template = self.template_library.get_template(template_id)
            if template:
                rendered = template.render(variables or {})
                components.append(("template", rendered))
                template.usage_count += 1

        # 6. 任务指令
        components.append(("task", f"任务：{task}"))

        # 7. 思维链
        if include_chain_of_thought:
            components.append(("cot", "请逐步思考，先分析问题，再给出答案。"))

        # 8. 输出格式要求
        components.append(("format", "请确保回答准确、清晰、有条理。"))

        # 组装
        assembled_parts = []
        for comp_type, content in components:
            if content.strip():
                assembled_parts.append(content)

        full_prompt = "\n\n".join(assembled_parts)

        result = {
            "assembled_prompt": full_prompt,
            "components": [{"type": t, "length": len(c)} for t, c in components],
            "total_length": len(full_prompt),
            "word_count": len(full_prompt.split()),
            "template_used": template_id,
            "examples_count": examples_count,
            "timestamp": time.time(),
        }

        self.assembly_history.append(result)
        return result

    def _infer_role(self, task: str) -> str:
        """从任务推断角色"""
        task_lower = task.lower()
        role_keywords = {
            "代码": "资深软件工程师",
            "编程": "资深软件工程师",
            "debug": "资深软件工程师",
            "法律": "专业法律顾问",
            "合同": "专业法律顾问",
            "医疗": "专业医疗顾问",
            "健康": "专业医疗顾问",
            "财务": "专业财务顾问",
            "投资": "专业投资顾问",
            "教育": "资深教育工作者",
            "学习": "资深教育工作者",
            "翻译": "专业翻译",
            "写作": "专业作家",
            "文章": "专业作家",
            "数学": "数学专家",
            "物理": "物理学专家",
            "化学": "化学专家",
        }
        for keyword, role in role_keywords.items():
            if keyword in task_lower:
                return role
        return ""

    def get_assembly_history(self, limit: int = 50) -> List[Dict]:
        return list(reversed(self.assembly_history))[-limit:]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "assembler_id": self.assembler_id,
            "total_assemblies": len(self.assembly_history),
            "avg_length": (
                sum(h["total_length"] for h in self.assembly_history) /
                max(len(self.assembly_history), 1)
            ),
            "templates_in_library": len(self.template_library.templates),
            "examples_in_manager": len(self.few_shot_manager.examples),
        }

_prompt_template_library = PromptTemplateLibrary()

_prompt_optimizer = PromptOptimizer()

_few_shot_manager = FewShotManager()

_prompt_ab_tester = PromptABTester()

_dynamic_prompt_assembler = DynamicPromptAssembler(_prompt_template_library, _few_shot_manager)

def get_prompt_template_library() -> PromptTemplateLibrary:
    return _prompt_template_library

def get_prompt_optimizer() -> PromptOptimizer:
    return _prompt_optimizer

def get_few_shot_manager() -> FewShotManager:
    return _few_shot_manager
