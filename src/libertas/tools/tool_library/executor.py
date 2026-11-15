"""职责模块：executor。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, Union
import os
import re
from libertas.foundation.byte_stream import safe_decode
import subprocess
import threading
import time
import uuid

from .registry import ToolRegistry
from .models import ToolResult

class ToolExecutor:
    """工具执行器 - 同步/异步执行、超时控制、重试、沙箱"""

    def __init__(self, registry: ToolRegistry,
                 default_timeout: float = 30.0,
                 max_concurrent: int = 5):
        self.executor_id = f"exec_{uuid.uuid4().hex[:8]}"
        self.registry = registry
        self.default_timeout = default_timeout
        self.max_concurrent = max_concurrent
        self.running: Dict[str, threading.Thread] = {}
        self.results: Dict[str, ToolResult] = {}
        self._lock = threading.RLock()
        self._semaphore = threading.Semaphore(max_concurrent)

    def execute(self, tool_name: str, parameters: Optional[Dict] = None,
                timeout: Optional[float] = None,
                on_complete: Optional[Callable] = None) -> ToolResult:
        """同步执行工具（拆分后的主方法）"""
        parameters = parameters or {}
        tool = self.registry.get(tool_name)
        result = ToolResult(tool_name=tool_name, status="running")
        result.parameters = parameters
        result.started_at = time.time()

        # 前置校验（工具存在/启用/参数合法）
        validation_error = self._validate_tool_for_execution(tool, tool_name, parameters, result)
        if validation_error:
            return validation_error

        # 填充默认参数
        self._fill_default_parameters(tool, parameters)

        # 带重试的执行
        explicit_timeout = timeout if timeout is not None else tool.timeout
        if explicit_timeout == 0:
            actual_timeout = None
        else:
            actual_timeout = explicit_timeout or self.default_timeout
        self._execute_with_retry(tool, parameters, actual_timeout, result)

        # 收尾：统计 + 回调
        result.completed_at = time.time()
        result.duration_ms = (result.completed_at - result.started_at) * 1000
        self._update_tool_execution_stats(tool, result)
        if on_complete:
            try:
                on_complete(result)
            except Exception:
                pass
        return result

    def _validate_tool_for_execution(self, tool, tool_name, parameters, result):
        """执行前校验：工具存在性、启用状态、参数合法性。失败返回result，成功返回None"""
        if not tool:
            result.status = "failed"
            result.error = f"工具不存在: {tool_name}"
            result.error_type = "ToolNotFound"
            result.completed_at = time.time()
            result.duration_ms = (result.completed_at - result.started_at) * 1000
            return result
        if not tool.enabled:
            result.status = "failed"
            result.error = f"工具已禁用: {tool_name}"
            result.error_type = "ToolDisabled"
            result.completed_at = time.time()
            result.duration_ms = (result.completed_at - result.started_at) * 1000
            return result
        valid, errors = tool.validate_parameters(parameters)
        if not valid:
            result.status = "failed"
            result.error = "; ".join(errors)
            result.error_type = "ParameterValidationError"
            result.completed_at = time.time()
            result.duration_ms = (result.completed_at - result.started_at) * 1000
            return result
        return None

    def _fill_default_parameters(self, tool, parameters):
        """为缺失的参数填充默认值"""
        for param in tool.parameters:
            if param.name not in parameters and param.default is not None:
                parameters[param.name] = param.default

    def _execute_with_retry(self, tool, parameters, actual_timeout, result):
        """带指数退避重试的执行循环"""
        retries = tool.max_retries
        for attempt in range(retries + 1):
            try:
                with self._semaphore:
                    if tool.handler:
                        output = tool.handler(**parameters)
                        result.raw_output = str(output) if not isinstance(output, str) else output
                        result.data = output
                    elif tool.command:
                        cmd = self._build_command(tool.command, parameters)
                        output, return_code, error = self._run_command(cmd, actual_timeout)
                        result.raw_output = output
                        result.return_code = return_code
                        if return_code != 0 and error:
                            raise Exception(f"命令执行失败 (返回码 {return_code}): {error}")
                    else:
                        raise Exception("工具没有定义handler或command")
                result.status = "success"
                break
            except subprocess.TimeoutExpired:
                result.status = "timeout"
                result.error = f"执行超时 ({actual_timeout}秒)"
                result.error_type = "Timeout"
            except Exception as e:
                result.status = "failed"
                result.error = str(e)
                result.error_type = type(e).__name__
                if attempt < retries:
                    time.sleep(min(2 ** attempt, 10))

    def _update_tool_execution_stats(self, tool, result):
        """更新工具的调用统计"""
        with tool._lock:
            tool.call_count += 1
            tool.total_duration_ms += result.duration_ms
            if result.status == "success":
                tool.success_count += 1
            else:
                tool.failure_count += 1

    def execute_async(self, tool_name: str, parameters: Optional[Dict] = None,
                      on_complete: Optional[Callable] = None) -> str:
        """异步执行工具，返回执行ID"""
        exec_id = f"async_{uuid.uuid4().hex[:8]}"

        def run():
            result = self.execute(tool_name, parameters, on_complete=on_complete)
            with self._lock:
                self.results[exec_id] = result
                self.running.pop(exec_id, None)

        thread = threading.Thread(target=run, daemon=True)
        with self._lock:
            self.running[exec_id] = thread
        thread.start()
        return exec_id

    def get_async_result(self, exec_id: str) -> Optional[ToolResult]:
        return self.results.get(exec_id)

    def is_running(self, exec_id: str) -> bool:
        return exec_id in self.running

    def wait_for(self, exec_id: str, timeout: float = 60.0) -> Optional[ToolResult]:
        """等待异步执行完成"""
        start = time.time()
        while exec_id in self.running and time.time() - start < timeout:
            time.sleep(0.1)
        return self.results.get(exec_id)

    def execute_parallel(self, tasks: List[Tuple[str, Dict]],
                         timeout: float = 0.0) -> List[ToolResult]:
        """并行执行多个工具"""
        results = []
        threads = []
        result_container: Dict[int, ToolResult] = {}

        def run_task(idx, name, params):
            result_container[idx] = self.execute(name, params, timeout)

        for i, (name, params) in enumerate(tasks):
            t = threading.Thread(target=run_task, args=(i, name, params), daemon=True)
            threads.append(t)
            t.start()

        for t in threads:
            if timeout and timeout > 0:
                t.join(timeout=timeout)
            else:
                t.join()

        for i in range(len(tasks)):
            if i in result_container:
                results.append(result_container[i])
            else:
                r = ToolResult(tool_name=tasks[i][0], status="timeout")
                r.error = "并行执行超时"
                results.append(r)
        return results

    def _build_command(self, template: str, parameters: Dict) -> str:
        """构建命令行"""
        cmd = template
        for key, value in parameters.items():
            placeholder = "{" + key + "}"
            if placeholder in cmd:
                if isinstance(value, bool):
                    cmd = cmd.replace(placeholder, "" if value else "")
                elif isinstance(value, list):
                    cmd = cmd.replace(placeholder, " ".join(str(v) for v in value))
                else:
                    cmd = cmd.replace(placeholder, str(value))
        # 移除未填充的可选参数占位符
        cmd = re.sub(r'\{[^}]+\}', '', cmd)
        return cmd.strip()

    def _run_command(self, command: str, timeout: Optional[float]) -> Tuple[str, int, str]:
        """运行命令行"""
        try:
            if os.name == 'nt':
                proc = subprocess.run(
                    command, shell=True, capture_output=True, text=True,
                    timeout=timeout, encoding='utf-8', errors='replace'
                )
            else:
                proc = subprocess.run(
                    command, shell=True, capture_output=True,
                    timeout=timeout, executable='/bin/bash'
                )
            # 不请求 text=True：由 safe_decode 级联解码，避免 Windows 中文环境按 cp936 解码 UTF-8 输出
            return safe_decode(proc.stdout), proc.returncode, safe_decode(proc.stderr)
        except subprocess.TimeoutExpired:
            raise
        except Exception as e:
            return "", -1, str(e)

    def get_stats(self) -> Dict[str, Any]:
        return {
            "executor_id": self.executor_id,
            "default_timeout": self.default_timeout,
            "max_concurrent": self.max_concurrent,
            "running_tasks": len(self.running),
            "completed_tasks": len(self.results),
        }
