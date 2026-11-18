"""代码库模块职责：graph。"""

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

class CodeDependencyGraph:
    """代码依赖图 - 构建和分析项目内的依赖关系网络"""

    def __init__(self, indexer):
        self.indexer = indexer
        self.file_dependencies: Dict[str, Set[str]] = {}
        self.function_dependencies: Dict[str, Set[str]] = {}
        self.class_dependencies: Dict[str, Set[str]] = {}
        self._built = False

    def build(self):
        """构建完整依赖图"""
        self.file_dependencies.clear()
        self.function_dependencies.clear()
        self.class_dependencies.clear()
        # 遍历所有已索引文件
        for file_path, code_file in self.indexer.files.items():
            self._analyze_file_dependencies(file_path, code_file)
        self._built = True

    def _analyze_file_dependencies(self, file_path: str, code_file):
        """分析单个文件的依赖"""
        deps = set()
        content = code_file.content if hasattr(code_file, 'content') else ""
        # 检测import语句
        for line in content.split('\n'):
            stripped = line.strip()
            if stripped.startswith('from ') or stripped.startswith('import '):
                # 提取模块名
                parts = stripped.replace('from ', '').replace('import ', '').split()
                if parts:
                    module = parts[0].rstrip(',')
                    deps.add(module)
        self.file_dependencies[file_path] = deps
        # 分析函数调用依赖
        for symbol in code_file.symbols if hasattr(code_file, 'symbols') else []:
            if hasattr(symbol, 'symbol_type') and symbol.symbol_type == 'function':
                func_deps = self._extract_function_calls(symbol, content)
                self.function_dependencies[symbol.qualified_name] = func_deps

    def _extract_function_calls(self, func_symbol, content: str) -> Set[str]:
        """提取函数体内的调用"""
        calls = set()
        if not hasattr(func_symbol, 'line_start') or not hasattr(func_symbol, 'line_end'):
            return calls
        lines = content.split('\n')
        func_lines = lines[func_symbol.line_start-1:func_symbol.line_end]
        for line in func_lines:
            # 简单匹配 function_name( 模式
            import re
            matches = re.findall(r'([a-zA-Z_][a-zA-Z0-9_]*)\s*\(', line)
            for m in matches:
                if m not in ('if', 'for', 'while', 'return', 'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple', 'bool', 'type', 'isinstance', 'hasattr', 'getattr', 'setattr', 'super', 'class', 'def', 'import', 'from', 'as', 'try', 'except', 'finally', 'with', 'raise', 'yield', 'lambda', 'pass', 'break', 'continue', 'and', 'or', 'not', 'in', 'is', 'None', 'True', 'False'):
                    calls.add(m)
        return calls

    def get_file_dependencies(self, file_path: str) -> List[str]:
        """获取文件依赖的模块列表"""
        if not self._built:
            self.build()
        return list(self.file_dependencies.get(file_path, set()))

    def get_file_dependents(self, file_path: str) -> List[str]:
        """获取依赖该文件的所有文件"""
        if not self._built:
            self.build()
        dependents = []
        for fp, deps in self.file_dependencies.items():
            # 简单匹配：文件名（不含扩展名）是否在依赖中
            base_name = os.path.splitext(os.path.basename(file_path))[0]
            if any(base_name in d for d in deps):
                dependents.append(fp)
        return dependents

    def get_circular_dependencies(self) -> List[List[str]]:
        """检测循环依赖"""
        if not self._built:
            self.build()
        cycles = []
        visited = set()
        rec_stack = set()
        def dfs(node, path):
            visited.add(node)
            rec_stack.add(node)
            path.append(node)
            for dep in self.file_dependencies.get(node, set()):
                dep_path = self._resolve_dep_to_file(dep)
                if dep_path and dep_path in rec_stack:
                    cycle_start = path.index(dep_path)
                    cycles.append(path[cycle_start:] + [dep_path])
                elif dep_path and dep_path not in visited:
                    dfs(dep_path, path)
            path.pop()
            rec_stack.remove(node)
        for fp in self.file_dependencies:
            if fp not in visited:
                dfs(fp, [])
        return cycles

    def _resolve_dep_to_file(self, module_name: str) -> Optional[str]:
        """将模块名解析为文件路径"""
        for fp in self.file_dependencies:
            base = os.path.splitext(os.path.basename(fp))[0]
            if module_name.endswith(base) or base == module_name:
                return fp
        return None

    def get_stats(self) -> Dict[str, Any]:
        """获取依赖图统计"""
        if not self._built:
            self.build()
        total_deps = sum(len(d) for d in self.file_dependencies.values())
        return {
            "total_files": len(self.file_dependencies),
            "total_dependencies": total_deps,
            "avg_dependencies_per_file": total_deps / len(self.file_dependencies) if self.file_dependencies else 0,
            "total_functions": len(self.function_dependencies),
            "circular_dependencies": len(self.get_circular_dependencies()),
            "most_depended_files": sorted(
                [(fp, len(self.get_file_dependents(fp))) for fp in self.file_dependencies],
                key=lambda x: -x[1]
            )[:10],
        }
