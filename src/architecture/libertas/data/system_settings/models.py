"""
系统设置与偏好管理

全局设置、用户偏好、主题、语言、快捷键、界面配置、配置导入导出。
"""
import os
import json
import time
import uuid
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


class SettingCategory(Enum):
    GENERAL = "general"
    APPEARANCE = "appearance"
    PERFORMANCE = "performance"
    SECURITY = "security"
    NETWORK = "network"
    NOTIFICATIONS = "notifications"
    SHORTCUTS = "shortcuts"
    ADVANCED = "advanced"
    PLUGINS = "plugins"
    INTEGRATIONS = "integrations"

class SettingDefinition:
    """设置项定义"""

    def __init__(self, key: str = "", default_value: Any = None,
                 value_type: str = "string",  # string / int / float / bool / list / dict / enum
                 category: str = "general",
                 description: str = "",
                 options: Optional[List[Any]] = None,
                 min_value: float = 0, max_value: float = 0,
                 requires_restart: bool = False,
                 requires_confirmation: bool = False,
                 tags: Optional[List[str]] = None):
        self.key = key
        self.default_value = default_value
        self.value_type = value_type
        self.category = category
        self.description = description
        self.options = options or []
        self.min_value = min_value
        self.max_value = max_value
        self.requires_restart = requires_restart
        self.requires_confirmation = requires_confirmation
        self.tags = tags or []
        self.created_at = time.time()

    def validate(self, value: Any) -> Tuple[bool, str]:
        """验证设置值"""
        if self.value_type == "int":
            try:
                v = int(value)
                if self.min_value and v < self.min_value:
                    return False, f"值不能小于 {self.min_value}"
                if self.max_value and v > self.max_value:
                    return False, f"值不能大于 {self.max_value}"
                return True, ""
            except (ValueError, TypeError):
                return False, "需要整数类型"
        if self.value_type == "float":
            try:
                v = float(value)
                if self.min_value and v < self.min_value:
                    return False, f"值不能小于 {self.min_value}"
                if self.max_value and v > self.max_value:
                    return False, f"值不能大于 {self.max_value}"
                return True, ""
            except (ValueError, TypeError):
                return False, "需要浮点数类型"
        if self.value_type == "bool":
            if not isinstance(value, bool):
                return False, "需要布尔类型"
            return True, ""
        if self.value_type == "enum" and self.options:
            if value not in self.options:
                return False, f"值必须是以下之一: {self.options}"
            return True, ""
        if self.value_type == "list" and not isinstance(value, list):
            return False, "需要列表类型"
        if self.value_type == "dict" and not isinstance(value, dict):
            return False, "需要字典类型"
        return True, ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "default_value": self.default_value,
            "value_type": self.value_type,
            "category": self.category,
            "description": self.description,
            "options": self.options,
            "min_value": self.min_value,
            "max_value": self.max_value,
            "requires_restart": self.requires_restart,
            "requires_confirmation": self.requires_confirmation,
            "tags": self.tags,
        }

class UserPreferences:
    """用户偏好"""

    def __init__(self, user_id: str = "default"):
        self.user_id = user_id
        self.settings: Dict[str, Any] = {}
        self.updated_at = time.time()
        self.created_at = time.time()

    def get(self, key: str, default: Any = None) -> Any:
        return self.settings.get(key, default)

    def set(self, key: str, value: Any) -> bool:
        self.settings[key] = value
        self.updated_at = time.time()
        return True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "settings": self.settings,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }
