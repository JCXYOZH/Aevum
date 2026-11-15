"""插件系统职责：registry。"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
import threading
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from libertas.foundation.config import get_data_dir


class PluginRegistry:
    """插件注册中心：插件通过register()注册工具、搜索后端和钩子"""

    def __init__(self):
        self.tools: Dict[str, Callable] = {}
        self.tool_params: Dict[str, Dict] = {}
        self.search_backends: Dict[str, Callable] = {}
        self.hooks: Dict[str, List[Callable]] = {}
        self.menus: List[Dict] = []

    def register_tool(self, name: str, func: Callable, params: Dict = None,
                      category: str = "自定义", desc: str = ""):
        """注册一个工具函数，可在工具箱中调用"""
        self.tools[name] = func
        self.tool_params[name] = params or {}
        if not hasattr(self, '_tool_meta'):
            self._tool_meta = {}
        self._tool_meta[name] = {"category": category, "desc": desc or (func.__doc__ or "").strip().split("\n")[0]}

    def register_search_backend(self, name: str, func: Callable):
        """注册搜索后端"""
        self.search_backends[name] = func

    def register_hook(self, hook_name: str, func: Callable):
        """注册生命周期钩子: before_scan/after_scan/before_send/after_receive/on_load/on_shutdown"""
        self.hooks.setdefault(hook_name, []).append(func)

    def register_menu(self, id: str, label: str, callback_name: str, icon: str = "[PLUGIN]"):
        """注册前端菜单项"""
        self.menus.append({"id": id, "label": label, "callback": callback_name, "icon": icon})

    def call_hook(self, hook_name: str, *args, **kwargs):
        results = []
        for func in self.hooks.get(hook_name, []):
            try:
                results.append(func(*args, **kwargs))
            except Exception:
                pass
        return results

    def call_tool(self, name: str, **kwargs) -> Any:
        if name not in self.tools:
            return {"success": False, "error": f"工具 {name} 不存在"}
        try:
            return self.tools[name](**kwargs)
        except Exception as e:
            return {"success": False, "error": str(e)}
