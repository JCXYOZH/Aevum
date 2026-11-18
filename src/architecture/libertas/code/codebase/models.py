"""代码库模块职责：models。"""

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

class SymbolType(Enum):
    MODULE = "module"
    CLASS = "class"
    FUNCTION = "function"
    METHOD = "method"
    VARIABLE = "variable"
    IMPORT = "import"
    CONSTANT = "constant"
    PROPERTY = "property"

class ChangeType(Enum):
    INSERT = "insert"
    REPLACE = "replace"
    DELETE = "delete"
    APPEND = "append"
    PREPEND = "prepend"
    RENAME = "rename"
    REFACTOR = "refactor"

class IssueSeverity(Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"

class CodeSymbol:
    """代码符号（类/函数/方法/变量等）"""

    def __init__(self, name: str = "", symbol_type: str = "function",
                 file_path: str = "", line_start: int = 0, line_end: int = 0,
                 docstring: str = "", parent: str = "",
                 parameters: Optional[List[str]] = None,
                 return_type: str = "",
                 decorators: Optional[List[str]] = None,
                 calls: Optional[List[str]] = None,
                 called_by: Optional[List[str]] = None,
                 imports: Optional[List[str]] = None,
                 body_hash: str = ""):
        self.symbol_id = f"sym_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.symbol_type = symbol_type
        self.file_path = file_path
        self.line_start = line_start
        self.line_end = line_end
        self.docstring = docstring
        self.parent = parent
        self.parameters = parameters or []
        self.return_type = return_type
        self.decorators = decorators or []
        self.calls = calls or []          # 该符号调用的其他符号
        self.called_by = called_by or []  # 调用该符号的其他符号
        self.imports = imports or []
        self.body_hash = body_hash
        self.complexity = 0
        self.access_count = 0
        self.last_accessed = 0.0
        self.tags: List[str] = []
        self.metadata: Dict[str, Any] = {}

    def get_qualified_name(self) -> str:
        if self.parent:
            return f"{self.parent}.{self.name}"
        return self.name

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol_id": self.symbol_id,
            "name": self.name,
            "qualified_name": self.get_qualified_name(),
            "symbol_type": self.symbol_type,
            "file_path": self.file_path,
            "line_start": self.line_start,
            "line_end": self.line_end,
            "docstring": self.docstring[:200] if self.docstring else "",
            "parent": self.parent,
            "parameters": self.parameters,
            "return_type": self.return_type,
            "decorators": self.decorators,
            "calls_count": len(self.calls),
            "called_by_count": len(self.called_by),
            "complexity": self.complexity,
            "tags": self.tags,
        }

    def __repr__(self) -> str:
        return f"CodeSymbol({self.symbol_type}: {self.get_qualified_name()} @ {self.file_path}:{self.line_start})"

class CodeFile:
    """代码文件"""

    def __init__(self, file_path: str = "", language: str = "python"):
        self.file_id = f"file_{uuid.uuid4().hex[:8]}"
        self.file_path = file_path
        self.language = language
        self.content = ""
        self.lines: List[str] = []
        self.line_count = 0
        self.char_count = 0
        self.symbols: Dict[str, CodeSymbol] = {}
        self.imports: List[Dict[str, str]] = []
        self.classes: List[str] = []
        self.functions: List[str] = []
        self.dependencies: List[str] = []
        self.dependents: List[str] = []
        self.last_modified = 0.0
        self.file_hash = ""
        self.parse_errors: List[str] = []
        self.complexity = 0
        self.metadata: Dict[str, Any] = {}

    def load_content(self, content: str = ""):
        if content:
            self.content = content
        elif os.path.exists(self.file_path):
            with open(self.file_path, "r", encoding="utf-8", errors="replace") as f:
                self.content = f.read()
        self.lines = self.content.split("\n")
        self.line_count = len(self.lines)
        self.char_count = len(self.content)
        self.file_hash = hashlib.md5(self.content.encode()).hexdigest()
        if os.path.exists(self.file_path):
            self.last_modified = os.path.getmtime(self.file_path)

    def get_line(self, line_num: int) -> str:
        if 1 <= line_num <= len(self.lines):
            return self.lines[line_num - 1]
        return ""

    def get_lines(self, start: int, end: int) -> str:
        start = max(1, start)
        end = min(len(self.lines), end)
        return "\n".join(self.lines[start - 1:end])

    def get_symbol_at_line(self, line_num: int) -> Optional[CodeSymbol]:
        for symbol in self.symbols.values():
            if symbol.line_start <= line_num <= symbol.line_end:
                return symbol
        return None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "file_id": self.file_id,
            "file_path": self.file_path,
            "language": self.language,
            "line_count": self.line_count,
            "char_count": self.char_count,
            "symbols_count": len(self.symbols),
            "classes": self.classes,
            "functions": self.functions,
            "imports_count": len(self.imports),
            "dependencies": self.dependencies,
            "dependents_count": len(self.dependents),
            "file_hash": self.file_hash,
            "parse_errors": self.parse_errors,
            "complexity": self.complexity,
        }

class ProjectStats:
    """项目统计信息"""

    def __init__(self):
        self.total_files = 0
        self.total_lines = 0
        self.total_chars = 0
        self.total_symbols = 0
        self.total_classes = 0
        self.total_functions = 0
        self.by_language: Dict[str, int] = {}
        self.by_directory: Dict[str, int] = {}
        self.largest_files: List[Dict] = []
        self.most_complex_files: List[Dict] = []
        self.dependencies_count = 0
        self.circular_dependencies: List[List[str]] = []
        self.indexed_at = 0.0
        self.index_duration_ms = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_files": self.total_files,
            "total_lines": self.total_lines,
            "total_chars": self.total_chars,
            "total_symbols": self.total_symbols,
            "total_classes": self.total_classes,
            "total_functions": self.total_functions,
            "by_language": self.by_language,
            "by_directory": dict(list(self.by_directory.items())[:20]),
            "largest_files": self.largest_files[:10],
            "most_complex_files": self.most_complex_files[:10],
            "dependencies_count": self.dependencies_count,
            "circular_dependencies": self.circular_dependencies,
            "indexed_at": self.indexed_at,
            "index_duration_ms": round(self.index_duration_ms, 1),
        }
