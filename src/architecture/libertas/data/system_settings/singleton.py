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

from .core import SystemSettingsManager

_system_settings_manager = None


def get_system_settings_manager() -> SystemSettingsManager:
    return _system_settings_manager


def get_setting(key: str, **kwargs) -> Any:
    return _system_settings_manager.get(key, **kwargs)


def set_setting(key: str, value: Any, **kwargs) -> Tuple[bool, str]:
    return _system_settings_manager.set(key, value, **kwargs)
