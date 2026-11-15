"""
统一工具调度中心

整合所有工具来源：
- core/tool_library.py 内置工具定义
- tools/ 目录的26个内置工具（20,167行）
- plugins/ 目录的26个可扩展插件（2,553行）
- core/binary_executor.py 二进制工具
- security/ 安全工具
- 自定义动态注册工具

提供统一的：工具注册、发现、匹配、执行、治理、统计接口。
"""
import os
import sys
import json
import logging
import time
import uuid
import importlib
import importlib.util
import inspect
import threading
import traceback
from typing import Any, Dict, List, Optional, Tuple, Callable, Union
from collections import defaultdict
from enum import Enum
from dataclasses import dataclass, field

from libertas.tools.tool_library import (
    ToolDefinition, ToolParameter, ToolResult,
    ToolRiskLevel, ToolCategory, ToolStatus,
)
from libertas.tools.tool_governance import ToolGovernance as ToolGovernanceManager
from libertas.tools.tool_matcher import ToolMatcher
from libertas.tools.binary_executor import BinaryExecutor
from libertas.utils.text_decode import decode_output, describe_exception

logger = logging.getLogger(__name__)

from .models import ToolSource, ToolHealth, ToolRegistration, UnifiedToolResult


class UnifiedToolExecutionMixin:
    """工具执行、处理函数、实例方法、二进制、命令与批量执行。"""

    def execute_tool(self, tool_name: str,
                     parameters: Optional[Dict] = None,
                     timeout: Optional[float] = None,
                     context: Optional[Dict] = None) -> UnifiedToolResult:
        """
        统一工具执行接口。
    
        根据工具来源自动选择执行方式：
        - PLUGIN / DYNAMIC: 直接调用 handler
        - TOOLS_DIR: 调用 instance.method 或 handler
        - BINARY: 通过 binary_executor 执行
        - BUILTIN: 调用 handler 或 command
        """
        parameters = parameters or {}
        start = time.time()
    
        result = UnifiedToolResult(
            tool_name=tool_name,
            parameters=parameters,
            started_at=start,
        )
    
        # 查找工具
        registration = self._get_registration(tool_name)
        if not registration:
            result.success = False
            result.status = "failed"
            result.error = f"工具未找到: {tool_name}"
            result.error_type = "ToolNotFound"
            result.completed_at = time.time()
            result.duration_ms = (time.time() - start) * 1000
            return result
    
        result.tool_id = registration.tool_id
        result.source = registration.source.value
    
        # 治理检查
        if self.governance:
            try:
                allowed, reason = self.governance.can_execute(
                    tool_name=tool_name,
                    user_id=(context or {}).get("user_id", ""),
                    permissions=(context or {}).get("permissions"),
                )
                # 如果工具未在治理中注册，允许执行（治理是可选增强）
                if not allowed and "未注册" not in reason:
                    result.success = False
                    result.status = "blocked"
                    result.error = f"工具执行被治理策略阻止: {reason}"
                    result.error_type = "GovernanceBlocked"
                    result.completed_at = time.time()
                    result.duration_ms = (time.time() - start) * 1000
                    return result
            except Exception:
                # 治理检查失败不阻止执行
                pass
    
        # 参数验证
        valid, errors = registration.definition.validate_parameters(parameters)
        if not valid:
            result.success = False
            result.status = "failed"
            result.error = f"参数验证失败: {'; '.join(errors)}"
            result.error_type = "ParameterValidationError"
            result.completed_at = time.time()
            result.duration_ms = (time.time() - start) * 1000
            return result
    
        # 执行超时
        exec_timeout = timeout or registration.definition.timeout
    
        try:
            # 根据来源执行
            if registration.source == ToolSource.BINARY:
                exec_result = self._execute_binary(registration, parameters, exec_timeout)
            elif registration.instance and registration.method_name:
                exec_result = self._execute_instance_method(registration, parameters)
            elif registration.definition.handler:
                exec_result = self._execute_handler(registration, parameters)
            elif registration.definition.command:
                exec_result = self._execute_command(registration, parameters, exec_timeout)
            else:
                raise RuntimeError(f"工具 {tool_name} 没有可执行的 handler/command/instance")
    
            # 处理结果
            result.success = True
            result.status = "success"
            result.data = exec_result.get("data", exec_result)
            result.raw_output = str(exec_result.get("raw_output", exec_result))
            if isinstance(exec_result, dict) and "error" in exec_result and not exec_result.get("success", True):
                result.success = False
                result.error = str(exec_result["error"])
                result.error_type = "ToolExecutionError"
                result.error_kind = str(exec_result.get("error_kind", ""))
    
            registration.health = ToolHealth.HEALTHY
            registration.consecutive_errors = 0
    
        except Exception as e:
            result.success = False
            result.status = "failed"
            # 回给用户/模型的是人话；原始异常细节只进服务端日志与 error_detail，
            # 不再把整段 traceback 当作 raw_output 塞进上下文。
            friendly, kind = describe_exception(e)
            result.error = friendly
            result.error_type = type(e).__name__
            result.error_kind = kind
            result.error_detail = f"{type(e).__name__}: {str(e)[:500]}"
            result.raw_output = ""
            logger.exception("工具执行异常: %s", tool_name)
    
            registration.error_count += 1
            registration.consecutive_errors += 1
            if registration.consecutive_errors >= 5:
                registration.health = ToolHealth.BROKEN
            elif registration.consecutive_errors >= 2:
                registration.health = ToolHealth.DEGRADED
    
        finally:
            result.completed_at = time.time()
            result.duration_ms = (time.time() - start) * 1000
            registration.last_called_at = time.time()
            registration.definition.call_count += 1
            if result.success:
                registration.definition.success_count += 1
                self._total_success += 1
            else:
                registration.definition.failure_count += 1
                self._total_failed += 1
            registration.definition.total_duration_ms += result.duration_ms
            self._total_calls += 1
            self._total_duration_ms += result.duration_ms
    
            # 治理记录
            if self.governance:
                self.governance.record_usage(
                    tool_name=tool_name,
                    success=result.success,
                    duration_ms=result.duration_ms,
                    parameters=parameters,
                )
    
        return result

    def _execute_handler(self, registration: ToolRegistration,
                         parameters: Dict) -> Any:
        """执行 handler 函数"""
        handler = registration.definition.handler
        if not handler:
            raise RuntimeError("工具没有 handler")
    
        # 过滤参数，只传递 handler 接受的参数
        try:
            sig = inspect.signature(handler)
            accepted_params = set(sig.parameters.keys())
            filtered = {k: v for k, v in parameters.items() if k in accepted_params}
        except (ValueError, TypeError):
            filtered = parameters
    
        return handler(**filtered)

    def _execute_instance_method(self, registration: ToolRegistration,
                                 parameters: Dict) -> Any:
        """执行实例方法"""
        instance = registration.instance
        if not instance:
            # 尝试重新实例化
            if registration.module_path and registration.class_name:
                module = sys.modules.get(registration.module_path)
                if module:
                    cls = getattr(module, registration.class_name, None)
                    if cls:
                        instance = cls()
                        registration.instance = instance
        if not instance:
            raise RuntimeError(f"无法获取实例: {registration.class_name}")
    
        method = getattr(instance, registration.method_name, None)
        if not method or not callable(method):
            raise RuntimeError(f"方法不存在: {registration.method_name}")
    
        # 过滤参数
        try:
            sig = inspect.signature(method)
            accepted_params = set(sig.parameters.keys()) - {"self"}
            filtered = {k: v for k, v in parameters.items() if k in accepted_params}
        except (ValueError, TypeError):
            filtered = parameters
    
        return method(**filtered)

    def _execute_binary(self, registration: ToolRegistration,
                        parameters: Dict, timeout: float) -> Dict:
        """执行二进制工具"""
        args = parameters.get("args", [])
        if isinstance(args, str):
            args = [args]
        binary_name = registration.definition.command or registration.name.replace("binary_", "")
        result = self.binary_executor.execute(
            command=binary_name,
            args=args,
            timeout=timeout,
        )
        return {
            "data": result,
            "raw_output": result.get("output", "") if isinstance(result, dict) else str(result),
        }

    def _execute_command(self, registration: ToolRegistration,
                         parameters: Dict, timeout: float) -> Dict:
        """执行命令行工具"""
        import subprocess
        cmd = registration.definition.command
        if not cmd:
            raise RuntimeError("工具没有 command")
    
        # 简单的参数替换
        for key, value in parameters.items():
            cmd = cmd.replace(f"{{{key}}}", str(value))
    
        # 以字节取回再级联解码：text=True 会按系统区域编码（Windows 中文环境
        # =cp936）解码，UTF-8 的工具输出会直接抛 UnicodeDecodeError。
        result = subprocess.run(
            cmd, shell=True, capture_output=True,
            timeout=timeout, cwd=os.getcwd(),
        )
        stdout_text = decode_output(result.stdout)
        stderr_text = decode_output(result.stderr)
        out = {
            "data": {
                "returncode": result.returncode,
                "stdout": stdout_text,
                "stderr": stderr_text,
            },
            "raw_output": stdout_text or stderr_text,
            "success": result.returncode == 0,
        }
        if result.returncode != 0:
            # 非零退出必须如实上报为失败（此前恒报 success=True，用户看不到原因）
            from ..tools.native_tools import external_exit_error as _exit_error
            out["error"] = _exit_error(result.returncode, stderr_text, stdout_text)
            out["error_kind"] = ("missing_binary"
                                 if result.returncode == 127 else "nonzero_exit")
            out["stderr_tail"] = stderr_text[-500:]
        return out

    def batch_execute(self, tasks: List[Dict],
                      max_concurrent: int = 5,
                      continue_on_error: bool = True) -> List[UnifiedToolResult]:
        """
        批量执行工具。
    
        tasks 格式:
        [
            {"tool": "tool_name", "parameters": {...}, "timeout": 30.0},
            ...
        ]
        """
        results = []
        semaphore = threading.Semaphore(max_concurrent)
        result_lock = threading.Lock()
    
        def execute_task(task: Dict):
            with semaphore:
                try:
                    result = self.execute_tool(
                        tool_name=task.get("tool", ""),
                        parameters=task.get("parameters", {}),
                        timeout=task.get("timeout"),
                        context=task.get("context"),
                    )
                except Exception as e:
                    result = UnifiedToolResult(
                        success=False,
                        tool_name=task.get("tool", ""),
                        error=str(e),
                        error_type=type(e).__name__,
                        status="failed",
                    )
                with result_lock:
                    results.append(result)
    
        threads = []
        for task in tasks:
            t = threading.Thread(target=execute_task, args=(task,), daemon=True)
            threads.append(t)
            t.start()
    
        for t in threads:
            t.join(timeout=300)
    
        return results
