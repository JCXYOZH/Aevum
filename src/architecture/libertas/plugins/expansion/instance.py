"""插件扩展模型: 插件实例。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable
from enum import Enum


from .state import PluginState
from .manifest import PluginManifest

class PluginInstance:
    """插件实例"""

    def __init__(self, manifest: PluginManifest, path: str = ""):
        self.manifest = manifest
        self.path = path
        self.state = PluginState.INSTALLED
        self.module = None
        self.instance = None
        self.installed_at = time.time()
        self.loaded_at = 0.0
        self.activated_at = 0.0
        self.last_error = ""
        self.error_traceback = ""
        self.call_count = 0
        self.total_execution_time = 0.0
        self.avg_execution_time = 0.0
        self.config: Dict[str, Any] = {}
        self.events_subscribed: List[str] = []
        self.commands_registered: List[str] = []
        self.hooks_registered: List[str] = []
        self._lock = threading.RLock()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "plugin_id": self.manifest.plugin_id,
            "name": self.manifest.name,
            "version": self.manifest.version,
            "state": self.state.value,
            "path": self.path,
            "installed_at": self.installed_at,
            "loaded_at": self.loaded_at,
            "activated_at": self.activated_at,
            "last_error": self.last_error,
            "call_count": self.call_count,
            "avg_execution_time": round(self.avg_execution_time, 2),
            "config_keys": list(self.config.keys()),
            "events_subscribed": len(self.events_subscribed),
            "commands_registered": len(self.commands_registered),
            "hooks_registered": len(self.hooks_registered),
            "manifest": self.manifest.to_dict(),
        }
