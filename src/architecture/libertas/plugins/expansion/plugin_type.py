"""插件扩展模型: 插件类型。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable
from enum import Enum

class PluginType(Enum):
    TOOL = "tool"
    COMMAND = "command"
    LISTENER = "listener"
    SCHEDULER = "scheduler"
    API_EXTENSION = "api_extension"
    UI_EXTENSION = "ui_extension"
    DATA_SOURCE = "data_source"
    AUTH_PROVIDER = "auth_provider"
    NOTIFICATION = "notification"
    TRANSFORMER = "transformer"
    GENERIC = "generic"
