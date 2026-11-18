"""代码库模块职责：git。"""

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

class GitIntegration:
    """Git版本控制集成 - diff/commit/branch/checkout/log/status"""

    def __init__(self, project_root: str = ""):
        self.git_id = f"git_{uuid.uuid4().hex[:8]}"
        self.project_root = project_root

    def _run_git(self, args: str, timeout: int = 60) -> Dict[str, Any]:
        cmd = f"git {args}"
        try:
            proc = subprocess.run(
                cmd, shell=True, capture_output=True, text=True,
                cwd=self.project_root or ".", timeout=timeout,
                encoding='utf-8', errors='replace'
            )
            return {
                "command": cmd,
                "return_code": proc.returncode,
                "stdout": proc.stdout,
                "stderr": proc.stderr,
                "success": proc.returncode == 0,
            }
        except Exception as e:
            return {"command": cmd, "return_code": -1, "stdout": "",
                    "stderr": str(e), "success": False}

    def status(self) -> Dict[str, Any]:
        """获取Git状态"""
        result = self._run_git("status --porcelain")
        files = []
        if result["success"]:
            for line in result["stdout"].strip().split("\n"):
                if line:
                    status_code = line[:2]
                    file_path = line[3:].strip()
                    files.append({"status": status_code, "file": file_path})
        return {"success": result["success"], "files": files,
                "raw": result["stdout"]}

    def diff(self, file_path: str = "", staged: bool = False) -> Dict[str, Any]:
        """获取diff"""
        args = "diff --cached" if staged else "diff"
        if file_path:
            args += f" {file_path}"
        result = self._run_git(args)
        return {"success": result["success"], "diff": result["stdout"],
                "raw": result["stdout"]}

    def commit(self, message: str, files: Optional[List[str]] = None) -> Dict[str, Any]:
        """提交代码"""
        if files:
            add_result = self._run_git(f"add {' '.join(files)}")
            if not add_result["success"]:
                return add_result
        else:
            self._run_git("add -A")
        return self._run_git(f'commit -m "{message}"')

    def branch(self, branch_name: str = "", create: bool = False,
               delete: bool = False) -> Dict[str, Any]:
        """分支操作"""
        if create and branch_name:
            return self._run_git(f"checkout -b {branch_name}")
        if delete and branch_name:
            return self._run_git(f"branch -d {branch_name}")
        if branch_name:
            return self._run_git(f"checkout {branch_name}")
        result = self._run_git("branch -a")
        branches = [l.strip().lstrip("* ").strip() for l in result["stdout"].split("\n") if l.strip()]
        return {"success": result["success"], "branches": branches}

    def log(self, limit: int = 20) -> Dict[str, Any]:
        """获取提交日志"""
        result = self._run_git(f'log --oneline -{limit}')
        commits = []
        if result["success"]:
            for line in result["stdout"].strip().split("\n"):
                if line:
                    parts = line.split(" ", 1)
                    commits.append({"hash": parts[0], "message": parts[1] if len(parts) > 1 else ""})
        return {"success": result["success"], "commits": commits}

    def current_branch(self) -> str:
        result = self._run_git("rev-parse --abbrev-ref HEAD")
        return result["stdout"].strip() if result["success"] else "unknown"

    def is_git_repo(self) -> bool:
        result = self._run_git("rev-parse --is-inside-work-tree")
        return result["success"] and result["stdout"].strip() == "true"
