"""插件扩展基础设施: 插件热加载。"""

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



class PluginHotLoader:
    """插件热加载器"""

    def __init__(self, plugins_dir: str = ""):
        self.loader_id = f"hot_{uuid.uuid4().hex[:8]}"
        self.plugins_dir = plugins_dir
        self.loaded_modules: Dict[str, Any] = {}
        self.file_watchers: Dict[str, float] = {}
        self.watch_interval = 2.0
        self._watching = False
        self._watch_thread: Optional[threading.Thread] = None
        self._lock = threading.RLock()
        self.reload_callbacks: List[Callable] = []

    def load_plugin(self, plugin_path: str, isolated: bool = False) -> Tuple[bool, str]:
        """加载插件模块。

        默认在当前进程中加载；当 `isolated=True` 时会在子进程中以更强隔离加载插件（避免插件内的
        SystemExit/致命错误导致主进程退出）。无论哪种方式，发生 `BaseException` 时都会清理已插入的
        `sys.modules` 条目并返回错误信息，而不是让进程退出。
        """
        if not os.path.exists(plugin_path):
            return False, f"插件路径不存在: {plugin_path}"

        module_name = os.path.splitext(os.path.basename(plugin_path))[0]
        if isolated:
            return self.load_plugin_isolated(plugin_path)

        try:
            spec = importlib.util.spec_from_file_location(module_name, plugin_path)
            if spec is None or spec.loader is None:
                return False, "无法创建模块规范"
            module = importlib.util.module_from_spec(spec)
            # 先登记到 sys.modules，便于相互引用；若加载失败需清理
            sys.modules[module_name] = module
            try:
                spec.loader.exec_module(module)
            except BaseException as be:
                # 清理已临时注册的模块，避免半加载状态
                try:
                    if module_name in sys.modules:
                        del sys.modules[module_name]
                except Exception:
                    pass
                # 将致命异常信息返回，而非让进程退出
                return False, f"加载失败 (致命异常): {str(be)}\n{traceback.format_exc()}"

            with self._lock:
                self.loaded_modules[module_name] = module
                self.file_watchers[plugin_path] = os.path.getmtime(plugin_path)
            return True, module_name
        except Exception as e:
            # 普通异常也需尝试清理
            try:
                if module_name in sys.modules:
                    del sys.modules[module_name]
            except Exception:
                pass
            return False, f"加载失败: {str(e)}\n{traceback.format_exc()}"

    def load_plugin_isolated(self, plugin_path: str, timeout: float = 15.0) -> Tuple[bool, str]:
        """在子进程中隔离加载插件文件，避免插件内的 sys.exit/致命异常影响主进程。

        该方法会启动一个短生命周期的 Python 子进程来尝试导入并执行模块顶级逻辑，
        子进程通过 JSON 输出加载结果。
        """
        import subprocess, json, shlex

        module_name = os.path.splitext(os.path.basename(plugin_path))[0]
        loader_code = f"""
import sys, json, traceback, importlib.util
result = {{'success': False, 'error': 'unknown'}}
try:
    spec = importlib.util.spec_from_file_location({module_name!r}, {plugin_path!r})
    if spec is None or spec.loader is None:
        result['error'] = '无法创建模块规范'
    else:
        module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(module)
            result['success'] = True
            result['module'] = {module_name!r}
            result['error'] = ''
        except BaseException as be:
            result['error'] = '致命异常: ' + str(be) + '\\n' + traceback.format_exc()
except Exception as e:
    result['error'] = str(e) + '\\n' + traceback.format_exc()
sys.stdout.write(json.dumps(result, ensure_ascii=False))
"""

        try:
            proc = subprocess.Popen([
                sys.executable, '-c', loader_code
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                out, err = proc.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                return False, f"隔离加载超时 ({timeout}s)"
            out, err = safe_decode(out), safe_decode(err)
            if err:
                # 子进程 stderr 中的信息也很重要
                err = err.strip()
            try:
                payload = json.loads(out or '{}')
            except Exception:
                return False, f"隔离加载解析子进程输出失败: stdout={out!r} stderr={err!r}"
            if payload.get('success'):
                # 不自动把模块导入主进程，保留为已验证可导入的证据
                with self._lock:
                    self.file_watchers[plugin_path] = os.path.getmtime(plugin_path)
                return True, module_name
            else:
                return False, payload.get('error', '未知错误')
        except Exception as e:
            return False, f"启动隔离子进程失败: {e}\n{traceback.format_exc()}"

    def unload_plugin(self, module_name: str) -> bool:
        with self._lock:
            if module_name in self.loaded_modules:
                del self.loaded_modules[module_name]
                if module_name in sys.modules:
                    del sys.modules[module_name]
                return True
        return False

    def reload_plugin(self, module_name: str) -> Tuple[bool, str]:
        """重新加载插件"""
        with self._lock:
            if module_name not in self.loaded_modules:
                return False, f"插件未加载: {module_name}"
            # 找到对应的文件路径
            plugin_path = None
            for path, mtime in self.file_watchers.items():
                if os.path.splitext(os.path.basename(path))[0] == module_name:
                    plugin_path = path
                    break
            if not plugin_path:
                return False, "找不到插件文件路径"

        # 卸载旧模块
        self.unload_plugin(module_name)
        # 重新加载
        success, result = self.load_plugin(plugin_path)
        if success:
            # 触发回调
            for callback in self.reload_callbacks:
                try:
                    callback(module_name, "reloaded")
                except Exception:
                    pass
        return success, result

    def start_watching(self):
        if self._watching:
            return
        self._watching = True

        def watch_loop():
            while self._watching:
                try:
                    self._check_changes()
                except Exception as e:
                    terminal.warn(f"插件文件监控错误: {e}", "plugin_hotloader")
                time.sleep(self.watch_interval)

        self._watch_thread = threading.Thread(target=watch_loop, daemon=True)
        self._watch_thread.start()
        terminal.info("插件热加载监控已启动", "plugin_hotloader")

    def stop_watching(self):
        self._watching = False
        if self._watch_thread:
            self._watch_thread.join(timeout=5)

    def _check_changes(self):
        with self._lock:
            paths = list(self.file_watchers.keys())
        for path in paths:
            if not os.path.exists(path):
                continue
            current_mtime = os.path.getmtime(path)
            with self._lock:
                last_mtime = self.file_watchers.get(path, 0)
            if current_mtime > last_mtime:
                module_name = os.path.splitext(os.path.basename(path))[0]
                terminal.info(f"检测到插件变更: {module_name}", "plugin_hotloader")
                self.reload_plugin(module_name)
                with self._lock:
                    self.file_watchers[path] = current_mtime

    def add_reload_callback(self, callback: Callable):
        self.reload_callbacks.append(callback)

    def list_loaded(self) -> List[str]:
        return list(self.loaded_modules.keys())

    def get_stats(self) -> Dict[str, Any]:
        return {
            "loader_id": self.loader_id,
            "plugins_dir": self.plugins_dir,
            "loaded_modules": len(self.loaded_modules),
            "watched_files": len(self.file_watchers),
            "watching": self._watching,
            "watch_interval": self.watch_interval,
        }
