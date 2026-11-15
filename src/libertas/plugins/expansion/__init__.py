"""插件扩展基础设施的统一导出与单例入口。"""

from __future__ import annotations

from .state import PluginState
from .plugin_type import PluginType
from .manifest import PluginManifest
from .instance import PluginInstance
from .dependency import PluginDependencyResolver
from .sandbox import PluginSandbox
from .hot_loader import PluginHotLoader
from .event_bus import PluginEventBus
from .lifecycle import PluginLifecycleManager

_plugin_dependency_resolver = PluginDependencyResolver()
_plugin_sandbox = PluginSandbox()
_plugin_hot_loader = PluginHotLoader()
_plugin_event_bus = PluginEventBus()
_plugin_lifecycle_manager = PluginLifecycleManager()


def get_plugin_dependency_resolver() -> PluginDependencyResolver:
    return _plugin_dependency_resolver


def get_plugin_sandbox() -> PluginSandbox:
    return _plugin_sandbox


def get_plugin_hot_loader() -> PluginHotLoader:
    return _plugin_hot_loader


def get_plugin_event_bus() -> PluginEventBus:
    return _plugin_event_bus


def get_plugin_lifecycle_manager() -> PluginLifecycleManager:
    return _plugin_lifecycle_manager


__all__ = [
    "PluginState",
    "PluginType",
    "PluginManifest",
    "PluginInstance",
    "PluginDependencyResolver",
    "PluginSandbox",
    "PluginHotLoader",
    "PluginEventBus",
    "PluginLifecycleManager",
    "get_plugin_dependency_resolver",
    "get_plugin_sandbox",
    "get_plugin_hot_loader",
    "get_plugin_event_bus",
    "get_plugin_lifecycle_manager",
]
