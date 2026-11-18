"""代码库模块职责：analyzer。"""

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

from .models import CodeSymbol
from .indexer import ProjectIndexer

class CodeAnalyzer:
    """代码库理解器 - 深入分析代码结构、关系、质量"""

    def __init__(self, indexer: ProjectIndexer):
        self.analyzer_id = f"ana_{uuid.uuid4().hex[:8]}"
        self.indexer = indexer
        self.call_graph: Dict[str, List[str]] = defaultdict(list)
        self.inheritance_graph: Dict[str, List[str]] = defaultdict(list)
        self._lock = threading.RLock()

    def analyze_project(self) -> Dict[str, Any]:
        """分析整个项目"""
        self._build_call_graph()
        self._build_inheritance_graph()
        return {
            "call_graph_nodes": len(self.call_graph),
            "call_graph_edges": sum(len(v) for v in self.call_graph.values()),
            "inheritance_nodes": len(self.inheritance_graph),
            "inheritance_edges": sum(len(v) for v in self.inheritance_graph.values()),
        }

    def _build_call_graph(self):
        """构建调用关系图"""
        with self._lock:
            self.call_graph.clear()
            for symbol in self.indexer.symbols.values():
                if symbol.symbol_type in ("function", "method"):
                    qualified = symbol.get_qualified_name()
                    for call in symbol.calls:
                        self.call_graph[qualified].append(call)

    def _build_inheritance_graph(self):
        """构建继承关系图"""
        with self._lock:
            self.inheritance_graph.clear()
            for file_path, code_file in self.indexer.files.items():
                if code_file.language != "python":
                    continue
                try:
                    tree = ast.parse(code_file.content)
                    for node in ast.walk(tree):
                        if isinstance(node, ast.ClassDef):
                            for base in node.bases:
                                if isinstance(base, ast.Name):
                                    self.inheritance_graph[node.name].append(base.id)
                                elif isinstance(base, ast.Attribute):
                                    self.inheritance_graph[node.name].append(base.attr)
                except SyntaxError:
                    continue

    def get_callers(self, function_name: str) -> List[CodeSymbol]:
        """获取调用指定函数的所有符号"""
        callers = []
        for symbol in self.indexer.symbols.values():
            if function_name in symbol.calls:
                callers.append(symbol)
        return callers

    def get_callees(self, function_name: str) -> List[str]:
        """获取指定函数调用的所有函数"""
        for symbol in self.indexer.symbols.values():
            if symbol.name == function_name or symbol.get_qualified_name() == function_name:
                return symbol.calls
        return []

    def get_subclasses(self, class_name: str) -> List[str]:
        """获取指定类的所有子类"""
        subclasses = []
        for child, parents in self.inheritance_graph.items():
            if class_name in parents:
                subclasses.append(child)
                subclasses.extend(self.get_subclasses(child))
        return list(set(subclasses))

    def get_superclasses(self, class_name: str) -> List[str]:
        """获取指定类的所有父类"""
        parents = self.inheritance_graph.get(class_name, [])
        all_parents = list(parents)
        for parent in parents:
            all_parents.extend(self.get_superclasses(parent))
        return list(set(all_parents))

    def get_function_context(self, function_name: str) -> Dict[str, Any]:
        """获取函数的完整上下文（定义、调用者、被调用者、所在文件）"""
        symbol = self.indexer.find_symbol_by_qualified_name(function_name)
        if not symbol:
            matches = self.indexer.find_symbol_by_name(function_name)
            if matches:
                symbol = matches[0]
        if not symbol:
            return {"error": f"函数不存在: {function_name}"}

        code_file = self.indexer.get_file(symbol.file_path)
        return {
            "symbol": symbol.to_dict(),
            "file": code_file.to_dict() if code_file else None,
            "source_code": code_file.get_lines(symbol.line_start, symbol.line_end) if code_file else "",
            "callers": [s.get_qualified_name() for s in self.get_callers(symbol.name)],
            "callees": symbol.calls,
            "docstring": symbol.docstring,
            "parameters": symbol.parameters,
            "return_type": symbol.return_type,
            "complexity": symbol.complexity,
        }

    def get_class_context(self, class_name: str) -> Dict[str, Any]:
        """获取类的完整上下文"""
        matches = self.indexer.find_symbol_by_name(class_name)
        class_symbol = None
        for m in matches:
            if m.symbol_type == "class":
                class_symbol = m
                break
        if not class_symbol:
            return {"error": f"类不存在: {class_name}"}

        code_file = self.indexer.get_file(class_symbol.file_path)
        # 获取类的所有方法
        methods = [s for s in self.indexer.symbols.values()
                   if s.parent == class_name and s.symbol_type == "method"]

        return {
            "class": class_symbol.to_dict(),
            "file": code_file.to_dict() if code_file else None,
            "source_code": code_file.get_lines(class_symbol.line_start, class_symbol.line_end) if code_file else "",
            "methods": [m.to_dict() for m in methods],
            "subclasses": self.get_subclasses(class_name),
            "superclasses": self.get_superclasses(class_name),
            "docstring": class_symbol.docstring,
            "decorators": class_symbol.decorators,
        }

    def get_project_structure(self) -> Dict[str, Any]:
        """获取项目结构概览"""
        return {
            "file_tree": self.indexer.get_file_tree(),
            "stats": self.indexer.get_stats().to_dict(),
            "languages": self.indexer.get_stats().by_language,
            "largest_files": self.indexer.get_stats().largest_files,
            "most_complex": self.indexer.get_stats().most_complex_files,
        }

    def get_dependencies(self, file_path: str) -> Dict[str, Any]:
        """获取文件的依赖关系"""
        code_file = self.indexer.get_file(file_path)
        if not code_file:
            return {"error": f"文件不存在: {file_path}"}
        return {
            "file": file_path,
            "imports": code_file.imports,
            "dependencies": code_file.dependencies,
            "dependents": code_file.dependents,
            "dependency_count": len(code_file.dependencies),
            "dependent_count": len(code_file.dependents),
        }
