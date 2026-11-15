"""代码库模块职责：impact。"""

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

from .analyzer import CodeAnalyzer
from .indexer import ProjectIndexer

class ImpactAnalyzer:
    """变更影响分析 - 修改函数后分析调用方影响范围"""

    def __init__(self, indexer: ProjectIndexer, analyzer: CodeAnalyzer):
        self.analyzer_id = f"impact_{uuid.uuid4().hex[:8]}"
        self.indexer = indexer
        self.analyzer = analyzer

    def analyze_change(self, file_path: str, function_name: str = "",
                       change_type: str = "modify") -> Dict[str, Any]:
        """分析变更影响"""
        impact = {
            "changed_file": file_path,
            "changed_function": function_name,
            "change_type": change_type,
            "direct_callers": [],
            "indirect_callers": [],
            "affected_files": [],
            "affected_tests": [],
            "risk_level": "low",
            "recommendations": [],
        }

        # 直接调用者
        if function_name:
            callers = self.analyzer.get_callers(function_name)
            impact["direct_callers"] = [
                {"name": c.get_qualified_name(), "file": c.file_path, "line": c.line_start}
                for c in callers
            ]

            # 间接调用者（调用者的调用者）
            indirect = set()
            for caller in callers:
                caller_callers = self.analyzer.get_callers(caller.name)
                for cc in caller_callers:
                    if cc.get_qualified_name() != function_name:
                        indirect.add(cc.get_qualified_name())
            impact["indirect_callers"] = list(indirect)

        # 受影响文件
        affected_files = set()
        affected_files.add(file_path)
        for caller in impact["direct_callers"]:
            affected_files.add(caller["file"])
        impact["affected_files"] = list(affected_files)

        # 受影响测试
        for f in affected_files:
            if "test" in f.lower() or "spec" in f.lower():
                impact["affected_tests"].append(f)

        # 风险等级
        caller_count = len(impact["direct_callers"]) + len(impact["indirect_callers"])
        if caller_count > 20:
            impact["risk_level"] = "critical"
        elif caller_count > 10:
            impact["risk_level"] = "high"
        elif caller_count > 5:
            impact["risk_level"] = "medium"

        # 建议
        if impact["risk_level"] in ("high", "critical"):
            impact["recommendations"].append("建议先运行完整测试套件")
            impact["recommendations"].append("建议创建新分支进行修改")
        if impact["affected_tests"]:
            impact["recommendations"].append(f"需要更新 {len(impact['affected_tests'])} 个测试文件")
        if change_type == "delete":
            impact["recommendations"].append("删除前确认没有其他模块依赖此函数")

        return impact

    def analyze_file_change(self, file_path: str) -> Dict[str, Any]:
        """分析文件变更影响（所有导出符号）"""
        code_file = self.indexer.get_file(file_path)
        if not code_file:
            return {"error": f"文件不存在: {file_path}"}

        all_impacts = []
        for symbol in code_file.symbols.values():
            if symbol.symbol_type in ("function", "class", "method"):
                impact = self.analyze_change(file_path, symbol.name)
                all_impacts.append(impact)

        return {
            "file": file_path,
            "symbols_analyzed": len(all_impacts),
            "total_direct_callers": sum(len(i["direct_callers"]) for i in all_impacts),
            "total_affected_files": len(set(f for i in all_impacts for f in i["affected_files"])),
            "highest_risk": max((i["risk_level"] for i in all_impacts), default="low"),
            "impacts": all_impacts,
        }

    def get_dependency_chain(self, function_name: str,
                              max_depth: int = 5) -> Dict[str, Any]:
        """获取依赖调用链"""
        chain = {"function": function_name, "depth": 0, "callees": []}
        visited = set()

        def build_chain(name, depth):
            if depth > max_depth or name in visited:
                return {"function": name, "depth": depth, "truncated": True}
            visited.add(name)
            callees = self.analyzer.get_callees(name)
            node = {"function": name, "depth": depth, "callees": []}
            for callee in callees[:10]:  # 限制每个节点的子节点数
                node["callees"].append(build_chain(callee, depth + 1))
            return node

        return build_chain(function_name, 0)
