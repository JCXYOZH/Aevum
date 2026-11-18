"""代码库模块职责：patch。"""

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

class CodePatchApplier:
    """代码补丁应用器 - 生成diff补丁、应用补丁、回滚补丁"""

    def __init__(self, codebase):
        self.codebase = codebase
        self.patch_history = []

    def generate_patch(self, file_path, old_code, new_code):
        import difflib
        current_content = self.codebase.read_file(file_path)
        if current_content is None:
            return {"success": False, "error": f"文件不存在: {file_path}"}
        if old_code not in current_content:
            return {"success": False, "error": "未找到要替换的代码"}
        old_lines = old_code.splitlines(keepends=True)
        new_lines = new_code.splitlines(keepends=True)
        diff = difflib.unified_diff(
            old_lines, new_lines,
            fromfile=f"a/{file_path}",
            tofile=f"b/{file_path}",
            lineterm=""
        )
        patch_text = "\n".join(diff)
        patch_id = f"patch_{uuid.uuid4().hex[:8]}"
        return {
            "success": True,
            "patch_id": patch_id,
            "file_path": file_path,
            "patch": patch_text,
            "old_code": old_code,
            "new_code": new_code,
        }

    def apply_patch(self, patch):
        file_path = patch.get("file_path")
        old_code = patch.get("old_code")
        new_code = patch.get("new_code")
        if not file_path or not old_code or not new_code:
            return {"success": False, "error": "补丁数据不完整"}
        current_content = self.codebase.read_file(file_path)
        if current_content is None:
            return {"success": False, "error": f"文件不存在: {file_path}"}
        if old_code not in current_content:
            return {"success": False, "error": "补丁上下文不匹配，可能文件已被修改"}
        new_content = current_content.replace(old_code, new_code, 1)
        success = self.codebase.write_file(file_path, new_content)
        if not success:
            return {"success": False, "error": "写入文件失败"}
        patch["applied_at"] = time.time()
        patch["success"] = True
        self.patch_history.append(patch)
        return {"success": True, "patch_id": patch.get("patch_id", ""), "file_path": file_path}

    def rollback_patch(self, patch_id):
        for patch in reversed(self.patch_history):
            if patch.get("patch_id") == patch_id:
                file_path = patch["file_path"]
                current_content = self.codebase.read_file(file_path)
                if current_content is None:
                    return {"success": False, "error": "文件不存在"}
                if patch["new_code"] not in current_content:
                    return {"success": False, "error": "补丁内容不匹配，无法回滚"}
                restored = current_content.replace(patch["new_code"], patch["old_code"], 1)
                success = self.codebase.write_file(file_path, restored)
                if success:
                    patch["rolled_back_at"] = time.time()
                    return {"success": True, "patch_id": patch_id, "file_path": file_path}
                return {"success": False, "error": "写入失败"}
        return {"success": False, "error": "未找到补丁"}

    def apply_multi_file_patch(self, patches):
        applied = []
        for patch in patches:
            result = self.apply_patch(patch)
            if result["success"]:
                applied.append(result)
            else:
                for a in reversed(applied):
                    self.rollback_patch(a["patch_id"])
                return {"success": False, "error": f"应用失败: {result['error']}", "failed_patch": patch}
        return {"success": True, "applied_count": len(applied), "patches": applied}

    def get_patch_history(self, limit=20):
        return self.patch_history[-limit:]

    def preview_patch(self, patch):
        return patch.get("patch", "无补丁内容")
