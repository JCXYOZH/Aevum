"""输出校验职责：core。"""

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

from .models import ValidationResult
from .models import ValidationRule
from .constants import _DSML_TAG_RE
from .constants import _EMPTY_PATTERNS
from .constants import _FILE_TAG_RE
from .constants import _KNOWN_CONTROL_TAGS
from .constants import _REFUSAL_PATTERNS
from .constants import _SEARCH_TAG_RE
from .constants import _TOOL_TAG_RE
from .constants import _URL_RE
from .sanitizer import _domain_match
from .sanitizer import _is_known_official_url
from .sanitizer import clean_malformed_urls
from .sanitizer import strip_dsml_tags

class OutputValidator:
    """输出校验层（结合0.1.5版本的实用检测和现在版本的规则化校验）"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "output_validation")
        os.makedirs(self.data_dir, exist_ok=True)
        self._rules: Dict[str, ValidationRule] = {}
        self._validation_history: List[ValidationResult] = []
        self._lock = threading.RLock()
        self._auto_fix_enabled = True
        self._strict_mode = False
        self._init_default_rules()
        self._load()

    def _init_default_rules(self):
        defaults = [
            ValidationRule("json_valid", "format", "输出必须是有效的JSON",
                          severity="error", auto_fix=False,
                          custom_validator=self._validate_json),
            ValidationRule("max_length", "length", "输出长度不超过10000字符",
                          severity="warning", auto_fix=True, max_length=10000),
            ValidationRule("min_length", "length", "输出长度至少10字符",
                          severity="warning", auto_fix=False, min_length=10),
            ValidationRule("no_sensitive_info", "safety", "不包含敏感信息",
                          severity="error", auto_fix=True),
            ValidationRule("no_empty_output", "content", "输出不能为空",
                          severity="error", auto_fix=False,
                          custom_validator=lambda o: (len(o.strip()) > 0, o)),
            ValidationRule("no_profanity", "content", "不包含不当用语",
                          severity="warning", auto_fix=True,
                          pattern=r"(?:混蛋|该死|他妈的|fuck|shit|damn)"),
            # 0.1.5版本的检测规则
            ValidationRule("no_refusal", "custom", "不包含拒绝回答",
                          severity="error", auto_fix=False,
                          custom_validator=self._validate_no_refusal),
            ValidationRule("no_dsml_leak", "custom", "不包含未知DSML标签泄漏",
                          severity="warning", auto_fix=True,
                          custom_validator=self._validate_no_dsml_leak),
            ValidationRule("clean_urls", "custom", "清理畸形URL",
                          severity="info", auto_fix=True,
                          custom_validator=self._validate_clean_urls),
        ]
        for rule in defaults:
            self._rules[rule.name] = rule

    def _validate_json(self, output: str) -> Tuple[bool, str]:
        """校验JSON格式"""
        stripped = output.strip()
        if not stripped:
            return False, output
        try:
            json.loads(stripped)
            return True, output
        except json.JSONDecodeError:
            match = re.search(r'\{[\s\S]*\}|\[[\s\S]*\]', stripped)
            if match:
                try:
                    json.loads(match.group())
                    return True, match.group()
                except json.JSONDecodeError:
                    pass
            return False, output

    def _validate_no_refusal(self, output: str) -> Tuple[bool, str]:
        """校验不包含拒绝回答（0.1.5版本的设计）"""
        for pat in _REFUSAL_PATTERNS:
            if pat.search(output):
                return False, output
        return True, output

    def _validate_no_dsml_leak(self, output: str) -> Tuple[bool, str]:
        """校验不包含未知DSML标签泄漏（0.1.5版本的设计）"""
        all_tags = _DSML_TAG_RE.findall(output)
        unknown_tags = [t for t in all_tags if t not in _KNOWN_CONTROL_TAGS]
        if unknown_tags:
            if self._auto_fix_enabled:
                cleaned, _ = strip_dsml_tags(output)
                return False, cleaned
            return False, output
        return True, output

    def _validate_clean_urls(self, output: str) -> Tuple[bool, str]:
        """清理畸形URL（0.1.5版本的设计）"""
        if 'xn--' in output:
            cleaned = clean_malformed_urls(output)
            if cleaned != output:
                return False, cleaned
        return True, output

    def _load(self):
        rules_file = os.path.join(self.data_dir, "validation_rules.json")
        try:
            if os.path.exists(rules_file):
                with open(rules_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for r_data in data.get("rules", []):
                    rule = ValidationRule(
                        name=r_data.get("name", ""),
                        rule_type=r_data.get("rule_type", "custom"),
                        description=r_data.get("description", ""),
                        enabled=r_data.get("enabled", True),
                        severity=r_data.get("severity", "error"),
                        auto_fix=r_data.get("auto_fix", False),
                        pattern=r_data.get("pattern", ""),
                        min_length=r_data.get("min_length", 0),
                        max_length=r_data.get("max_length", 0),
                        required_fields=r_data.get("required_fields", []),
                    )
                    self._rules[rule.name] = rule
        except Exception as e:
            terminal.warn(f"加载校验规则失败: {e}", "output_validator")

    def _save(self):
        rules_file = os.path.join(self.data_dir, "validation_rules.json")
        try:
            data = {
                "version": "2.0", "updated_at": time.time(),
                "rules": [r.to_dict() for r in self._rules.values()],
            }
            with open(rules_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    # ================================================================
    # 规则管理
    # ================================================================
    def add_rule(self, rule: ValidationRule) -> str:
        with self._lock:
            self._rules[rule.name] = rule
            self._save()
        return rule.name

    def remove_rule(self, name: str) -> bool:
        with self._lock:
            if name in self._rules:
                del self._rules[name]
                self._save()
                return True
        return False

    def enable_rule(self, name: str) -> bool:
        rule = self._rules.get(name)
        if rule:
            rule.enabled = True
            self._save()
            return True
        return False

    def disable_rule(self, name: str) -> bool:
        rule = self._rules.get(name)
        if rule:
            rule.enabled = False
            self._save()
            return True
        return False

    def list_rules(self, rule_type: str = "", enabled_only: bool = False) -> List[ValidationRule]:
        rules = list(self._rules.values())
        if rule_type:
            rules = [r for r in rules if r.rule_type == rule_type]
        if enabled_only:
            rules = [r for r in rules if r.enabled]
        return sorted(rules, key=lambda r: r.name)

    # ================================================================
    # 校验执行
    # ================================================================
    def validate(self, output: str, rule_names: Optional[List[str]] = None,
                 auto_fix: Optional[bool] = None,
                 search_results_urls: Optional[List[str]] = None,
                 expect_tool: bool = False,
                 expect_search: bool = False) -> ValidationResult:
        """校验输出（结合0.1.5版本的实用检测）"""
        start = time.time()
        result = ValidationResult(output)
        current_output = output

        # 0.1.5版本的快速检测
        self._quick_detection(output, result, search_results_urls, expect_tool, expect_search)

        # 规则化校验
        rules_to_check = []
        if rule_names:
            rules_to_check = [self._rules[n] for n in rule_names if n in self._rules]
        else:
            rules_to_check = [r for r in self._rules.values() if r.enabled]

        use_auto_fix = auto_fix if auto_fix is not None else self._auto_fix_enabled

        for rule in rules_to_check:
            result.rules_checked += 1
            original_auto_fix = rule.auto_fix
            if not use_auto_fix:
                rule.auto_fix = False

            passed, fixed_output = rule.validate(current_output, result)

            rule.auto_fix = original_auto_fix

            if passed:
                result.rules_passed += 1
            else:
                result.rules_failed += 1
                if use_auto_fix and fixed_output != current_output:
                    current_output = fixed_output

        result.validated_output = current_output
        result.validation_time_ms = (time.time() - start) * 1000

        # 严格模式：任何警告也视为失败
        if self._strict_mode and result.warnings:
            result.valid = False

        with self._lock:
            self._validation_history.append(result)
            if len(self._validation_history) > 500:
                self._validation_history = self._validation_history[-200:]

        return result

    def _quick_detection(self, text: str, result: ValidationResult,
                          search_results_urls: Optional[List[str]] = None,
                          expect_tool: bool = False,
                          expect_search: bool = False):
        """0.1.5版本的快速检测"""
        if text is None:
            text = ""

        # 1. 空回复检测
        for pat in _EMPTY_PATTERNS:
            if pat.match(text):
                result.valid = False
                result.empty = True
                result.issues.append("empty_reply")
                result.fixable = True
                result.fix_action = "retry"
                result.add_error("empty_reply", "空回复检测", "error")
                return

        # 2. 拒绝检测
        refusal_matched = False
        for pat in _REFUSAL_PATTERNS:
            if pat.search(text):
                refusal_matched = True
                break
        if refusal_matched:
            result.valid = False
            result.refused = True
            text_lower = text.lower()
            if any(kw in text for kw in ["搜索", "查询", "查找", "联网", "上网", "网络", "互联网", "网页", "网站", "在线", "browse", "search", "access", "internet"]):
                result.refusal_type = "search"
                result.fix_action = "force_search"
            elif any(kw in text for kw in ["工具", "tool", "执行", "命令", "运行"]):
                result.refusal_type = "tool"
                result.fix_action = "force_tool"
            else:
                result.refusal_type = "general"
                result.fix_action = "retry"
            result.fixable = True
            result.issues.append(f"refusal:{result.refusal_type}")
            result.add_error("refusal", f"拒绝检测: {result.refusal_type}", "error")

        # 3. DSML 标签泄漏检测
        all_tags = _DSML_TAG_RE.findall(text)
        unknown_tags = [t for t in all_tags if t not in _KNOWN_CONTROL_TAGS]
        if unknown_tags:
            result.dsml_leaked = True
            result.dsml_tags = unknown_tags
            result.issues.append("dsml_leaked")
            result.fixable = True
            if not result.fix_action:
                result.fix_action = "strip_tags"
            result.valid = False
            result.add_warning("dsml_leak", f"DSML标签泄漏: {unknown_tags}")

        # 4. 收集工具/搜索/文件标签
        result.tool_tags = _TOOL_TAG_RE.findall(text)
        result.search_tags = _SEARCH_TAG_RE.findall(text)
        result.file_tags = [m.group(1) for m in _FILE_TAG_RE.finditer(text)]

        # 5. 引用校验：URL编造检测
        if search_results_urls:
            found_urls = _URL_RE.findall(text)
            real_urls = set(search_results_urls)
            for url in found_urls:
                clean_url = url.rstrip('.,;:!?)]}）】》》\'"')
                if not any(_domain_match(clean_url, real) for real in real_urls):
                    if not _is_known_official_url(clean_url):
                        result.fabricated_urls.append(clean_url)
            if result.fabricated_urls:
                result.issues.append("fabricated_urls")
                if not result.fix_action:
                    result.fix_action = "replace_urls"
                result.valid = False
                result.add_warning("fabricated_urls", f"编造URL检测: {len(result.fabricated_urls)}个")

        # 6. 预期工具但模型没调用
        if expect_tool and not result.tool_tags and not result.refused:
            result.issues.append("expected_tool_but_not_called")
            result.add_warning("expected_tool", "预期工具但未调用")

    def validate_json_output(self, output: str, required_fields: Optional[List[str]] = None) -> Tuple[bool, Any, str]:
        """校验JSON输出并解析"""
        result = self.validate(output, rule_names=["json_valid", "no_sensitive_info"])
        if not result.valid:
            return False, None, "; ".join(e["message"] for e in result.errors)
        try:
            data = json.loads(result.validated_output)
            if required_fields and isinstance(data, dict):
                missing = [f for f in required_fields if f not in data]
                if missing:
                    return False, data, f"缺少必填字段: {', '.join(missing)}"
            return True, data, ""
        except json.JSONDecodeError as e:
            return False, None, f"JSON解析失败: {e}"

    # ================================================================
    # 历史和统计
    # ================================================================
    def get_validation_history(self, limit: int = 50) -> List[ValidationResult]:
        return list(reversed(self._validation_history[-limit:]))

    def get_stats(self) -> Dict[str, Any]:
        total_validations = len(self._validation_history)
        passed = sum(1 for r in self._validation_history if r.valid)
        total_rules = len(self._rules)
        enabled_rules = sum(1 for r in self._rules.values() if r.enabled)
        total_triggers = sum(r.trigger_count for r in self._rules.values())
        total_failures = sum(r.failure_count for r in self._rules.values())

        # 0.1.5版本的统计
        refusal_count = sum(1 for r in self._validation_history if r.refused)
        empty_count = sum(1 for r in self._validation_history if r.empty)
        dsml_leak_count = sum(1 for r in self._validation_history if r.dsml_leaked)
        fabricated_url_count = sum(1 for r in self._validation_history if r.fabricated_urls)

        return {
            "total_validations": total_validations,
            "passed": passed,
            "failed": total_validations - passed,
            "pass_rate": round(passed / total_validations * 100, 1) if total_validations > 0 else 0,
            "total_rules": total_rules,
            "enabled_rules": enabled_rules,
            "disabled_rules": total_rules - enabled_rules,
            "total_rule_triggers": total_triggers,
            "total_rule_failures": total_failures,
            "auto_fix_enabled": self._auto_fix_enabled,
            "strict_mode": self._strict_mode,
            # 0.1.5版本的统计
            "refusal_count": refusal_count,
            "empty_count": empty_count,
            "dsml_leak_count": dsml_leak_count,
            "fabricated_url_count": fabricated_url_count,
        }
