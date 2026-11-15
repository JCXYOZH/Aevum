"""代码库模块职责：advisor。"""

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

class RefactoringAdvisor:
    """重构建议器 - 分析代码质量问题并给出具体重构建议"""

    def __init__(self, codebase):
        self.codebase = codebase

    def analyze_file(self, file_path):
        content = self.codebase.read_file(file_path)
        if content is None:
            return {"success": False, "error": "文件不存在"}
        lines = content.split("\n")
        suggestions = []
        # 长函数
        long_functions = self._find_long_functions(content, max_lines=50)
        for func in long_functions:
            suggestions.append({
                "type": "long_function", "severity": "medium",
                "location": f"{file_path}:{func['line']}",
                "function": func["name"], "current_length": func["length"],
                "suggestion": f"函数 '{func['name']}' 有 {func['length']} 行，建议拆分",
                "refactoring": "Extract Method",
            })
        # 大文件
        if len(lines) > 500:
            suggestions.append({
                "type": "large_file", "severity": "high",
                "location": file_path, "current_lines": len(lines),
                "suggestion": f"文件有 {len(lines)} 行，建议拆分模块",
                "refactoring": "Split Module",
            })
        # 深层嵌套
        deep_nesting = self._find_deep_nesting(content, max_depth=4)
        for dn in deep_nesting:
            suggestions.append({
                "type": "deep_nesting", "severity": "medium",
                "location": f"{file_path}:{dn['line']}", "current_depth": dn["depth"],
                "suggestion": f"嵌套深度 {dn['depth']} 层，建议提前返回",
                "refactoring": "Guard Clauses",
            })
        # 魔法数字
        magic_numbers = self._find_magic_numbers(content)
        if magic_numbers:
            suggestions.append({
                "type": "magic_numbers", "severity": "low",
                "location": file_path, "count": len(magic_numbers),
                "suggestion": f"发现 {len(magic_numbers)} 个魔法数字，建议定义常量",
                "refactoring": "Symbolic Constant",
            })
        return {
            "success": True, "file_path": file_path,
            "total_lines": len(lines), "suggestion_count": len(suggestions),
            "by_severity": {
                "high": sum(1 for s in suggestions if s["severity"] == "high"),
                "medium": sum(1 for s in suggestions if s["severity"] == "medium"),
                "low": sum(1 for s in suggestions if s["severity"] == "low"),
            },
            "suggestions": suggestions,
        }

    def _find_long_functions(self, content, max_lines=50):
        import re
        functions = []
        lines = content.split("\n")
        i = 0
        while i < len(lines):
            match = re.match(r"\s*def\s+(\w+)", lines[i])
            if match:
                func_name = match.group(1)
                start_line = i + 1
                indent = len(lines[i]) - len(lines[i].lstrip())
                j = i + 1
                while j < len(lines):
                    if lines[j].strip() and not lines[j].startswith(" " * (indent + 1)) and not lines[j].strip().startswith("#"):
                        break
                    j += 1
                length = j - i
                if length > max_lines:
                    functions.append({"name": func_name, "line": start_line, "length": length})
                i = j
            else:
                i += 1
        return functions

    def _find_deep_nesting(self, content, max_depth=4):
        results = []
        for i, line in enumerate(content.split("\n"), 1):
            stripped = line.strip()
            if any(stripped.startswith(kw) for kw in ("if ", "for ", "while ", "with ", "try:", "except ")):
                indent = len(line) - len(line.lstrip())
                depth = indent // 4
                if depth > max_depth:
                    results.append({"line": i, "depth": depth})
        return results[:10]

    def _find_magic_numbers(self, content):
        import re
        results = []
        for i, line in enumerate(content.split("\n"), 1):
            if line.strip().startswith("#") or "def " in line or "class " in line:
                continue
            matches = re.findall(r"\b(\d{2,})\b", line)
            for m in matches:
                if int(m) not in (0, 1, 2, 10, 100, 1000):
                    results.append({"line": i, "number": m})
        return results[:10]

    def analyze_project(self, min_severity="medium"):
        all_suggestions = []
        file_count = 0
        for file_path in self.codebase.indexer.files:
            if not file_path.endswith('.py'):
                continue
            result = self.analyze_file(file_path)
            if result.get("success"):
                file_count += 1
                severity_level = {"high": 0, "medium": 1, "low": 2}
                min_level = severity_level.get(min_severity, 1)
                filtered = [s for s in result["suggestions"]
                           if severity_level.get(s.get("severity", "low"), 2) <= min_level]
                all_suggestions.extend(filtered)
        return {
            "success": True, "files_analyzed": file_count,
            "total_suggestions": len(all_suggestions),
            "by_severity": {
                "high": sum(1 for s in all_suggestions if s["severity"] == "high"),
                "medium": sum(1 for s in all_suggestions if s["severity"] == "medium"),
                "low": sum(1 for s in all_suggestions if s["severity"] == "low"),
            },
            "top_issues": all_suggestions[:20],
        }
