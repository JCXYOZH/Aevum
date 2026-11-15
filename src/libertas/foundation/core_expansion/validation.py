"""职责模块：validation。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, TypeVar, Generic, Union
import base64
import datetime
import ipaddress
import json
import re
import uuid

class DataValidator:
    """数据验证器"""

    @staticmethod
    def is_email(email: str) -> bool:
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        return bool(re.match(pattern, email))

    @staticmethod
    def is_url(url: str) -> bool:
        pattern = r'^https?://[^\s/$.?#].[^\s]*$'
        return bool(re.match(pattern, url))

    @staticmethod
    def is_ipv4(ip: str) -> bool:
        try:
            ipaddress.IPv4Address(ip)
            return True
        except (ipaddress.AddressValueError, ValueError):
            return False

    @staticmethod
    def is_ipv6(ip: str) -> bool:
        try:
            ipaddress.IPv6Address(ip)
            return True
        except (ipaddress.AddressValueError, ValueError):
            return False

    @staticmethod
    def is_ip(ip: str) -> bool:
        return DataValidator.is_ipv4(ip) or DataValidator.is_ipv6(ip)

    @staticmethod
    def is_phone(phone: str, country: str = "CN") -> bool:
        if country == "CN":
            return bool(re.match(r'^1[3-9]\d{9}$', phone))
        return bool(re.match(r'^\+?[\d\s-]{7,15}$', phone))

    @staticmethod
    def is_uuid(uuid_str: str) -> bool:
        try:
            uuid.UUID(uuid_str)
            return True
        except (ValueError, AttributeError):
            return False

    @staticmethod
    def is_date(date_str: str, format: str = "%Y-%m-%d") -> bool:
        try:
            datetime.datetime.strptime(date_str, format)
            return True
        except (ValueError, TypeError):
            return False

    @staticmethod
    def is_datetime(dt_str: str, format: str = "%Y-%m-%d %H:%M:%S") -> bool:
        try:
            datetime.datetime.strptime(dt_str, format)
            return True
        except (ValueError, TypeError):
            return False

    @staticmethod
    def is_json(json_str: str) -> bool:
        try:
            json.loads(json_str)
            return True
        except (json.JSONDecodeError, TypeError):
            return False

    @staticmethod
    def is_hex(hex_str: str) -> bool:
        return bool(re.match(r'^[0-9a-fA-F]+$', hex_str))

    @staticmethod
    def is_base64(b64_str: str) -> bool:
        try:
            base64.b64decode(b64_str, validate=True)
            return True
        except Exception:
            return False

    @staticmethod
    def is_strong_password(password: str) -> Tuple[bool, List[str]]:
        issues = []
        if len(password) < 8:
            issues.append("密码长度至少8位")
        if not re.search(r'[a-z]', password):
            issues.append("需要包含小写字母")
        if not re.search(r'[A-Z]', password):
            issues.append("需要包含大写字母")
        if not re.search(r'\d', password):
            issues.append("需要包含数字")
        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
            issues.append("需要包含特殊字符")
        return len(issues) == 0, issues

    @staticmethod
    def validate_schema(data: Dict, schema: Dict) -> Tuple[bool, List[str]]:
        """简单的JSON Schema验证"""
        errors = []
        for field, rules in schema.items():
            value = data.get(field)
            if rules.get("required") and value is None:
                errors.append(f"缺少必填字段: {field}")
                continue
            if value is None:
                continue
            expected_type = rules.get("type")
            if expected_type == "string" and not isinstance(value, str):
                errors.append(f"字段 {field} 应为字符串")
            elif expected_type == "integer" and not isinstance(value, int):
                errors.append(f"字段 {field} 应为整数")
            elif expected_type == "number" and not isinstance(value, (int, float)):
                errors.append(f"字段 {field} 应为数字")
            elif expected_type == "boolean" and not isinstance(value, bool):
                errors.append(f"字段 {field} 应为布尔值")
            elif expected_type == "array" and not isinstance(value, list):
                errors.append(f"字段 {field} 应为数组")
            elif expected_type == "object" and not isinstance(value, dict):
                errors.append(f"字段 {field} 应为对象")
            if isinstance(value, str):
                if "min_length" in rules and len(value) < rules["min_length"]:
                    errors.append(f"字段 {field} 长度至少 {rules['min_length']}")
                if "max_length" in rules and len(value) > rules["max_length"]:
                    errors.append(f"字段 {field} 长度不超过 {rules['max_length']}")
                if "pattern" in rules and not re.match(rules["pattern"], value):
                    errors.append(f"字段 {field} 格式不正确")
            if isinstance(value, (int, float)):
                if "min" in rules and value < rules["min"]:
                    errors.append(f"字段 {field} 最小值为 {rules['min']}")
                if "max" in rules and value > rules["max"]:
                    errors.append(f"字段 {field} 最大值为 {rules['max']}")
        return len(errors) == 0, errors
