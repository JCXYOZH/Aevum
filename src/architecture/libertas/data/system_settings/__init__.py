"""系统设置公共入口。"""

from .models import SettingCategory, SettingDefinition, UserPreferences
from .core import SystemSettingsManager
from .singleton import get_system_settings_manager, get_setting, set_setting

__all__ = [
    "SettingCategory", "SettingDefinition", "UserPreferences", "SystemSettingsManager",
    "get_system_settings_manager", "get_setting", "set_setting",
]
