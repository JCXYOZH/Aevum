"""能力增强职责：code。"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
import time
import uuid
from collections import OrderedDict, defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from libertas.foundation.byte_stream import safe_decode

from .models import CodeImpact

class CodeEnhancer:
    """代码库增强器

    - 变更影响分析
    - 代码质量评分
    - 自动重构建议
    - 依赖图构建
    - 代码复杂度分析
    """

    def __init__(self):
        self.dependency_graph: Dict[str, List[str]] = defaultdict(list)
        self.quality_scores: Dict[str, float] = {}

    def analyze_impact(self, file_path: str, project_root: str = ".") -> CodeImpact:
        """分析代码变更影响"""
        impact = CodeImpact(file_path=file_path)

        if not os.path.exists(file_path):
            impact.change_type = "deleted"
            impact.risk_level = "high"
            impact.suggestion = "文件已删除，需检查所有引用该文件的代码"
            return impact

        # 读取文件
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                lines = content.split("\n")
        except Exception:
            return impact

        impact.lines_changed = len(lines)

        # 提取函数/类
        functions = []
        for i, line in enumerate(lines):
            if re.match(r"\s*def\s+\w+", line) or re.match(r"\s*class\s+\w+", line):
                name = re.findall(r"(?:def|class)\s+(\w+)", line)
                if name:
                    functions.append(name[0])
        impact.affected_functions = functions

        # 分析import依赖
        imports = []
        for line in lines:
            if line.startswith("import ") or line.startswith("from "):
                imports.append(line.strip())
        impact.dependencies_affected = imports

        # 风险评估
        if len(functions) > 10:
            impact.risk_level = "high"
            impact.suggestion = "文件包含大量函数，建议拆分"
        elif any("test" in f.lower() for f in functions):
            impact.risk_level = "low"
            impact.suggestion = "主要是测试代码，风险较低"
        elif any("config" in file_path.lower(), "setting" in file_path.lower()):
            impact.risk_level = "high"
            impact.suggestion = "配置文件变更可能影响全局"
        else:
            impact.risk_level = "medium"

        return impact

    def score_quality(self, file_path: str) -> Dict:
        """代码质量评分（0-100）"""
        if not os.path.exists(file_path):
            return {"score": 0, "error": "文件不存在"}

        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        score = 100
        issues = []

        # 1. 行数检查
        if len(lines) > 1000:
            score -= 15
            issues.append(f"文件过长({len(lines)}行)，建议拆分")
        elif len(lines) > 500:
            score -= 5
            issues.append(f"文件较长({len(lines)}行)")

        # 2. 函数长度检查
        func_start = 0
        for i, line in enumerate(lines):
            if re.match(r"\s*def\s+\w+", line):
                if func_start > 0 and i - func_start > 100:
                    score -= 10
                    issues.append(f"函数过长(>{i - func_start}行)")
                func_start = i

        # 3. 注释率检查
        comment_lines = sum(1 for l in lines if l.strip().startswith("#") or '"""' in l)
        comment_rate = comment_lines / len(lines) if lines else 0
        if comment_rate < 0.05:
            score -= 10
            issues.append(f"注释率过低({comment_rate:.1%})")

        # 4. TODO/FIXME检查
        todos = sum(1 for l in lines if "TODO" in l or "FIXME" in l)
        if todos > 5:
            score -= 5
            issues.append(f"存在{todos}个TODO/FIXME")

        # 5. 异常处理检查
        bare_except = sum(1 for l in lines if l.strip() == "except:")
        if bare_except > 0:
            score -= 5
            issues.append(f"存在{bare_except}个裸except，建议指定异常类型")

        score = max(0, score)
        self.quality_scores[file_path] = score
        return {
            "score": score,
            "issues": issues,
            "line_count": len(lines),
            "comment_rate": round(comment_rate, 3),
            "todo_count": todos,
        }

    def suggest_refactor(self, file_path: str) -> List[Dict]:
        """自动重构建议"""
        suggestions = []
        quality = self.score_quality(file_path)

        for issue in quality.get("issues", []):
            if "过长" in issue:
                suggestions.append({
                    "type": "split_file",
                    "priority": "high",
                    "description": issue,
                    "action": "将文件按功能拆分为多个模块",
                })
            elif "注释率" in issue:
                suggestions.append({
                    "type": "add_comments",
                    "priority": "medium",
                    "description": issue,
                    "action": "为关键函数和复杂逻辑添加文档字符串",
                })
            elif "TODO" in issue:
                suggestions.append({
                    "type": "resolve_todos",
                    "priority": "low",
                    "description": issue,
                    "action": "处理或记录所有TODO/FIXME",
                })
            elif "裸except" in issue:
                suggestions.append({
                    "type": "fix_bare_except",
                    "priority": "high",
                    "description": issue,
                    "action": "将裸except替换为具体异常类型",
                })

        return suggestions

    def build_dependency_graph(self, project_root: str) -> Dict:
        """构建项目依赖图"""
        graph = defaultdict(list)
        for dirpath, _, filenames in os.walk(project_root):
            for fn in filenames:
                if fn.endswith(".py"):
                    fpath = os.path.join(dirpath, fn)
                    try:
                        with open(fpath, 'r', encoding='utf-8') as f:
                            for line in f:
                                if line.startswith("from .") or line.startswith("import ."):
                                    dep = line.strip().split()[1].split(".")[0]
                                    graph[fn].append(dep)
                    except Exception:
                        pass
        self.dependency_graph = dict(graph)
        return {
            "nodes": len(graph),
            "edges": sum(len(v) for v in graph.values()),
            "graph": dict(graph),
        }
