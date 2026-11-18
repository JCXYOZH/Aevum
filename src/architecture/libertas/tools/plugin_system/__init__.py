"""插件系统入口。"""

from .registry import PluginRegistry
from .template import PLUGIN_TEMPLATE
from .manager import PluginManager
from .singleton import _plugin_mgr, _plugin_mgr_lock, get_plugin_manager

__all__ = [
    "PluginRegistry",
    "PLUGIN_TEMPLATE",
    "PluginManager",
    "_plugin_mgr",
    "_plugin_mgr_lock",
    "get_plugin_manager",
]
