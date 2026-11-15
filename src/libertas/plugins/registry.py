"""插件注册表：工具、钩子、搜索后端和菜单的统一入口。"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional


@dataclass
class ToolRecord:
    name: str
    func: Callable[..., Any]
    params: Dict[str, Any] = field(default_factory=dict)
    category: str = "通用"
    desc: str = ""


class PluginRegistry:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._tools: Dict[str, ToolRecord] = {}
        self._hooks: Dict[str, List[Callable[..., Any]]] = {}
        self._search_backends: Dict[str, Callable[..., Any]] = {}
        self._menus: Dict[str, Dict[str, Any]] = {}

    def register_tool(
        self,
        name: str,
        func: Callable[..., Any],
        params: Optional[Dict[str, Any]] = None,
        category: str = "通用",
        desc: str = "",
    ) -> None:
        if not callable(func):
            raise TypeError(f"tool {name} is not callable")
        with self._lock:
            self._tools[name] = ToolRecord(name, func, dict(params or {}), category, desc)

    def call_tool(self, name: str, **kwargs: Any) -> Any:
        with self._lock:
            record = self._tools.get(name)
        if record is None:
            raise KeyError(f"unknown tool: {name}")
        return record.func(**kwargs)

    def list_tools(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [
                {
                    "name": item.name,
                    "params": dict(item.params),
                    "category": item.category,
                    "desc": item.desc,
                }
                for item in self._tools.values()
            ]

    def tool_names(self) -> List[str]:
        with self._lock:
            return list(self._tools.keys())

    def register_hook(self, hook_name: str, func: Callable[..., Any]) -> None:
        if not callable(func):
            raise TypeError(f"hook {hook_name} is not callable")
        with self._lock:
            self._hooks.setdefault(hook_name, []).append(func)

    def call_hook(self, hook_name: str, *args: Any, **kwargs: Any) -> List[Any]:
        with self._lock:
            handlers = list(self._hooks.get(hook_name, ()))
        return [handler(*args, **kwargs) for handler in handlers]

    def register_search_backend(self, name: str, func: Callable[..., Any]) -> None:
        if not callable(func):
            raise TypeError(f"search backend {name} is not callable")
        with self._lock:
            self._search_backends[name] = func

    def search(self, name: str, *args: Any, **kwargs: Any) -> Any:
        with self._lock:
            backend = self._search_backends.get(name)
        if backend is None:
            raise KeyError(f"unknown search backend: {name}")
        return backend(*args, **kwargs)

    def register_menu(self, menu_id: str, label: str, callback_name: str, icon: str = "") -> None:
        with self._lock:
            self._menus[menu_id] = {
                "id": menu_id,
                "label": label,
                "callback": callback_name,
                "icon": icon,
            }

    def list_menus(self) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._menus.values())


_registry: Optional[PluginRegistry] = None
_registry_lock = threading.Lock()


def get_registry() -> PluginRegistry:
    global _registry
    if _registry is None:
        with _registry_lock:
            if _registry is None:
                _registry = PluginRegistry()
    return _registry
