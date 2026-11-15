"""插件注册中心。

插件模块通过 ``register(registry)`` 把工具函数登记到注册表；注册表负责参数说明、
分类、生命周期钩子和统一调用入口。
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


class PluginRegistry:
    """进程内插件注册表。"""

    def __init__(self):
        self.tools: Dict[str, Callable[..., Any]] = {}
        self.tool_params: Dict[str, Dict[str, Any]] = {}
        self.tool_meta: Dict[str, Dict[str, str]] = {}
        self.search_backends: Dict[str, Callable[..., Any]] = {}
        self.hooks: Dict[str, List[Callable[..., Any]]] = {}
        self.menus: List[Dict[str, str]] = []

    def register_tool(
        self,
        name: str,
        func: Callable[..., Any],
        params: Optional[Dict[str, Any]] = None,
        category: str = "通用",
        desc: str = "",
    ) -> None:
        """登记一个可调用工具。"""
        if not callable(func):
            raise TypeError(f"工具 {name} 的 func 必须可调用")
        self.tools[name] = func
        self.tool_params[name] = dict(params or {})
        self.tool_meta[name] = {
            "category": category,
            "desc": desc or (func.__doc__ or "").strip().split("\n")[0],
        }

    def register_search_backend(self, name: str, func: Callable[..., Any]) -> None:
        self.search_backends[name] = func

    def register_hook(self, hook_name: str, func: Callable[..., Any]) -> None:
        self.hooks.setdefault(hook_name, []).append(func)

    def register_menu(
        self,
        menu_id: str,
        label: str,
        callback_name: str,
        icon: str = "",
    ) -> None:
        self.menus.append(
            {"id": menu_id, "label": label, "callback": callback_name, "icon": icon}
        )

    def call_hook(self, hook_name: str, *args: Any, **kwargs: Any) -> List[Any]:
        results: List[Any] = []
        for func in self.hooks.get(hook_name, []):
            try:
                results.append(func(*args, **kwargs))
            except Exception:
                logger.exception("插件钩子执行失败: %s", hook_name)
        return results

    def call_tool(self, name: str, **kwargs: Any) -> Any:
        """按名称调用工具；未知工具和异常统一返回错误字典。"""
        func = self.tools.get(name)
        if func is None:
            return {"success": False, "error": f"工具 {name} 不存在"}
        try:
            return func(**kwargs)
        except Exception as exc:
            logger.exception("插件工具执行失败: %s", name)
            return {"success": False, "error": str(exc)}

    def get_tool(self, name: str) -> Optional[Callable[..., Any]]:
        return self.tools.get(name)

    def list_tools(self) -> List[Dict[str, Any]]:
        """返回工具名称、参数、分类和说明，供上层做能力发现。"""
        return [
            {
                "name": name,
                "params": self.tool_params.get(name, {}),
                "category": self.tool_meta.get(name, {}).get("category", "通用"),
                "desc": self.tool_meta.get(name, {}).get("desc", ""),
            }
            for name in sorted(self.tools)
        ]

    def tool_names(self) -> List[str]:
        return sorted(self.tools)
