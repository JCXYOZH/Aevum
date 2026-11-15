"""Libertas 插件包。

只自动加载按功能分类的普通插件；攻击载荷、爆破、主动扫描和 PoC 模块
不进入自动加载范围。插件模块必须提供 register(registry)。
"""

from __future__ import annotations

import importlib
import pkgutil
from typing import Any, Dict, List, Optional

from . import registry as _registry_module

CATEGORY_PACKAGES = ("web", "network", "encoding", "analysis", "utility")

_load_lock = None
_loaded = False
PLUGIN_LOAD_ERRORS: List[str] = []


def _iter_plugin_modules():
    for category in CATEGORY_PACKAGES:
        try:
            category_package = importlib.import_module(f"{__name__}.{category}")
        except Exception as exc:
            PLUGIN_LOAD_ERRORS.append(f"{category}: {exc}")
            continue
        for module_info in pkgutil.iter_modules(category_package.__path__):
            if module_info.name.startswith("_"):
                continue
            module_name = f"{category_package.__name__}.{module_info.name}"
            try:
                module = importlib.import_module(module_name)
            except Exception as exc:
                PLUGIN_LOAD_ERRORS.append(f"{module_name}: {exc}")
                continue
            if callable(getattr(module, "register", None)):
                yield module


def load_builtin_plugins(registry: Optional[_registry_module.PluginRegistry] = None, force: bool = False) -> _registry_module.PluginRegistry:
    global _loaded, _load_lock
    target = registry or _registry_module.get_registry()
    if _loaded and not force:
        return target
    if _load_lock is None:
        import threading
        _load_lock = threading.Lock()
    with _load_lock:
        if _loaded and not force:
            return target
        PLUGIN_LOAD_ERRORS.clear()
        for module in _iter_plugin_modules():
            try:
                module.register(target)
            except Exception as exc:
                PLUGIN_LOAD_ERRORS.append(f"{module.__name__}: {exc}")
        _loaded = True
    return target


def get_registry() -> _registry_module.PluginRegistry:
    registry = _registry_module.get_registry()
    load_builtin_plugins(registry)
    return registry


def call_tool(name: str, **kwargs: Any) -> Any:
    return get_registry().call_tool(name, **kwargs)


def list_tools() -> List[Dict[str, Any]]:
    return get_registry().list_tools()
