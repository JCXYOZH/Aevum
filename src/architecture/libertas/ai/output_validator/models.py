"""输出校验职责：models。"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from libertas.foundation.config import get_data_dir


class ValidationRuleType(Enum):
    FORMAT = "format"
    CONTENT = "content"
    LENGTH = "length"
    STRUCTURE = "structure"
    SAFETY = "safety"
    CUSTOM = "custom"

class ValidationResult:
    """校验结果"""

    def __init__(self, output: str = ""):
        self.output = output
        self.valid = True
        self.errors: List[Dict[str, Any]] = []
        self.warnings: List[Dict[str, Any]] = []
        self.fixes_applied: List[str] = []
        self.original_output = output
        self.validated_output = output
        self.validation_time_ms = 0.0
        self.rules_checked = 0
        self.rules_passed = 0
        self.rules_failed = 0

        # 0.1.5版本的扩展字段
        self.empty = False
        self.refused = False
        self.refusal_type = ""  # search / tool / general
        self.dsml_leaked = False
        self.dsml_tags: List[str] = []
        self.fabricated_urls: List[str] = []
        self.tool_tags: List[str] = []
        self.search_tags: List[str] = []
        self.file_tags: List[str] = []
        self.issues: List[str] = []
        self.fixable = False
        self.fix_action = ""  # retry / force_search / force_tool / strip_tags / replace_urls

    def add_error(self, rule: str, message: str, severity: str = "error"):
        self.errors.append({"rule": rule, "message": message, "severity": severity})
        self.valid = False

    def add_warning(self, rule: str, message: str):
        self.warnings.append({"rule": rule, "message": message})

    def add_fix(self, fix: str):
        self.fixes_applied.append(fix)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "valid": self.valid,
            "errors": self.errors,
            "warnings": self.warnings,
            "fixes_applied": self.fixes_applied,
            "original_length": len(self.original_output),
            "validated_length": len(self.validated_output),
            "validation_time_ms": round(self.validation_time_ms, 2),
            "rules_checked": self.rules_checked,
            "rules_passed": self.rules_passed,
            "rules_failed": self.rules_failed,
            # 0.1.5版本的扩展字段
            "empty": self.empty,
            "refused": self.refused,
            "refusal_type": self.refusal_type,
            "dsml_leaked": self.dsml_leaked,
            "dsml_tags": self.dsml_tags,
            "fabricated_urls": self.fabricated_urls,
            "issues": self.issues,
            "fixable": self.fixable,
            "fix_action": self.fix_action,
        }

class ValidationRule:
    """校验规则"""

    def __init__(self, name: str = "", rule_type: str = "custom",
                 description: str = "", enabled: bool = True,
                 severity: str = "error",  # error / warning / info
                 auto_fix: bool = False,
                 pattern: str = "",
                 min_length: int = 0,
                 max_length: int = 0,
                 required_fields: Optional[List[str]] = None,
                 custom_validator: Optional[Callable] = None):
        self.rule_id = f"vrule_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.rule_type = rule_type
        self.description = description
        self.enabled = enabled
        self.severity = severity
        self.auto_fix = auto_fix
        self.pattern = pattern
        self.min_length = min_length
        self.max_length = max_length
        self.required_fields = required_fields or []
        self.custom_validator = custom_validator
        self.trigger_count = 0
        self.failure_count = 0
        self.created_at = time.time()

    def validate(self, output: str, result: ValidationResult) -> Tuple[bool, str]:
        """执行校验，返回(是否通过, 修复后的输出)"""
        if not self.enabled:
            return True, output

        self.trigger_count += 1
        fixed_output = output

        try:
            if self.rule_type == "format":
                passed, fixed_output = self._validate_format(output)
            elif self.rule_type == "content":
                passed, fixed_output = self._validate_content(output)
            elif self.rule_type == "length":
                passed, fixed_output = self._validate_length(output)
            elif self.rule_type == "structure":
                passed, fixed_output = self._validate_structure(output)
            elif self.rule_type == "safety":
                passed, fixed_output = self._validate_safety(output)
            elif self.rule_type == "custom" and self.custom_validator:
                passed, fixed_output = self.custom_validator(output)
            else:
                passed = True

            if not passed:
                self.failure_count += 1
                if self.severity == "error":
                    result.add_error(self.name, self.description, self.severity)
                else:
                    result.add_warning(self.name, self.description)
                if self.auto_fix and fixed_output != output:
                    result.add_fix(f"{self.name}: 自动修复已应用")
            return passed, fixed_output

        except Exception as e:
            result.add_error(self.name, f"校验异常: {e}", "error")
            return False, output

    def _validate_format(self, output: str) -> Tuple[bool, str]:
        if self.pattern:
            try:
                if re.search(self.pattern, output, re.IGNORECASE):
                    return True, output
                return False, output
            except re.error:
                return True, output
        return True, output

    def _validate_content(self, output: str) -> Tuple[bool, str]:
        if self.pattern:
            try:
                matches = re.findall(self.pattern, output, re.IGNORECASE)
                if matches:
                    if self.auto_fix:
                        fixed = re.sub(self.pattern, "***", output, flags=re.IGNORECASE)
                        return False, fixed
                    return False, output
            except re.error:
                pass
        return True, output

    def _validate_length(self, output: str) -> Tuple[bool, str]:
        if self.min_length > 0 and len(output) < self.min_length:
            return False, output
        if self.max_length > 0 and len(output) > self.max_length:
            if self.auto_fix:
                return False, output[:self.max_length]
            return False, output
        return True, output

    def _validate_structure(self, output: str) -> Tuple[bool, str]:
        if self.required_fields:
            try:
                data = json.loads(output)
                if isinstance(data, dict):
                    missing = [f for f in self.required_fields if f not in data]
                    if missing:
                        return False, output
            except (json.JSONDecodeError, TypeError):
                return False, output
        return True, output

    def _validate_safety(self, output: str) -> Tuple[bool, str]:
        """安全校验（增强版：更多敏感信息模式）"""
        sensitive_patterns = [
            (r'(?:password|passwd|pwd)\s*[:=]\s*\S+', "密码泄露"),
            (r'(?:api[_-]?key|secret)\s*[:=]\s*\S+', "API密钥泄露"),
            (r'(?:token|access[_-]?token)\s*[:=]\s*\S+', "Token泄露"),
            (r'(?:private[_-]?key|ssh[_-]?key)\s*[:=]\s*\S+', "私钥泄露"),
            (r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', "IP地址"),
            (r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', "邮箱地址"),
            (r'\b1[3-9]\d{9}\b', "手机号"),
            (r'(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+', "认证头泄露"),
        ]
        for pattern, desc in sensitive_patterns:
            if re.search(pattern, output, re.IGNORECASE):
                if self.auto_fix:
                    fixed = re.sub(pattern, r'[已脱敏]', output, flags=re.IGNORECASE)
                    return False, fixed
                return False, output
        return True, output

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "name": self.name,
            "rule_type": self.rule_type,
            "description": self.description,
            "enabled": self.enabled,
            "severity": self.severity,
            "auto_fix": self.auto_fix,
            "pattern": self.pattern,
            "min_length": self.min_length,
            "max_length": self.max_length,
            "required_fields": self.required_fields,
            "trigger_count": self.trigger_count,
            "failure_count": self.failure_count,
        }
