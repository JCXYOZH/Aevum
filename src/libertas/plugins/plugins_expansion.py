"""插件扩展基础设施的公开入口。

具体实现已拆分到 libertas.plugins.expansion 下的独立模块。
"""

from __future__ import annotations

from .expansion import (
    PluginState,
    PluginType,
    PluginManifest,
    PluginInstance,
    PluginDependencyResolver,
    PluginSandbox,
    PluginHotLoader,
    PluginEventBus,
    PluginLifecycleManager,
    get_plugin_dependency_resolver,
    get_plugin_sandbox,
    get_plugin_hot_loader,
    get_plugin_event_bus,
    get_plugin_lifecycle_manager,
)

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
