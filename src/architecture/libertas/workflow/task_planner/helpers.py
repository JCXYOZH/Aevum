"""任务规划职责：helpers。"""

from __future__ import annotations

import threading
import time
import uuid
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from libertas.foundation.terminal import terminal

from .models import TaskStep
from .singleton import get_task_planner

def detect_multi_step(text: str) -> bool:
    """检测是否是多步骤任务"""
    if not text or len(text) < 5:
        return False
    keyword_count = sum(1 for kw in _MULTI_STEP_KEYWORDS if kw in text)
    if keyword_count >= 2:
        return True
    if any(marker in text for marker in ["第一步", "第二步", "首先", "其次", "最后"]):
        return True
    if text.count("，") >= 2 or text.count(";") >= 2 or text.count("；") >= 2:
        if any(kw in text for kw in ["扫描", "分析", "生成", "执行", "运行", "查找"]):
            return True
    return False

def decompose_task(text: str) -> list:
    """分解多步骤任务"""
    steps = []
    if not text:
        return steps

    try:
        planner = get_task_planner()
        plan = planner.decompose(text)
        if plan and plan.tasks:
            for subtask in plan.tasks:
                step = TaskStep(
                    task_id=subtask.task_id,
                    title=subtask.title,
                    description=subtask.description,
                    step_type=_detect_step_type(subtask.title + " " + subtask.description),
                    status=subtask.status.value if hasattr(subtask.status, 'value') else str(subtask.status),
                    dependencies=list(subtask.dependencies),
                )
                steps.append(step)
            if steps:
                return steps
    except Exception:
        pass

    separators = ["然后", "接着", "之后", "随后", "再", "并且", "同时",
                  "第一步", "第二步", "第三步", "首先", "其次", "最后",
                  "，", ";", "；", "\n"]
    parts = [text]
    for sep in separators:
        new_parts = []
        for part in parts:
            if sep in part:
                new_parts.extend([p.strip() for p in part.split(sep) if p.strip()])
            else:
                new_parts.append(part)
        parts = new_parts

    for i, part in enumerate(parts):
        if len(part) < 2:
            continue
        step = TaskStep(
            task_id=f"step_{i+1}",
            title=part[:50],
            description=part,
            step_type=_detect_step_type(part),
            status="pending",
            dependencies=[f"step_{i}"] if i > 0 else [],
            order=i + 1,
        )
        steps.append(step)

    return steps

def _detect_step_type(text: str) -> str:
    """检测步骤类型"""
    text_lower = text.lower()
    for step_type, keywords in _STEP_TYPE_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            return step_type
    return "general"

def format_steps_for_prompt(steps: list) -> str:
    """将任务步骤格式化为提示词文本"""
    if not steps:
        return ""

    lines = ["【任务分解】"]
    lines.append(f"共 {len(steps)} 个步骤：")
    lines.append("")

    for i, step in enumerate(steps, 1):
        title = getattr(step, 'title', '') or getattr(step, 'description', '') or f'步骤{i}'
        step_type = getattr(step, 'step_type', 'general')
        deps = getattr(step, 'dependencies', [])

        type_label = {
            'search': '搜索', 'scan': '扫描', 'tool': '工具',
            'fetch': '抓取', 'analyze': '分析', 'report': '报告',
            'general': '通用'
        }.get(step_type, '通用')

        line = f"  {i}. [{type_label}] {title}"
        if deps:
            line += f" (依赖: {', '.join(deps)})"
        lines.append(line)

    lines.append("")
    lines.append("【执行建议】")
    lines.append("请按顺序执行上述步骤，每完成一步后检查结果，再进行下一步。")
    lines.append("如果某一步失败，记录错误信息并尝试替代方案。")

    return "\n".join(lines)
