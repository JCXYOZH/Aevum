"""插件扩展基础设施: 插件生命周期管理。"""

from __future__ import annotations

import os
import sys
import json
import time
import uuid
import math
import hashlib
import threading
import importlib
import importlib.util
import traceback
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter, defaultdict
from enum import Enum

from libertas.foundation.config import get_data_dir
from libertas.foundation.byte_stream import safe_decode
from libertas.foundation.terminal import terminal

from .state import PluginState
from .plugin_type import PluginType
from .manifest import PluginManifest
from .instance import PluginInstance
from .dependency import PluginDependencyResolver
from .sandbox import PluginSandbox
from .hot_loader import PluginHotLoader
from .event_bus import PluginEventBus



class PluginLifecycleManager:
    """插件生命周期管理器"""

    def __init__(self, plugins_dir: str = ""):
        self.manager_id = f"lcm_{uuid.uuid4().hex[:8]}"
        self.plugins_dir = plugins_dir or os.path.join(get_data_dir(), "plugins")
        self.plugins: Dict[str, PluginInstance] = {}
        self.dependency_resolver = PluginDependencyResolver()
        self.sandbox = PluginSandbox()
        self.hot_loader = PluginHotLoader(self.plugins_dir)
        self.event_bus = PluginEventBus()
        self._lock = threading.RLock()
        os.makedirs(self.plugins_dir, exist_ok=True)

    def install_plugin(self, manifest: PluginManifest,
                       plugin_path: str = "") -> Tuple[bool, str]:
        """安装插件"""
        with self._lock:
            if manifest.plugin_id in self.plugins:
                return False, f"插件已安装: {manifest.plugin_id}"

            # 检查依赖
            self.dependency_resolver.register_plugin(manifest)
            resolved, missing = self.dependency_resolver.resolve_dependencies(
                manifest.plugin_id
            )
            if missing:
                return False, f"缺少依赖: {', '.join(missing)}"

            # 检查冲突
            conflicts = self.dependency_resolver.check_conflicts(manifest.plugin_id)
            if conflicts:
                return False, f"依赖冲突: {'; '.join(conflicts)}"

            instance = PluginInstance(manifest, plugin_path)
            self.plugins[manifest.plugin_id] = instance
            terminal.info(f"插件已安装: {manifest.name} v{manifest.version}", "plugin_lifecycle")
            return True, manifest.plugin_id

    def load_plugin(self, plugin_id: str) -> Tuple[bool, str]:
        """加载插件"""
        instance = self.plugins.get(plugin_id)
        if not instance:
            return False, f"插件不存在: {plugin_id}"
        if instance.state in (PluginState.LOADED, PluginState.ACTIVE):
            return True, "插件已加载"

        try:
            if instance.path and os.path.exists(instance.path):
                # 优先在隔离子进程中尝试加载插件，避免插件内的致命错误影响主进程
                success, result = self.hot_loader.load_plugin(instance.path, isolated=True)
                if not success:
                    instance.state = PluginState.ERROR
                    instance.last_error = result
                    return False, result
                instance.module = self.hot_loader.loaded_modules.get(
                    os.path.splitext(os.path.basename(instance.path))[0]
                )

            instance.state = PluginState.LOADED
            instance.loaded_at = time.time()
            terminal.info(f"插件已加载: {instance.manifest.name}", "plugin_lifecycle")
            return True, plugin_id
        except Exception as e:
            instance.state = PluginState.ERROR
            instance.last_error = str(e)
            instance.error_traceback = traceback.format_exc()
            return False, str(e)

    def activate_plugin(self, plugin_id: str) -> Tuple[bool, str]:
        """激活插件"""
        instance = self.plugins.get(plugin_id)
        if not instance:
            return False, f"插件不存在: {plugin_id}"
        if instance.state == PluginState.ACTIVE:
            return True, "插件已激活"
        if instance.state != PluginState.LOADED:
            # 先加载
            success, msg = self.load_plugin(plugin_id)
            if not success:
                return False, msg

        try:
            # 调用插件的activate方法，若插件有文件路径则优先在隔离子进程中执行
            if instance.path and os.path.exists(instance.path):
                module_name = os.path.splitext(os.path.basename(instance.path))[0]
                res = self.sandbox.execute_isolated(
                    plugin_id=plugin_id,
                    plugin_path=instance.path,
                    module_name=module_name,
                    func_name="activate",
                    args=(instance.config,),
                    kwargs={},
                    timeout=self.sandbox.max_execution_time,
                )
                if not res.get("success", False):
                    raise RuntimeError(f"activate failed: {res.get('error')}")
            else:
                # 调用插件的activate方法（进程内）
                if instance.module and hasattr(instance.module, "activate"):
                    instance.module.activate(instance.config)
            instance.state = PluginState.ACTIVE
            instance.activated_at = time.time()
            # 发布事件
            self.event_bus.publish("plugin.activated", {
                "plugin_id": plugin_id,
                "name": instance.manifest.name,
            })
            terminal.info(f"插件已激活: {instance.manifest.name}", "plugin_lifecycle")
            return True, plugin_id
        except Exception as e:
            instance.state = PluginState.ERROR
            instance.last_error = str(e)
            instance.error_traceback = traceback.format_exc()
            return False, str(e)

    def deactivate_plugin(self, plugin_id: str) -> Tuple[bool, str]:
        """停用插件"""
        instance = self.plugins.get(plugin_id)
        if not instance:
            return False, f"插件不存在: {plugin_id}"
        if instance.state != PluginState.ACTIVE:
            return True, "插件未激活"
        try:
            if instance.module and hasattr(instance.module, "deactivate"):
                instance.module.deactivate()
            instance.state = PluginState.INACTIVE
            self.event_bus.publish("plugin.deactivated", {
                "plugin_id": plugin_id,
                "name": instance.manifest.name,
            })
            terminal.info(f"插件已停用: {instance.manifest.name}", "plugin_lifecycle")
            return True, plugin_id
        except Exception as e:
            return False, str(e)

    def uninstall_plugin(self, plugin_id: str) -> Tuple[bool, str]:
        """卸载插件"""
        instance = self.plugins.get(plugin_id)
        if not instance:
            return False, f"插件不存在: {plugin_id}"
        # 先停用
        if instance.state == PluginState.ACTIVE:
            self.deactivate_plugin(plugin_id)
        # 卸载模块
        if instance.path:
            module_name = os.path.splitext(os.path.basename(instance.path))[0]
            self.hot_loader.unload_plugin(module_name)
        with self._lock:
            del self.plugins[plugin_id]
        terminal.info(f"插件已卸载: {instance.manifest.name}", "plugin_lifecycle")
        return True, plugin_id

    def update_plugin(self, plugin_id: str, new_manifest: PluginManifest,
                      new_path: str = "") -> Tuple[bool, str]:
        """更新插件"""
        instance = self.plugins.get(plugin_id)
        if not instance:
            return False, f"插件不存在: {plugin_id}"
        was_active = instance.state == PluginState.ACTIVE
        # 停用
        if was_active:
            self.deactivate_plugin(plugin_id)
        # 更新清单
        instance.manifest = new_manifest
        instance.path = new_path or instance.path
        instance.state = PluginState.INSTALLED
        # 重新激活
        if was_active:
            return self.activate_plugin(plugin_id)
        return True, plugin_id

    def get_plugin(self, plugin_id: str) -> Optional[PluginInstance]:
        return self.plugins.get(plugin_id)

    def list_plugins(self, state: str = "", plugin_type: str = "") -> List[PluginInstance]:
        plugins = list(self.plugins.values())
        if state:
            plugins = [p for p in plugins if p.state.value == state]
        if plugin_type:
            plugins = [p for p in plugins if p.manifest.plugin_type == plugin_type]
        return plugins

    def execute_plugin_function(self, plugin_id: str, func_name: str,
                                args: Optional[Tuple] = None,
                                kwargs: Optional[Dict] = None) -> Dict[str, Any]:
        """执行插件函数（沙箱模式）"""
        instance = self.plugins.get(plugin_id)
        if not instance:
            return {"success": False, "error": f"插件不存在: {plugin_id}"}
        if instance.state != PluginState.ACTIVE:
            return {"success": False, "error": f"插件未激活: {plugin_id}"}
        if not instance.module or not hasattr(instance.module, func_name):
            return {"success": False, "error": f"函数不存在: {func_name}"}
        # 若插件有文件路径，优先在隔离子进程中执行
        if instance.path and os.path.exists(instance.path):
            module_name = os.path.splitext(os.path.basename(instance.path))[0]
            result = self.sandbox.execute_isolated(
                plugin_id=plugin_id,
                plugin_path=instance.path,
                module_name=module_name,
                func_name=func_name,
                args=args,
                kwargs=kwargs,
                timeout=self.sandbox.max_execution_time,
            )
        else:
            func = getattr(instance.module, func_name)
            result = self.sandbox.execute(plugin_id, func, args, kwargs)
        instance.call_count += 1
        instance.total_execution_time += result["execution_time_ms"]
        instance.avg_execution_time = (
            instance.total_execution_time / max(instance.call_count, 1)
        )
        return result

    def get_stats(self) -> Dict[str, Any]:
        states = Counter(p.state.value for p in self.plugins.values())
        types = Counter(p.manifest.plugin_type for p in self.plugins.values())
        return {
            "manager_id": self.manager_id,
            "plugins_dir": self.plugins_dir,
            "total_plugins": len(self.plugins),
            "by_state": dict(states),
            "by_type": dict(types),
            "active_plugins": sum(1 for p in self.plugins.values() if p.state == PluginState.ACTIVE),
            "error_plugins": sum(1 for p in self.plugins.values() if p.state == PluginState.ERROR),
            "total_calls": sum(p.call_count for p in self.plugins.values()),
            "dependency_resolver": self.dependency_resolver.get_stats(),
            "sandbox": self.sandbox.get_stats(),
            "event_bus": self.event_bus.get_stats(),
        }
