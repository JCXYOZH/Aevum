"""代码库模块职责：refactor。"""

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

class CrossFileRefactorer:
    """跨文件重构器 - 支持重命名、移动、提取等跨文件重构操作"""

    def __init__(self, codebase):
        self.codebase = codebase
        self.change_log: List[Dict[str, Any]] = []

    def rename_symbol(self, old_name: str, new_name: str,
                      symbol_type: str = "function") -> Dict[str, Any]:
        """跨文件重命名符号"""
        if not self.codebase.indexer:
            return {"success": False, "error": "索引器未初始化"}
        # 查找所有引用
        references = []
        for file_path, code_file in self.codebase.indexer.files.items():
            content = code_file.content if hasattr(code_file, 'content') else ""
            if old_name in content:
                # 统计出现次数
                count = content.count(old_name)
                references.append({"file_path": file_path, "occurrences": count})
        if not references:
            return {"success": False, "error": f"未找到符号 {old_name} 的引用"}
        # 执行重命名
        modified_files = []
        for ref in references:
            file_path = ref["file_path"]
            code_file = self.codebase.indexer.files.get(file_path)
            if not code_file:
                continue
            content = code_file.content if hasattr(code_file, 'content') else ""
            new_content = content.replace(old_name, new_name)
            # 写入文件
            success = self.codebase.write_file(file_path, new_content)
            if success:
                modified_files.append(file_path)
                self.change_log.append({
                    "action": "rename_symbol",
                    "file_path": file_path,
                    "old_name": old_name,
                    "new_name": new_name,
                    "occurrences": ref["occurrences"],
                })
        return {
            "success": True,
            "old_name": old_name,
            "new_name": new_name,
            "files_modified": len(modified_files),
            "modified_files": modified_files,
            "total_occurrences": sum(r["occurrences"] for r in references),
        }

    def move_function(self, function_name: str, source_file: str,
                      target_file: str) -> Dict[str, Any]:
        """将函数从一个文件移动到另一个文件"""
        # 获取函数源码
        func_context = self.codebase.get_function_context(function_name)
        if not func_context or not func_context.get("success"):
            return {"success": False, "error": f"未找到函数 {function_name}"}
        func_code = func_context.get("source_code", "")
        if not func_code:
            return {"success": False, "error": "无法获取函数源码"}
        # 从源文件删除
        source_content = self.codebase.read_file(source_file)
        if source_content:
            new_source = source_content.replace(func_code, "")
            self.codebase.write_file(source_file, new_source)
        # 添加到目标文件
        target_content = self.codebase.read_file(target_file) or ""
        new_target = target_content.rstrip() + "\n\n" + func_code + "\n"
        self.codebase.write_file(target_file, new_target)
        self.change_log.append({
            "action": "move_function",
            "function_name": function_name,
            "source_file": source_file,
            "target_file": target_file,
        })
        return {
            "success": True,
            "function_name": function_name,
            "source_file": source_file,
            "target_file": target_file,
        }

    def extract_interface(self, class_name: str, file_path: str) -> Dict[str, Any]:
        """从类提取接口定义（抽象基类）"""
        class_context = self.codebase.get_class_context(class_name)
        if not class_context or not class_context.get("success"):
            return {"success": False, "error": f"未找到类 {class_name}"}
        methods = class_context.get("methods", [])
        interface_code = f"from abc import ABC, abstractmethod\n\n\nclass {class_name}Interface(ABC):\n"
        interface_code += f'    """{class_name}的接口定义"""'
        for method in methods:
            mname = method.get("name", "")
            params = method.get("parameters", [])
            param_str = ", ".join(["self"] + [p if isinstance(p, str) else p.get("name", "") for p in params])
            interface_code += f"\n\n    @abstractmethod\n    def {mname}({param_str}):\n"
            interface_code += f'        """{mname}方法"""'
            interface_code += "\n        pass\n"
        # 写入接口文件
        interface_path = file_path.replace(".py", "_interface.py")
        self.codebase.write_file(interface_path, interface_code)
        self.change_log.append({
            "action": "extract_interface",
            "class_name": class_name,
            "interface_file": interface_path,
            "methods_extracted": len(methods),
        })
        return {
            "success": True,
            "class_name": class_name,
            "interface_file": interface_path,
            "methods_extracted": len(methods),
            "interface_code": interface_code,
        }

    def get_change_log(self) -> List[Dict[str, Any]]:
        """获取重构变更日志"""
        return self.change_log

    def undo_last(self) -> Dict[str, Any]:
        """撤销最后一次重构（简化实现）"""
        if not self.change_log:
            return {"success": False, "error": "没有可撤销的变更"}
        last = self.change_log.pop()
        return {"success": True, "undone": last, "note": "简化实现，建议使用Git进行完整版本控制"}
