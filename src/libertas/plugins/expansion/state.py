"""插件扩展模型: 插件状态。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable
from enum import Enum

class PluginState(Enum):
    INSTALLED = "installed"
    LOADED = "loaded"
    ACTIVE = "active"
    INACTIVE = "inactive"
    ERROR = "error"
    DISABLED = "disabled"
    UPDATING = "updating"
    UNINSTALLING = "uninstalling"
