"""插件扩展基础设施: 插件沙箱执行。"""

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



class PluginSandbox:
    """插件沙箱执行器"""

    def __init__(self):
        self.sandbox_id = f"sbx_{uuid.uuid4().hex[:8]}"
        self.running_plugins: Dict[str, Dict[str, Any]] = {}
        self.max_execution_time = 30.0  # 秒
        self.max_memory_mb = 256
        self.allowed_modules = {
            "json", "time", "uuid", "hashlib", "math", "re",
            "collections", "itertools", "functools", "datetime",
            "typing", "dataclasses", "enum", "copy", "string",
        }
        self.blocked_operations = {
            "os.system", "os.popen", "subprocess", "exec", "eval",
            "__import__", "open", "file", "input", "compile",
        }
        self._lock = threading.RLock()

    def execute(self, plugin_id: str, func: Callable,
                args: Optional[Tuple] = None,
                kwargs: Optional[Dict] = None,
                timeout: float = 0.0) -> Dict[str, Any]:
        """在沙箱中执行插件函数"""
        args = args or ()
        kwargs = kwargs or {}
        timeout = timeout or self.max_execution_time

        result = {
            "plugin_id": plugin_id,
            "success": False,
            "result": None,
            "error": "",
            "execution_time_ms": 0.0,
            "timed_out": False,
        }

        start_time = time.time()
        result_container = {}

        def target():
            try:
                result_container["result"] = func(*args, **kwargs)
                result_container["success"] = True
            except Exception as e:
                result_container["error"] = str(e)
                result_container["traceback"] = traceback.format_exc()
                result_container["success"] = False

        thread = threading.Thread(target=target, daemon=True)
        thread.start()
        thread.join(timeout=timeout)

        if thread.is_alive():
            result["timed_out"] = True
            result["error"] = f"执行超时 ({timeout}秒)"
        else:
            result["success"] = result_container.get("success", False)
            result["result"] = result_container.get("result")
            result["error"] = result_container.get("error", "")

        result["execution_time_ms"] = round((time.time() - start_time) * 1000, 2)

        with self._lock:
            if plugin_id not in self.running_plugins:
                self.running_plugins[plugin_id] = {
                    "total_executions": 0,
                    "total_time_ms": 0.0,
                    "errors": 0,
                    "timeouts": 0,
                }
            stats = self.running_plugins[plugin_id]
            stats["total_executions"] += 1
            stats["total_time_ms"] += result["execution_time_ms"]
            if not result["success"]:
                stats["errors"] += 1
            if result["timed_out"]:
                stats["timeouts"] += 1

        return result

    def execute_isolated(self, plugin_id: str, plugin_path: str,
                         module_name: str, func_name: str,
                         args: Optional[Tuple] = None,
                         kwargs: Optional[Dict] = None,
                         timeout: float = 0.0) -> Dict[str, Any]:
        """在隔离子进程中执行插件函数，返回标准化结果字典。

        注意：args/kwargs 必须可 JSON 序列化。
        """
        args = args or ()
        kwargs = kwargs or {}
        timeout = timeout or self.max_execution_time

        result = {
            "plugin_id": plugin_id,
            "success": False,
            "result": None,
            "error": "",
            "execution_time_ms": 0.0,
            "timed_out": False,
        }

        # 构建在子进程中执行的代码（使用模板替换，避免 f-string 花括号冲突）
        import subprocess, json as _json, time as _time

        _ARGS_JSON = _json.dumps(args)
        _KWARGS_JSON = _json.dumps(kwargs)
        _MODULE_NAME = repr(module_name)
        _PLUGIN_PATH = repr(plugin_path)
        _FUNC_NAME = repr(func_name)

        loader_template = '''
import sys, json, traceback, importlib.util, time
result = {'success': False, 'result': None, 'error': 'unknown', 'duration_ms': 0}
start = time.time()
try:
    spec = importlib.util.spec_from_file_location(MODULE_NAME, PLUGIN_PATH)
    if spec is None or spec.loader is None:
        result['error'] = '无法创建模块规范'
    else:
        module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(module)
            func = getattr(module, FUNC_NAME, None)
            if func is None:
                result['error'] = '函数不存在: ' + FUNC_NAME
            else:
                try:
                    args = json.loads(ARGS_JSON)
                    kwargs = json.loads(KWARGS_JSON)
                except Exception:
                    args = ()
                    kwargs = {}
                try:
                    r = func(*args, **kwargs)
                    result['success'] = True
                    try:
                        json.dumps(r)
                        result['result'] = r
                    except Exception:
                        result['result'] = str(r)
                    result['error'] = ''
                except BaseException as be:
                    result['error'] = '致命异常: ' + str(be) + '\n' + traceback.format_exc()
        except BaseException as be:
            result['error'] = '模块加载失败: ' + str(be) + '\n' + traceback.format_exc()
except Exception as e:
    result['error'] = str(e) + '\n' + traceback.format_exc()
end = time.time()
result['duration_ms'] = int((end - start) * 1000)
sys.stdout.write(json.dumps(result, ensure_ascii=False))
'''

        loader_code = loader_template.replace('MODULE_NAME', _MODULE_NAME)
        loader_code = loader_code.replace('PLUGIN_PATH', _PLUGIN_PATH)
        loader_code = loader_code.replace('FUNC_NAME', _FUNC_NAME)
        loader_code = loader_code.replace('ARGS_JSON', repr(_ARGS_JSON))
        loader_code = loader_code.replace('KWARGS_JSON', repr(_KWARGS_JSON))

        try:
            proc = subprocess.Popen([
                sys.executable, '-c', loader_code
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                out, err = proc.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                result['timed_out'] = True
                result['error'] = f"执行超时 ({timeout}s)"
                return result

            # 子进程输出编码不可知（Windows 中文环境按区域编码解码会抛 UnicodeDecodeError）
            out, err = safe_decode(out), safe_decode(err)
            if out:
                try:
                    payload = _json.loads(out)
                except Exception:
                    result['error'] = f"解析子进程输出失败: stdout={out!r} stderr={err!r}"
                    return result
                result['success'] = payload.get('success', False)
                result['result'] = payload.get('result')
                result['error'] = payload.get('error', '')
                result['execution_time_ms'] = payload.get('duration_ms', 0)
                return result
            else:
                result['error'] = (err or '').strip() or '子进程无输出'
                return result
        except Exception as e:
            result['error'] = f"启动子进程失败: {e}"
            return result

    def get_plugin_stats(self, plugin_id: str) -> Optional[Dict]:
        return self.running_plugins.get(plugin_id)

    def get_stats(self) -> Dict[str, Any]:
        total_executions = sum(s["total_executions"] for s in self.running_plugins.values())
        total_errors = sum(s["errors"] for s in self.running_plugins.values())
        total_time = sum(s["total_time_ms"] for s in self.running_plugins.values())
        return {
            "sandbox_id": self.sandbox_id,
            "tracked_plugins": len(self.running_plugins),
            "total_executions": total_executions,
            "total_errors": total_errors,
            "error_rate": round(total_errors / max(total_executions, 1), 4),
            "total_time_ms": round(total_time, 2),
            "avg_time_ms": round(total_time / max(total_executions, 1), 2),
            "max_execution_time": self.max_execution_time,
            "allowed_modules": len(self.allowed_modules),
            "blocked_operations": len(self.blocked_operations),
        }
