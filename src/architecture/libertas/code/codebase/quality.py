"""代码库模块职责：quality。"""

from __future__ import annotations

import ast
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Type, Union

from libertas.foundation.byte_stream import safe_decode
from libertas.foundation.terminal import terminal

class CodeQualityScorer:
    """代码质量评分器 - 多维度评估代码质量"""

    def __init__(self, indexer):
        self.indexer = indexer
        self.dimensions = [
            "complexity", "readability", "maintainability",
            "documentation", "testing", "security", "performance"
        ]

    def score_file(self, file_path: str) -> Dict[str, Any]:
        """评估单个文件的代码质量"""
        code_file = self.indexer.files.get(file_path)
        if not code_file:
            return {"success": False, "error": "文件未索引"}
        content = code_file.content if hasattr(code_file, 'content') else ""
        lines = content.split('\n')
        total_lines = len(lines)
        # 复杂度评分（基于函数长度和嵌套深度）
        complexity_score = self._score_complexity(code_file, lines)
        # 可读性评分（基于行长度、命名规范、注释比例）
        readability_score = self._score_readability(lines)
        # 可维护性评分（综合复杂度和可读性）
        maintainability_score = (complexity_score * 0.5 + readability_score * 0.5)
        # 文档评分（基于docstring覆盖率）
        doc_score = self._score_documentation(code_file, lines)
        # 安全评分（基于危险模式检测）
        security_score = self._score_security(content)
        # 综合评分
        overall = (complexity_score * 0.2 + readability_score * 0.2 +
                   maintainability_score * 0.2 + doc_score * 0.15 +
                   security_score * 0.25)
        grade = "A" if overall >= 0.8 else ("B" if overall >= 0.6 else ("C" if overall >= 0.4 else "D"))
        return {
            "success": True,
            "file_path": file_path,
            "overall_score": overall,
            "grade": grade,
            "total_lines": total_lines,
            "dimension_scores": {
                "complexity": complexity_score,
                "readability": readability_score,
                "maintainability": maintainability_score,
                "documentation": doc_score,
                "security": security_score,
            },
            "recommendations": self._generate_recommendations(complexity_score, readability_score, doc_score, security_score),
        }

    def _score_complexity(self, code_file, lines) -> float:
        """复杂度评分（0-1，越高越好）"""
        # 计算平均函数长度
        func_lengths = []
        for symbol in code_file.symbols if hasattr(code_file, 'symbols') else []:
            if hasattr(symbol, 'symbol_type') and symbol.symbol_type in ('function', 'method'):
                if hasattr(symbol, 'line_start') and hasattr(symbol, 'line_end'):
                    length = symbol.line_end - symbol.line_start
                    func_lengths.append(length)
        avg_func_length = sum(func_lengths) / len(func_lengths) if func_lengths else 20
        # 函数越长分越低
        length_score = max(0, 1.0 - avg_func_length / 100.0)
        # 文件行数评分
        file_score = max(0, 1.0 - len(lines) / 1000.0)
        return (length_score * 0.6 + file_score * 0.4)

    def _score_readability(self, lines) -> float:
        """可读性评分"""
        if not lines:
            return 1.0
        # 行长度
        long_lines = sum(1 for l in lines if len(l) > 120)
        length_penalty = long_lines / len(lines)
        # 空行比例（合理的空行比例提高可读性）
        blank_lines = sum(1 for l in lines if l.strip() == '')
        blank_ratio = blank_lines / len(lines)
        blank_score = 1.0 - abs(blank_ratio - 0.15)
        # 注释比例
        comment_lines = sum(1 for l in lines if l.strip().startswith('#'))
        comment_ratio = comment_lines / len(lines)
        comment_score = min(comment_ratio / 0.1, 1.0)
        return max(0, (1.0 - length_penalty) * 0.4 + blank_score * 0.3 + comment_score * 0.3)

    def _score_documentation(self, code_file, lines) -> float:
        """文档评分"""
        functions = [s for s in (code_file.symbols if hasattr(code_file, 'symbols') else [])
                     if hasattr(s, 'symbol_type') and s.symbol_type in ('function', 'method', 'class')]
        if not functions:
            return 0.5
        documented = 0
        for func in functions:
            if hasattr(func, 'line_start') and hasattr(func, 'line_end'):
                func_lines = lines[func.line_start-1:func.line_end]
                has_doc = False
                for fl in func_lines[:5]:
                    if fl.count(chr(34)*3) > 0 or fl.count(chr(39)*3) > 0:
                        has_doc = True
                        break
                if has_doc:
                    documented += 1
        return documented / len(functions)

    def _score_security(self, content: str) -> float:
        """安全评分（检测危险模式）"""
        dangerous_patterns = [
            ('eval(', '使用eval可能导致代码注入'),
            ('exec(', '使用exec可能导致代码注入'),
            ('os.system(', 'os.system可能导致命令注入'),
            ('subprocess.call(shell=True', 'shell=True可能导致命令注入'),
            ('pickle.loads(', '反序列化不可信数据可能导致代码执行'),
            ('assert ', 'assert在生产环境可能被优化掉'),
        ]
        issues = 0
        for pattern, _ in dangerous_patterns:
            if pattern in content:
                issues += 1
        return max(0, 1.0 - issues * 0.2)

    def _generate_recommendations(self, complexity, readability, doc, security) -> List[str]:
        """生成改进建议"""
        recs = []
        if complexity < 0.5:
            recs.append("代码复杂度过高，建议拆分长函数和大文件")
        if readability < 0.5:
            recs.append("代码可读性有待提升，建议控制行长度、增加合理的空行和注释")
        if doc < 0.5:
            recs.append("文档覆盖率不足，建议为函数和类添加docstring")
        if security < 0.7:
            recs.append("存在安全隐患，建议审查危险函数的使用")
        if not recs:
            recs.append("代码质量良好，继续保持")
        return recs

    def score_project(self) -> Dict[str, Any]:
        """评估整个项目的代码质量"""
        results = []
        for file_path in self.indexer.files:
            if file_path.endswith('.py'):
                result = self.score_file(file_path)
                if result.get("success"):
                    results.append(result)
        if not results:
            return {"success": False, "error": "没有可评估的Python文件"}
        avg_score = sum(r["overall_score"] for r in results) / len(results)
        grade_distribution = {}
        for r in results:
            g = r["grade"]
            grade_distribution[g] = grade_distribution.get(g, 0) + 1
        return {
            "success": True,
            "total_files": len(results),
            "average_score": avg_score,
            "overall_grade": "A" if avg_score >= 0.8 else ("B" if avg_score >= 0.6 else ("C" if avg_score >= 0.4 else "D")),
            "grade_distribution": grade_distribution,
            "best_files": sorted(results, key=lambda x: -x["overall_score"])[:5],
            "worst_files": sorted(results, key=lambda x: x["overall_score"])[:5],
            "dimension_averages": {
                dim: sum(r["dimension_scores"][dim] for r in results) / len(results)
                for dim in results[0]["dimension_scores"]
            },
        }
