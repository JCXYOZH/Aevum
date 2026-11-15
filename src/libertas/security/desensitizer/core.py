"""脱敏器实现。"""

import hashlib
import json
import re
import threading
from typing import Any, Dict, List, Optional, Pattern, Tuple

from libertas.foundation.terminal import terminal
from .rules import DesensitizationRule, _build_default_rules
from .generator import FakeDataGenerator

class Desensitizer:
    """数据脱敏器"""

    def __init__(self, salt: str = "libertas_desensitize", mode: str = "standard"):
        self.salt = salt
        self.mode = mode  # standard / strict / minimal
        self._rules: Dict[str, DesensitizationRule] = {}
        self._custom_rules: List[DesensitizationRule] = []
        self._lock = threading.RLock()
        self._stats = {"total_processed": 0, "total_masked": 0, "by_rule": {}}
        self._init_default_rules()
        self._apply_mode()

    def _init_default_rules(self):
        for rule in _build_default_rules():
            self._rules[rule.name] = rule

    def _apply_mode(self):
        if self.mode == "strict":
            for rule in self._rules.values():
                rule.enabled = True
        elif self.mode == "minimal":
            minimal_rules = {"phone", "id_card", "email", "api_key", "password", "jwt_token"}
            for name, rule in self._rules.items():
                rule.enabled = name in minimal_rules
        else:  # standard
            standard_disabled = {"chinese_name", "qq_number"}
            for name, rule in self._rules.items():
                rule.enabled = name not in standard_disabled

    def set_mode(self, mode: str):
        self.mode = mode
        self._apply_mode()

    def add_rule(self, name: str, pattern: str, strategy: str = "mask",
                 **kwargs) -> DesensitizationRule:
        """添加自定义脱敏规则"""
        rule = DesensitizationRule(
            name=name, pattern=re.compile(pattern), strategy=strategy, **kwargs
        )
        with self._lock:
            self._custom_rules.append(rule)
        return rule

    def remove_rule(self, name: str):
        with self._lock:
            self._custom_rules = [r for r in self._custom_rules if r.name != name]
            if name in self._rules:
                self._rules[name].enabled = False

    def enable_rule(self, name: str):
        with self._lock:
            if name in self._rules:
                self._rules[name].enabled = True

    def disable_rule(self, name: str):
        with self._lock:
            if name in self._rules:
                self._rules[name].enabled = False

    def _get_all_rules(self) -> List[DesensitizationRule]:
        with self._lock:
            default = [r for r in self._rules.values() if r.enabled]
            custom = list(self._custom_rules)
            return default + custom

    def _apply_mask(self, text: str, rule: DesensitizationRule) -> str:
        """应用掩码策略"""
        def replacer(match):
            full = match.group(0)
            if rule.keep_prefix + rule.keep_suffix >= len(full):
                return rule.mask_char * len(full)
            prefix = full[:rule.keep_prefix]
            suffix = full[-rule.keep_suffix:] if rule.keep_suffix > 0 else ""
            middle = rule.mask_char * (len(full) - rule.keep_prefix - rule.keep_suffix)
            return prefix + middle + suffix
        return rule.pattern.sub(replacer, text)

    def _apply_replace(self, text: str, rule: DesensitizationRule) -> str:
        """应用替换策略"""
        return rule.pattern.sub(rule.replacement, text)

    def _apply_hash(self, text: str, rule: DesensitizationRule) -> str:
        """应用哈希策略（不可逆）"""
        def replacer(match):
            original = match.group(0)
            h = hashlib.sha256((original + self.salt + rule.hash_salt).encode()).hexdigest()
            return f"[HASH:{h[:16]}]"
        return rule.pattern.sub(replacer, text)

    def _apply_truncate(self, text: str, rule: DesensitizationRule) -> str:
        """应用截断策略"""
        def replacer(match):
            full = match.group(0)
            max_len = rule.keep_prefix + rule.keep_suffix + 3
            if len(full) <= max_len:
                return full
            return full[:rule.keep_prefix] + "..." + full[-rule.keep_suffix:] if rule.keep_suffix > 0 else full[:rule.keep_prefix] + "..."
        return rule.pattern.sub(replacer, text)

    def _apply_generalize(self, text: str, rule: DesensitizationRule) -> str:
        """应用泛化策略（区间化）"""
        if rule.name == "latitude_longitude":
            def replacer(match):
                return "[坐标已泛化]"
            return rule.pattern.sub(replacer, text)
        return self._apply_mask(text, rule)

    def desensitize(self, text: str, rules: Optional[List[str]] = None) -> str:
        """对文本进行脱敏"""
        if not text:
            return text

        result = text
        all_rules = self._get_all_rules()

        if rules:
            all_rules = [r for r in all_rules if r.name in rules]

        masked_count = 0
        for rule in all_rules:
            try:
                before = result
                if rule.strategy == "mask":
                    result = self._apply_mask(result, rule)
                elif rule.strategy == "replace":
                    result = self._apply_replace(result, rule)
                elif rule.strategy == "hash":
                    result = self._apply_hash(result, rule)
                elif rule.strategy == "truncate":
                    result = self._apply_truncate(result, rule)
                elif rule.strategy == "generalize":
                    result = self._apply_generalize(result, rule)

                if result != before:
                    masked_count += 1
                    with self._lock:
                        self._stats["by_rule"][rule.name] = self._stats["by_rule"].get(rule.name, 0) + 1
            except Exception as e:
                terminal.debug(f"脱敏规则 {rule.name} 执行异常: {e}", "desensitizer")

        with self._lock:
            self._stats["total_processed"] += 1
            if masked_count > 0:
                self._stats["total_masked"] += 1

        return result

    def desensitize_dict(self, data: Dict[str, Any],
                         sensitive_keys: Optional[List[str]] = None) -> Dict[str, Any]:
        """对字典进行脱敏"""
        if not data:
            return data

        sensitive_keys = sensitive_keys or [
            "password", "passwd", "pwd", "token", "secret", "api_key", "apikey",
            "access_key", "private_key", "phone", "mobile", "email", "id_card",
            "address", "ip", "card_number", "bank_card",
        ]

        result = {}
        for key, value in data.items():
            key_lower = key.lower()
            if any(s in key_lower for s in sensitive_keys):
                if isinstance(value, str) and len(value) > 4:
                    result[key] = value[:2] + "***" + value[-2:]
                elif isinstance(value, (int, float)):
                    result[key] = "***"
                else:
                    result[key] = self.desensitize(str(value)) if value else value
            elif isinstance(value, str):
                result[key] = self.desensitize(value)
            elif isinstance(value, dict):
                result[key] = self.desensitize_dict(value, sensitive_keys)
            elif isinstance(value, list):
                result[key] = [
                    self.desensitize_dict(item, sensitive_keys) if isinstance(item, dict)
                    else self.desensitize(str(item)) if isinstance(item, str)
                    else item
                    for item in value
                ]
            else:
                result[key] = value
        return result

    def desensitize_json(self, json_str: str) -> str:
        """对 JSON 字符串进行脱敏"""
        try:
            data = json.loads(json_str)
            if isinstance(data, dict):
                return json.dumps(self.desensitize_dict(data), ensure_ascii=False, indent=2)
            return json_str
        except Exception:
            return self.desensitize(json_str)

    def reversible_encrypt(self, text: str, key: str = "") -> str:
        """可逆脱敏（格式保留加密，简化版 XOR + Base64）"""
        if not text:
            return text
        encryption_key = key or self.salt
        key_bytes = encryption_key.encode("utf-8")
        text_bytes = text.encode("utf-8")
        encrypted = bytes([text_bytes[i] ^ key_bytes[i % len(key_bytes)] for i in range(len(text_bytes))])
        import base64
        return "[ENC:" + base64.b64encode(encrypted).decode("utf-8") + "]"

    def reversible_decrypt(self, encrypted: str, key: str = "") -> str:
        """解密可逆脱敏数据"""
        if not encrypted or not encrypted.startswith("[ENC:") or not encrypted.endswith("]"):
            return encrypted
        import base64
        try:
            encoded = encrypted[5:-1]
            encrypted_bytes = base64.b64decode(encoded)
            decryption_key = key or self.salt
            key_bytes = decryption_key.encode("utf-8")
            decrypted = bytes([encrypted_bytes[i] ^ key_bytes[i % len(key_bytes)] for i in range(len(encrypted_bytes))])
            return decrypted.decode("utf-8")
        except Exception:
            return encrypted

    def k_anonymize(self, records: List[Dict[str, Any]],
                     quasi_identifiers: List[str], k: int = 5) -> List[Dict[str, Any]]:
        """k-匿名化：将准标识符泛化到每组至少 k 条记录"""
        if not records or not quasi_identifiers:
            return records

        # 简化版 k-匿名：对准标识符进行泛化
        result = []
        for record in records:
            anonymized = dict(record)
            for qi in quasi_identifiers:
                if qi in anonymized:
                    value = str(anonymized[qi])
                    if len(value) > 4:
                        anonymized[qi] = value[:2] + "***" + value[-2:] if len(value) > 6 else value[:1] + "***"
                    else:
                        anonymized[qi] = "***"
            result.append(anonymized)
        return result

    def detect_sensitive(self, text: str) -> List[Dict[str, Any]]:
        """检测文本中的敏感信息（不替换，仅报告）"""
        if not text:
            return []

        findings = []
        for rule in self._get_all_rules():
            try:
                matches = list(rule.pattern.finditer(text))
                for match in matches:
                    findings.append({
                        "rule": rule.name,
                        "description": rule.description,
                        "match": match.group(0)[:20] + "..." if len(match.group(0)) > 20 else match.group(0),
                        "start": match.start(),
                        "end": match.end(),
                        "strategy": rule.strategy,
                    })
            except Exception:
                pass
        return findings

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            return dict(self._stats)

    def list_rules(self) -> List[Dict[str, Any]]:
        """列出所有规则"""
        rules = self._get_all_rules()
        return [
            {
                "name": r.name,
                "description": r.description,
                "strategy": r.strategy,
                "enabled": r.enabled,
                "pattern": r.pattern.pattern[:50] + "..." if len(r.pattern.pattern) > 50 else r.pattern.pattern,
            }
            for r in rules
        ]

    def export_config(self) -> Dict[str, Any]:
        """导出脱敏配置"""
        return {
            "mode": self.mode,
            "salt": "***" if self.salt else "",
            "rules": [
                {"name": r.name, "strategy": r.strategy, "enabled": r.enabled,
                 "keep_prefix": r.keep_prefix, "keep_suffix": r.keep_suffix}
                for r in self._get_all_rules()
            ],
        }
