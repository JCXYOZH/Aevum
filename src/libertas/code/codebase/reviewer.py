"""代码库模块职责：reviewer。"""

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
from .indexer import ProjectIndexer

class CodeReviewer:
    """代码审查与Bug检测 - 静态检查、安全扫描、规范检查"""

    def __init__(self, indexer: ProjectIndexer):
        self.reviewer_id = f"rev_{uuid.uuid4().hex[:8]}"
        self.indexer = indexer
        self.issues: List[Dict[str, Any]] = []
        self._lock = threading.RLock()

    def review_file(self, file_path: str) -> List[Dict[str, Any]]:
        """审查单个文件"""
        code_file = self.indexer.get_file(file_path)
        if not code_file:
            return [{"error": f"文件不存在: {file_path}"}]

        issues = []
        content = code_file.content
        lines = code_file.lines

        # 1. Python语法检查
        if code_file.language == "python":
            issues.extend(self._check_python_syntax(code_file))
            issues.extend(self._check_python_security(content, lines))
            issues.extend(self._check_python_style(content, lines))

        # 2. 通用检查
        issues.extend(self._check_generic(content, lines, file_path))

        # 3. 复杂度检查
        if code_file.complexity > 50:
            issues.append({
                "severity": "medium",
                "type": "high_complexity",
                "file": file_path,
                "line": 0,
                "message": f"文件圈复杂度过高 ({code_file.complexity})，建议重构",
            })

        # 安全/风格检查产出的 issue 里 file 字段是空的（只有 _check_generic 填了），
        # 界面因此没法显示「哪个文件第几行」。这里统一补上。
        for _it in issues:
            if not _it.get("file"):
                _it["file"] = file_path

        with self._lock:
            self.issues.extend(issues)
        return issues

    def review_project(self, file_type: str = "python") -> Dict[str, Any]:
        """审查整个项目"""
        all_issues = []
        files_reviewed = 0
        for file_path, code_file in self.indexer.files.items():
            if file_type and code_file.language != file_type:
                continue
            issues = self.review_file(file_path)
            all_issues.extend(issues)
            files_reviewed += 1

        # 按严重程度统计
        severity_counts = Counter(i.get("severity", "info") for i in all_issues)
        type_counts = Counter(i.get("type", "unknown") for i in all_issues)

        return {
            "files_reviewed": files_reviewed,
            "total_issues": len(all_issues),
            "by_severity": dict(severity_counts),
            "by_type": dict(type_counts.most_common(20)),
            "critical_issues": [i for i in all_issues if i.get("severity") == "critical"],
            "high_issues": [i for i in all_issues if i.get("severity") == "high"],
            "issues": all_issues[:100],
        }

    def _check_python_syntax(self, code_file: CodeFile) -> List[Dict]:
        issues = []
        try:
            ast.parse(code_file.content)
        except SyntaxError as e:
            issues.append({
                "severity": "critical",
                "type": "syntax_error",
                "file": code_file.file_path,
                "line": e.lineno or 0,
                "message": f"语法错误: {e.msg}",
            })
        return issues

    def _check_python_security(self, content: str, lines: List[str]) -> List[Dict]:
        issues = []
        # eval使用
        for i, line in enumerate(lines, 1):
            if re.search(r'\beval\s*\(', line) and '#' not in line.split('eval')[0]:
                issues.append({
                    "severity": "high",
                    "type": "use_of_eval",
                    "file": "",
                    "line": i,
                    "message": "使用eval()可能导致代码注入漏洞",
                })
            # exec使用
            if re.search(r'\bexec\s*\(', line):
                issues.append({
                    "severity": "high",
                    "type": "use_of_exec",
                    "file": "",
                    "line": i,
                    "message": "使用exec()可能导致代码注入漏洞",
                })
            # 硬编码密码
            if re.search(r'(password|passwd|secret|api_key|token)\s*=\s*["\'][^"\']{6,}["\']',
                        line, re.IGNORECASE):
                issues.append({
                    "severity": "high",
                    "type": "hardcoded_secret",
                    "file": "",
                    "line": i,
                    "message": "检测到硬编码的密钥/密码",
                })
            # shell=True
            if re.search(r'shell\s*=\s*True', line):
                issues.append({
                    "severity": "medium",
                    "type": "shell_injection_risk",
                    "file": "",
                    "line": i,
                    "message": "subprocess使用shell=True可能导致命令注入",
                })
        return issues

    def _check_python_style(self, content: str, lines: List[str]) -> List[Dict]:
        issues = []
        for i, line in enumerate(lines, 1):
            # 行过长
            if len(line) > 120:
                issues.append({
                    "severity": "low",
                    "type": "line_too_long",
                    "file": "",
                    "line": i,
                    "message": f"行过长 ({len(line)}字符)，建议不超过120字符",
                })
            # TODO/FIXME
            if re.search(r'#\s*(TODO|FIXME|XXX|HACK)', line):
                issues.append({
                    "severity": "info",
                    "type": "todo_comment",
                    "file": "",
                    "line": i,
                    "message": "待办事项注释",
                })
        return issues

    def _check_generic(self, content: str, lines: List[str],
                       file_path: str) -> List[Dict]:
        issues = []
        # 空文件
        if not content.strip():
            issues.append({
                "severity": "info",
                "type": "empty_file",
                "file": file_path,
                "line": 0,
                "message": "文件为空",
            })
        # 文件过大
        if len(lines) > 2000:
            issues.append({
                "severity": "medium",
                "type": "file_too_large",
                "file": file_path,
                "line": 0,
                "message": f"文件过大 ({len(lines)}行)，建议拆分",
            })
        return issues

    def get_issues(self, severity: str = "", file_path: str = "") -> List[Dict]:
        issues = self.issues
        if severity:
            issues = [i for i in issues if i.get("severity") == severity]
        if file_path:
            issues = [i for i in issues if i.get("file") == file_path]
        return issues
