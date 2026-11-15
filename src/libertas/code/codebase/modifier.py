"""代码库模块职责：modifier。"""

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

from .indexer import ProjectIndexer

class CodeModifier:
    """代码修改执行器 - 精确修改、整文件重写、多文件批量修改"""

    def __init__(self, indexer: ProjectIndexer):
        self.modifier_id = f"mod_{uuid.uuid4().hex[:8]}"
        self.indexer = indexer
        self.modification_history: deque = deque(maxlen=100)
        self._lock = threading.RLock()

    def read_file(self, file_path: str) -> str:
        """读取文件内容"""
        if not os.path.exists(file_path):
            return ""
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()

    def write_file(self, file_path: str, content: str,
                   backup: bool = True) -> bool:
        """写入文件（整文件重写）"""
        try:
            if backup and os.path.exists(file_path):
                backup_path = file_path + f".bak.{int(time.time())}"
                with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                    with open(backup_path, "w", encoding="utf-8") as bf:
                        bf.write(f.read())

            os.makedirs(os.path.dirname(file_path) or ".", exist_ok=True)
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(content)

            # 更新索引
            if file_path in self.indexer.files:
                code_file = self.indexer.files[file_path]
                code_file.load_content(content)

            self._record_modification(file_path, "write", content)
            return True
        except Exception as e:
            terminal.warn(f"写入文件失败 {file_path}: {e}", "code_modifier")
            return False

    def insert_code(self, file_path: str, line_number: int,
                    code: str, position: str = "after") -> bool:
        """在指定行插入代码"""
        content = self.read_file(file_path)
        if not content:
            return False
        lines = content.split("\n")
        if position == "before":
            insert_idx = line_number - 1
        else:
            insert_idx = line_number
        insert_idx = max(0, min(insert_idx, len(lines)))
        lines.insert(insert_idx, code)
        new_content = "\n".join(lines)
        return self.write_file(file_path, new_content)

    def replace_code(self, file_path: str, old_code: str,
                     new_code: str, count: int = 0) -> bool:
        """替换代码（精确匹配）"""
        content = self.read_file(file_path)
        if not content:
            return False
        if old_code not in content:
            return False
        if count > 0:
            new_content = content.replace(old_code, new_code, count)
        else:
            new_content = content.replace(old_code, new_code)
        return self.write_file(file_path, new_content)

    def replace_by_line(self, file_path: str, start_line: int,
                        end_line: int, new_code: str) -> bool:
        """按行范围替换代码"""
        content = self.read_file(file_path)
        if not content:
            return False
        lines = content.split("\n")
        start_idx = max(0, start_line - 1)
        end_idx = min(len(lines), end_line)
        new_lines = lines[:start_idx] + new_code.split("\n") + lines[end_idx:]
        return self.write_file(file_path, "\n".join(new_lines))

    def delete_code(self, file_path: str, start_line: int,
                    end_line: int) -> bool:
        """删除指定行范围的代码"""
        return self.replace_by_line(file_path, start_line, end_line, "")

    def append_to_function(self, file_path: str, function_name: str,
                           code: str) -> bool:
        """在函数末尾追加代码"""
        code_file = self.indexer.get_file(file_path)
        if not code_file:
            return False
        for symbol in code_file.symbols.values():
            if symbol.name == function_name and symbol.symbol_type in ("function", "method"):
                # 在函数最后一行前插入
                return self.insert_code(file_path, symbol.line_end - 1, code, "before")
        return False

    def add_method_to_class(self, file_path: str, class_name: str,
                            method_code: str) -> bool:
        """向类添加方法"""
        code_file = self.indexer.get_file(file_path)
        if not code_file:
            return False
        for symbol in code_file.symbols.values():
            if symbol.name == class_name and symbol.symbol_type == "class":
                # 在类末尾插入方法
                indent = "    "
                indented_code = "\n".join(indent + line if line else ""
                                          for line in method_code.split("\n"))
                return self.insert_code(file_path, symbol.line_end, indented_code, "before")
        return False

    def rename_symbol(self, file_path: str, old_name: str,
                      new_name: str) -> bool:
        """重命名符号（文件内）"""
        content = self.read_file(file_path)
        if not content:
            return False
        # 使用单词边界替换
        new_content = re.sub(rf'\b{re.escape(old_name)}\b', new_name, content)
        return self.write_file(file_path, new_content)

    def batch_modify(self, modifications: List[Dict[str, Any]]) -> Dict[str, bool]:
        """批量修改多个文件"""
        results = {}
        for mod in modifications:
            file_path = mod.get("file_path", "")
            action = mod.get("action", "")
            success = False
            if action == "write":
                success = self.write_file(file_path, mod.get("content", ""))
            elif action == "replace":
                success = self.replace_code(file_path, mod.get("old", ""), mod.get("new", ""))
            elif action == "insert":
                success = self.insert_code(file_path, mod.get("line", 1),
                                           mod.get("code", ""), mod.get("position", "after"))
            elif action == "delete":
                success = self.delete_code(file_path, mod.get("start_line", 1),
                                          mod.get("end_line", 1))
            results[file_path] = success
        return results

    def get_modification_history(self, limit: int = 20) -> List[Dict]:
        return list(reversed(self.modification_history))[-limit:]

    def _record_modification(self, file_path: str, action: str, content: str):
        self.modification_history.append({
            "file_path": file_path,
            "action": action,
            "content_hash": hashlib.md5(content.encode()).hexdigest(),
            "timestamp": time.time(),
            "content_length": len(content),
        })
