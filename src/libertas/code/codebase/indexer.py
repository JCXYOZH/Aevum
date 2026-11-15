"""代码库模块职责：indexer。"""

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

from .models import CodeFile
from .models import CodeSymbol
from .models import ProjectStats

class ProjectIndexer:
    """项目索引引擎 - 扫描整个项目文件夹，建立文件/符号/依赖索引"""

    def __init__(self, project_root: str = "",
                 exclude_dirs: Optional[List[str]] = None,
                 exclude_patterns: Optional[List[str]] = None,
                 supported_extensions: Optional[List[str]] = None):
        self.indexer_id = f"idx_{uuid.uuid4().hex[:8]}"
        self.project_root = project_root
        self.exclude_dirs = exclude_dirs or [
            "__pycache__", ".git", ".svn", "node_modules", "venv",
            ".venv", "env", "dist", "build", ".idea", ".vscode",
            "backup", "backups", ".tox", ".mypy_cache", ".pytest_cache"
        ]
        self.exclude_patterns = exclude_patterns or ["*.pyc", "*.pyo", "*.so", "*.dll", "*.exe"]
        self.supported_extensions = supported_extensions or [
            ".py", ".js", ".ts", ".java", ".c", ".cpp", ".h", ".hpp",
            ".go", ".rs", ".rb", ".php", ".sh", ".bash", ".json", ".yaml", ".yml",
            ".toml", ".ini", ".cfg", ".md", ".txt", ".html", ".css"
        ]
        self.files: Dict[str, CodeFile] = {}
        self.symbols: Dict[str, CodeSymbol] = {}
        self.file_tree: Dict[str, Any] = {}
        self.stats = ProjectStats()
        self._lock = threading.RLock()
        self._indexed = False

    def index_project(self, project_root: str = "") -> ProjectStats:
        """索引整个项目"""
        if project_root:
            self.project_root = project_root
        if not self.project_root or not os.path.isdir(self.project_root):
            raise ValueError(f"项目路径不存在: {self.project_root}")

        start_time = time.time()
        terminal.info(f"开始索引项目: {self.project_root}", "project_indexer")

        with self._lock:
            self.files.clear()
            self.symbols.clear()
            self.file_tree = self._build_file_tree(self.project_root)

        # 扫描文件
        file_paths = self._scan_files(self.project_root)
        terminal.info(f"发现 {len(file_paths)} 个文件", "project_indexer")

        # 解析每个文件
        for file_path in file_paths:
            try:
                code_file = self._index_file(file_path)
                if code_file:
                    with self._lock:
                        self.files[file_path] = code_file
                        for symbol in code_file.symbols.values():
                            self.symbols[symbol.symbol_id] = symbol
            except Exception as e:
                terminal.warn(f"索引文件失败 {file_path}: {e}", "project_indexer")

        # 构建依赖关系
        self._build_dependencies()

        # 计算统计
        self._compute_stats(start_time)

        self._indexed = True
        terminal.info(f"项目索引完成: {self.stats.total_files} 个文件, "
                      f"{self.stats.total_symbols} 个符号, "
                      f"{self.stats.total_lines} 行代码", "project_indexer")
        return self.stats

    def _scan_files(self, root: str) -> List[str]:
        """扫描项目中的所有代码文件"""
        file_paths = []
        for dirpath, dirnames, filenames in os.walk(root):
            # 排除目录
            dirnames[:] = [d for d in dirnames if d not in self.exclude_dirs]
            for filename in filenames:
                ext = os.path.splitext(filename)[1].lower()
                if ext in self.supported_extensions:
                    # 检查排除模式
                    if not any(self._match_pattern(filename, p) for p in self.exclude_patterns):
                        file_paths.append(os.path.join(dirpath, filename))
        return sorted(file_paths)

    def _match_pattern(self, filename: str, pattern: str) -> bool:
        import fnmatch
        return fnmatch.fnmatch(filename, pattern)

    def _index_file(self, file_path: str) -> Optional[CodeFile]:
        """索引单个文件"""
        ext = os.path.splitext(file_path)[1].lower()
        language = self._ext_to_language(ext)
        code_file = CodeFile(file_path, language)
        code_file.load_content()

        if language == "python":
            self._parse_python_file(code_file)
        elif language in ("javascript", "typescript"):
            self._parse_js_file(code_file)
        elif language == "json":
            self._parse_json_file(code_file)

        return code_file

    def _ext_to_language(self, ext: str) -> str:
        mapping = {
            ".py": "python", ".js": "javascript", ".ts": "typescript",
            ".java": "java", ".c": "c", ".cpp": "cpp", ".h": "c_header",
            ".hpp": "cpp_header", ".go": "go", ".rs": "rust",
            ".rb": "ruby", ".php": "php", ".sh": "shell", ".bash": "shell",
            ".json": "json", ".yaml": "yaml", ".yml": "yaml",
            ".toml": "toml", ".ini": "ini", ".cfg": "ini",
            ".md": "markdown", ".txt": "text", ".html": "html", ".css": "css",
        }
        return mapping.get(ext, "unknown")

    def _parse_python_file(self, code_file: CodeFile):
        """解析Python文件（AST）"""
        try:
            tree = ast.parse(code_file.content)
        except SyntaxError as e:
            code_file.parse_errors.append(f"语法错误: {e}")
            return

        # 提取导入
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    code_file.imports.append({
                        "module": alias.name,
                        "alias": alias.asname or alias.name,
                        "line": node.lineno,
                    })
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                for alias in node.names:
                    code_file.imports.append({
                        "module": f"{module}.{alias.name}" if module else alias.name,
                        "alias": alias.asname or alias.name,
                        "line": node.lineno,
                        "from": True,
                    })

        # 提取类和函数
        self._extract_symbols(tree, code_file, "")

        # 计算复杂度
        code_file.complexity = self._calculate_complexity(tree)

    def _extract_symbols(self, node: ast.AST, code_file: CodeFile, parent: str):
        """递归提取符号"""
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.ClassDef):
                symbol = CodeSymbol(
                    name=child.name,
                    symbol_type="class",
                    file_path=code_file.file_path,
                    line_start=child.lineno,
                    line_end=getattr(child, 'end_lineno', child.lineno),
                    docstring=ast.get_docstring(child) or "",
                    parent=parent,
                    decorators=[ast.unparse(d) for d in child.decorator_list],
                    body_hash=hashlib.md5(ast.unparse(child).encode()).hexdigest()[:16],
                )
                # 提取方法
                self._extract_symbols(child, code_file, child.name)
                # 提取类内调用
                symbol.calls = self._extract_calls(child)
                symbol.complexity = self._calculate_complexity(child)
                code_file.symbols[symbol.symbol_id] = symbol
                code_file.classes.append(child.name)

            elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                func_type = "method" if parent else "function"
                params = [a.arg for a in child.args.args]
                return_type = ""
                if child.returns:
                    try:
                        return_type = ast.unparse(child.returns)
                    except Exception:
                        pass
                symbol = CodeSymbol(
                    name=child.name,
                    symbol_type=func_type,
                    file_path=code_file.file_path,
                    line_start=child.lineno,
                    line_end=getattr(child, 'end_lineno', child.lineno),
                    docstring=ast.get_docstring(child) or "",
                    parent=parent,
                    parameters=params,
                    return_type=return_type,
                    decorators=[ast.unparse(d) for d in child.decorator_list],
                    calls=self._extract_calls(child),
                    body_hash=hashlib.md5(ast.unparse(child).encode()).hexdigest()[:16],
                )
                symbol.complexity = self._calculate_complexity(child)
                code_file.symbols[symbol.symbol_id] = symbol
                if not parent:
                    code_file.functions.append(child.name)

    def _extract_calls(self, node: ast.AST) -> List[str]:
        """提取函数调用"""
        calls = []
        for child in ast.walk(node):
            if isinstance(child, ast.Call):
                if isinstance(child.func, ast.Name):
                    calls.append(child.func.id)
                elif isinstance(child.func, ast.Attribute):
                    calls.append(child.func.attr)
        return list(set(calls))

    def _calculate_complexity(self, node: ast.AST) -> int:
        """计算圈复杂度"""
        complexity = 1
        for child in ast.walk(node):
            if isinstance(child, (ast.If, ast.For, ast.While, ast.ExceptHandler,
                                  ast.With, ast.Assert, ast.BoolOp)):
                complexity += 1
            elif isinstance(child, ast.IfExp):
                complexity += 1
        return complexity

    def _parse_js_file(self, code_file: CodeFile):
        """解析JS/TS文件（简化版，正则匹配）"""
        # 类定义
        for match in re.finditer(r'class\s+(\w+)', code_file.content):
            symbol = CodeSymbol(
                name=match.group(1),
                symbol_type="class",
                file_path=code_file.file_path,
                line_start=code_file.content[:match.start()].count('\n') + 1,
            )
            code_file.symbols[symbol.symbol_id] = symbol
            code_file.classes.append(match.group(1))
        # 函数定义
        for match in re.finditer(r'(?:function|const|let|var)\s+(\w+)\s*(?:=\s*)?\(', code_file.content):
            symbol = CodeSymbol(
                name=match.group(1),
                symbol_type="function",
                file_path=code_file.file_path,
                line_start=code_file.content[:match.start()].count('\n') + 1,
            )
            code_file.symbols[symbol.symbol_id] = symbol
            code_file.functions.append(match.group(1))

    def _parse_json_file(self, code_file: CodeFile):
        """解析JSON文件"""
        try:
            data = json.loads(code_file.content)
            code_file.metadata["json_type"] = type(data).__name__
            if isinstance(data, dict):
                code_file.metadata["keys"] = list(data.keys())[:20]
        except json.JSONDecodeError as e:
            code_file.parse_errors.append(f"JSON解析错误: {e}")

    def _build_dependencies(self):
        """构建文件间依赖关系"""
        for file_path, code_file in self.files.items():
            for imp in code_file.imports:
                module = imp["module"]
                # 尝试匹配项目内文件
                for other_path in self.files:
                    if other_path == file_path:
                        continue
                    other_rel = os.path.relpath(other_path, self.project_root)
                    other_module = other_rel.replace(os.sep, ".").replace(".py", "")
                    if module == other_module or module.endswith("." + other_module.split(".")[-1]):
                        if other_path not in code_file.dependencies:
                            code_file.dependencies.append(other_path)
                        if file_path not in self.files[other_path].dependents:
                            self.files[other_path].dependents.append(file_path)

    def _build_file_tree(self, root: str) -> Dict[str, Any]:
        """构建文件树"""
        tree = {"name": os.path.basename(root), "type": "directory", "children": []}
        try:
            for item in sorted(os.listdir(root)):
                if item in self.exclude_dirs:
                    continue
                item_path = os.path.join(root, item)
                if os.path.isdir(item_path):
                    tree["children"].append(self._build_file_tree(item_path))
                elif os.path.isfile(item_path):
                    ext = os.path.splitext(item)[1].lower()
                    if ext in self.supported_extensions:
                        tree["children"].append({
                            "name": item,
                            "type": "file",
                            "path": item_path,
                            "extension": ext,
                        })
        except PermissionError:
            pass
        return tree

    def _compute_stats(self, start_time: float):
        """计算项目统计"""
        self.stats = ProjectStats()
        self.stats.indexed_at = time.time()
        self.stats.index_duration_ms = (time.time() - start_time) * 1000

        for file_path, code_file in self.files.items():
            self.stats.total_files += 1
            self.stats.total_lines += code_file.line_count
            self.stats.total_chars += code_file.char_count
            self.stats.total_symbols += len(code_file.symbols)
            self.stats.total_classes += len(code_file.classes)
            self.stats.total_functions += len(code_file.functions)

            lang = code_file.language
            self.stats.by_language[lang] = self.stats.by_language.get(lang, 0) + 1

            rel_dir = os.path.relpath(os.path.dirname(file_path), self.project_root)
            self.stats.by_directory[rel_dir] = self.stats.by_directory.get(rel_dir, 0) + 1

            self.stats.dependencies_count += len(code_file.dependencies)

        # 最大文件
        sorted_files = sorted(self.files.values(), key=lambda f: f.line_count, reverse=True)
        self.stats.largest_files = [
            {"path": f.file_path, "lines": f.line_count, "language": f.language}
            for f in sorted_files[:20]
        ]
        # 最复杂文件
        sorted_complex = sorted(self.files.values(), key=lambda f: f.complexity, reverse=True)
        self.stats.most_complex_files = [
            {"path": f.file_path, "complexity": f.complexity, "symbols": len(f.symbols)}
            for f in sorted_complex[:20]
        ]

    def get_file(self, file_path: str) -> Optional[CodeFile]:
        return self.files.get(file_path)

    def get_symbol(self, symbol_id: str) -> Optional[CodeSymbol]:
        return self.symbols.get(symbol_id)

    def find_symbol_by_name(self, name: str) -> List[CodeSymbol]:
        return [s for s in self.symbols.values() if s.name == name]

    def find_symbol_by_qualified_name(self, qualified_name: str) -> Optional[CodeSymbol]:
        for s in self.symbols.values():
            if s.get_qualified_name() == qualified_name:
                return s
        return None

    def list_files(self, language: str = "", directory: str = "") -> List[CodeFile]:
        files = list(self.files.values())
        if language:
            files = [f for f in files if f.language == language]
        if directory:
            files = [f for f in files if f.file_path.startswith(directory)]
        return files

    def get_file_tree(self) -> Dict[str, Any]:
        return self.file_tree

    def get_stats(self) -> ProjectStats:
        return self.stats

    def is_indexed(self) -> bool:
        return self._indexed
