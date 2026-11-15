"""Libertas 内置插件。

插件采用统一的 ``register(registry)`` 入口，把工具函数、参数说明、分类注册到
:class:`PluginRegistry`。默认注册表按需加载，不在导入包时执行网络或文件操作。
"""

from __future__ import annotations

import importlib
import pkgutil
from typing import Optional

from .registry import PluginRegistry

__all__ = ["PluginRegistry", "get_registry", "load_builtin_plugins", "call_tool"]

_registry: Optional[PluginRegistry] = None


def get_registry() -> PluginRegistry:
    """返回全局注册表；首次调用时加载本包内所有内置插件。"""
    global _registry
    if _registry is None:
        _registry = load_builtin_plugins()
    return _registry


def load_builtin_plugins(registry: Optional[PluginRegistry] = None) -> PluginRegistry:
    """加载本包内所有带 ``register`` 入口的模块。"""
    target = registry or PluginRegistry()
    for module_info in pkgutil.iter_modules(__path__):
        if module_info.name.startswith("_") or module_info.name == "registry":
            continue
        module = importlib.import_module(f"{__name__}.{module_info.name}")
        register = getattr(module, "register", None)
        if callable(register):
            register(target)
    return target


def call_tool(name: str, **kwargs):
    """按工具名调用内置插件。"""
    return get_registry().call_tool(name, **kwargs)
