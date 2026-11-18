"""代码库模块职责：core。"""

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

from .testing import BuildVerifier
from .analyzer import CodeAnalyzer
from .modifier import CodeModifier
from .reviewer import CodeReviewer
from .search import CodeSearch
from .git import GitIntegration
from .impact import ImpactAnalyzer
from .indexer import ProjectIndexer
from .models import ProjectStats
from .testing import TestRunner

class Codebase:
    """代码库主类 - 整合索引、分析、搜索、修改、审查、测试、构建、Git、影响分析"""

    @staticmethod
    def _safe_str(s: str) -> str:
        """清理字符串中的代理字符（surrogate），避免UTF-8编码错误

        Windows上os.listdir/os.walk可能返回含代理字符的文件名，
        这些字符无法编码为UTF-8，会导致'surrogates not allowed'错误。
        """
        if not isinstance(s, str):
            return str(s)
        try:
            s.encode('utf-8')
            return s
        except UnicodeEncodeError:
            # 用?替换无法编码的代理字符
            return s.encode('utf-8', errors='replace').decode('utf-8')

    def __init__(self, project_root: str = "", auto_index: bool = True):
        self.codebase_id = f"cb_{uuid.uuid4().hex[:8]}"
        # 清理路径中的代理字符
        self.project_root = self._safe_str(project_root)
        self._lock = threading.RLock()
        self._init_errors = []

        # 子对象创建容错：任何一个失败不影响其他
        try:
            self.indexer = ProjectIndexer(self.project_root)
        except Exception as e:
            self._init_errors.append(f"ProjectIndexer: {e}")
            self.indexer = None
        try:
            self.analyzer = CodeAnalyzer(self.indexer) if self.indexer else None
        except Exception as e:
            self._init_errors.append(f"CodeAnalyzer: {e}")
            self.analyzer = None
        try:
            self.search = CodeSearch(self.indexer) if self.indexer else None
        except Exception as e:
            self._init_errors.append(f"CodeSearch: {e}")
            self.search = None
        try:
            self.modifier = CodeModifier(self.indexer) if self.indexer else None
        except Exception as e:
            self._init_errors.append(f"CodeModifier: {e}")
            self.modifier = None
        try:
            self.reviewer = CodeReviewer(self.indexer) if self.indexer else None
        except Exception as e:
            self._init_errors.append(f"CodeReviewer: {e}")
            self.reviewer = None
        try:
            self.test_runner = TestRunner(self.project_root)
        except Exception as e:
            self._init_errors.append(f"TestRunner: {e}")
            self.test_runner = None
        try:
            self.build_verifier = BuildVerifier(self.project_root)
        except Exception as e:
            self._init_errors.append(f"BuildVerifier: {e}")
            self.build_verifier = None
        try:
            self.git = GitIntegration(self.project_root)
        except Exception as e:
            self._init_errors.append(f"GitIntegration: {e}")
            self.git = None
        try:
            self.impact = ImpactAnalyzer(self.indexer, self.analyzer) if self.indexer and self.analyzer else None
        except Exception as e:
            self._init_errors.append(f"ImpactAnalyzer: {e}")
            self.impact = None

        if self._init_errors:
            print(f"  [WARN] Codebase部分组件初始化失败: {'; '.join(self._init_errors[:3])}")

        if auto_index and project_root and self.indexer:
            try:
                self.index_project()
            except Exception as e:
                print(f"  [WARN] Codebase索引失败: {e}")

    def index_project(self, project_root: str = "") -> ProjectStats:
        """索引整个项目"""
        if project_root:
            self.project_root = project_root
            self.indexer.project_root = project_root
            self.test_runner.project_root = project_root
            self.build_verifier.project_root = project_root
            self.git.project_root = project_root
        stats = self.indexer.index_project()
        self.analyzer.analyze_project()
        return stats

    def reindex_file(self, file_path: str) -> bool:
        """重新索引单个文件"""
        try:
            code_file = self.indexer._index_file(file_path)
            if code_file:
                with self._lock:
                    self.indexer.files[file_path] = code_file
                    # 移除旧符号
                    old_ids = [sid for sid, s in self.indexer.symbols.items()
                              if s.file_path == file_path]
                    for sid in old_ids:
                        del self.indexer.symbols[sid]
                    # 添加新符号
                    for symbol in code_file.symbols.values():
                        self.indexer.symbols[symbol.symbol_id] = symbol
                return True
        except Exception as e:
            terminal.warn(f"重新索引失败 {file_path}: {e}", "codebase")
        return False

    # ===== 项目级阅读 =====
    def read_file(self, file_path: str) -> str:
        """读取文件内容"""
        return self.modifier.read_file(file_path)

    def read_file_lines(self, file_path: str, start: int = 1,
                        end: int = 0) -> str:
        """读取文件指定行范围"""
        code_file = self.indexer.get_file(file_path)
        if not code_file:
            content = self.modifier.read_file(file_path)
            lines = content.split("\n")
        else:
            lines = code_file.lines
        if end == 0:
            end = len(lines)
        return "\n".join(lines[start - 1:end])

    def list_files(self, directory: str = "", language: str = "",
                   recursive: bool = True) -> List[Dict[str, Any]]:
        """列出项目文件"""
        files = self.indexer.list_files(language, directory)
        return [f.to_dict() for f in files]

    def get_project_structure(self) -> Dict[str, Any]:
        """获取项目结构"""
        return self.analyzer.get_project_structure()

    def get_project_stats(self) -> Dict[str, Any]:
        """获取项目统计"""
        return self.indexer.get_stats().to_dict()

    def get_file_tree(self) -> Dict[str, Any]:
        """获取文件树"""
        return self.indexer.get_file_tree()

    # ===== 代码理解 =====
    def get_function_context(self, function_name: str) -> Dict[str, Any]:
        """获取函数完整上下文"""
        return self.analyzer.get_function_context(function_name)

    def get_class_context(self, class_name: str) -> Dict[str, Any]:
        """获取类完整上下文"""
        return self.analyzer.get_class_context(class_name)

    def get_dependencies(self, file_path: str) -> Dict[str, Any]:
        """获取文件依赖关系"""
        return self.analyzer.get_dependencies(file_path)

    def get_callers(self, function_name: str) -> List[Dict[str, Any]]:
        """获取函数调用者"""
        callers = self.analyzer.get_callers(function_name)
        return [c.to_dict() for c in callers]

    def get_callees(self, function_name: str) -> List[str]:
        """获取函数被调用者"""
        return self.analyzer.get_callees(function_name)

    def get_subclasses(self, class_name: str) -> List[str]:
        return self.analyzer.get_subclasses(class_name)

    def get_superclasses(self, class_name: str) -> List[str]:
        return self.analyzer.get_superclasses(class_name)

    # ===== 代码搜索 =====
    def search_code(self, query: str, limit: int = 10,
                    symbol_type: str = "") -> List[Dict[str, Any]]:
        """搜索代码"""
        return self.search.search(query, limit, symbol_type)

    def search_by_regex(self, pattern: str, limit: int = 20) -> List[Dict[str, Any]]:
        """正则搜索"""
        return self.search.search_by_regex(pattern, limit=limit)

    def find_definition(self, name: str) -> Optional[Dict[str, Any]]:
        return self.search.find_definition(name)

    def find_references(self, name: str) -> List[Dict[str, Any]]:
        return self.search.find_references(name)

    # ===== 代码修改 =====
    def write_file(self, file_path: str, content: str) -> bool:
        """写入文件"""
        success = self.modifier.write_file(file_path, content)
        if success:
            self.reindex_file(file_path)
        return success

    def insert_code(self, file_path: str, line_number: int,
                    code: str, position: str = "after") -> bool:
        success = self.modifier.insert_code(file_path, line_number, code, position)
        if success:
            self.reindex_file(file_path)
        return success

    def replace_code(self, file_path: str, old_code: str,
                     new_code: str) -> bool:
        success = self.modifier.replace_code(file_path, old_code, new_code)
        if success:
            self.reindex_file(file_path)
        return success

    def replace_by_line(self, file_path: str, start_line: int,
                        end_line: int, new_code: str) -> bool:
        success = self.modifier.replace_by_line(file_path, start_line, end_line, new_code)
        if success:
            self.reindex_file(file_path)
        return success

    def delete_code(self, file_path: str, start_line: int, end_line: int) -> bool:
        success = self.modifier.delete_code(file_path, start_line, end_line)
        if success:
            self.reindex_file(file_path)
        return success

    def add_method_to_class(self, file_path: str, class_name: str,
                            method_code: str) -> bool:
        success = self.modifier.add_method_to_class(file_path, class_name, method_code)
        if success:
            self.reindex_file(file_path)
        return success

    def rename_symbol(self, file_path: str, old_name: str, new_name: str) -> bool:
        success = self.modifier.rename_symbol(file_path, old_name, new_name)
        if success:
            self.reindex_file(file_path)
        return success

    def batch_modify(self, modifications: List[Dict[str, Any]]) -> Dict[str, bool]:
        """批量修改"""
        results = self.modifier.batch_modify(modifications)
        for file_path, success in results.items():
            if success:
                self.reindex_file(file_path)
        return results

    # ===== 代码审查 =====
    def review_file(self, file_path: str) -> List[Dict[str, Any]]:
        return self.reviewer.review_file(file_path)

    def review_project(self, file_type: str = "python") -> Dict[str, Any]:
        return self.reviewer.review_project(file_type)

    # ===== 测试与构建 =====
    def run_tests(self, test_path: str = "") -> Dict[str, Any]:
        return self.test_runner.run_tests(test_path)

    def build_project(self) -> Dict[str, Any]:
        return self.build_verifier.build()

    def check_syntax(self, file_path: str = "") -> Dict[str, Any]:
        return self.build_verifier.check_syntax(file_path)

    def check_imports(self, module_path: str = "") -> Dict[str, Any]:
        return self.build_verifier.check_imports(module_path)

    def detect_build_system(self) -> List[str]:
        return self.build_verifier.detect_build_system()

    # ===== Git =====
    def git_status(self) -> Dict[str, Any]:
        return self.git.status()

    def git_diff(self, file_path: str = "") -> Dict[str, Any]:
        return self.git.diff(file_path)

    def git_commit(self, message: str, files: Optional[List[str]] = None) -> Dict[str, Any]:
        return self.git.commit(message, files)

    def git_branch(self, branch_name: str = "", create: bool = False) -> Dict[str, Any]:
        return self.git.branch(branch_name, create)

    def git_log(self, limit: int = 20) -> Dict[str, Any]:
        return self.git.log(limit)

    # ===== 影响分析 =====
    def analyze_impact(self, file_path: str, function_name: str = "",
                       change_type: str = "modify") -> Dict[str, Any]:
        return self.impact.analyze_change(file_path, function_name, change_type)

    def analyze_file_impact(self, file_path: str) -> Dict[str, Any]:
        return self.impact.analyze_file_change(file_path)

    def get_dependency_chain(self, function_name: str,
                              max_depth: int = 5) -> Dict[str, Any]:
        return self.impact.get_dependency_chain(function_name, max_depth)

    # ===== AI辅助接口 =====
    def get_ai_context(self, query: str = "", max_files: int = 5,
                       max_symbols: int = 10) -> Dict[str, Any]:
        """为AI生成代码理解上下文（聚合搜索结果+相关文件+符号定义）"""
        context = {
            "project_root": self.project_root,
            "project_stats": self.get_project_stats(),
            "query": query,
            "search_results": [],
            "relevant_files": [],
            "relevant_symbols": [],
            "file_tree": self.get_file_tree(),
        }
        if query:
            # 搜索相关代码
            results = self.search_code(query, limit=max_symbols)
            context["search_results"] = results
            # 收集相关文件
            file_paths = set()
            for r in results:
                if "file_path" in r:
                    file_paths.add(r["file_path"])
            for fp in list(file_paths)[:max_files]:
                code_file = self.indexer.get_file(fp)
                if code_file:
                    context["relevant_files"].append({
                        "path": fp,
                        "language": code_file.language,
                        "lines": code_file.line_count,
                        "symbols": [s.name for s in code_file.symbols.values()][:20],
                        "content_preview": code_file.content[:2000],
                    })
        return context

    def get_modification_history(self, limit: int = 20) -> List[Dict]:
        return self.modifier.get_modification_history(limit)

    def get_stats(self) -> Dict[str, Any]:
        """获取完整统计"""
        return {
            "codebase_id": self.codebase_id,
            "project_root": self.project_root,
            "indexed": self.indexer.is_indexed(),
            "project_stats": self.get_project_stats(),
            "build_systems": self.detect_build_system(),
            "git_repo": self.git.is_git_repo(),
            "current_branch": self.git.current_branch() if self.git.is_git_repo() else "",
            "modification_history_count": len(self.modifier.modification_history),
            "review_issues_count": len(self.reviewer.issues),
            "test_runs_count": len(self.test_runner.test_results),
        }
