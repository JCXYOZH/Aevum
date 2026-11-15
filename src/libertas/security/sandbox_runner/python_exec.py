"""
沙箱执行环境

结合两个版本的优点：
- 现在版本的功能丰富性：SandboxConfig、SandboxResult、结果管理、执行终止、统计、输入注入
- 0.1.5版本的安全机制：AST解析、Shell白名单、系统级隔离（macOS sandbox-exec）
- 用子进程执行代替线程内exec，真正的隔离，可以被杀死
"""
import os
import sys
import ast
import json
import time
import uuid
import shutil
import platform
import signal
import threading
import subprocess
import tempfile
import traceback
from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

from .checks import _check_python_ast, _check_shell_command, _make_sandbox_profile
from .models import SandboxConfig, SandboxResult, SandboxStatus, SandboxViolation


class SandboxPythonMixin:
    """沙箱 Python 执行、runner 脚本与结果解析。"""

    def execute_python(self, code: str, config: Optional[SandboxConfig] = None,
                       inputs: Optional[Dict[str, Any]] = None) -> SandboxResult:
        """在沙箱中执行Python代码（AST检查 + 子进程隔离）
    
        Args:
            code: Python 代码
            config: 沙箱配置
            inputs: 输入变量（会被注入到子进程的 globals 中）
    
        Returns:
            SandboxResult 执行结果
        """
        config = config or self._default_config
        result = SandboxResult()
        result.status = SandboxStatus.RUNNING
        result.start_time = time.time()
    
        # 1. 空代码检查
        if not code.strip():
            result.status = SandboxStatus.BLOCKED
            result.error = "代码为空"
            result.end_time = time.time()
            result.duration_ms = (result.end_time - result.start_time) * 1000
            return result
    
        # 2. AST 安全检查（如果启用）
        if config.enable_ast_check:
            violation = _check_python_ast(code)
            if violation:
                result.status = SandboxStatus.BLOCKED
                result.error = f"安全限制: {violation}"
                result.blocked_operations.append(violation)
                result.end_time = time.time()
                result.duration_ms = (result.end_time - result.start_time) * 1000
                with self._lock:
                    self._results[result.execution_id] = result
                    self._execution_count += 1
                return result
    
        # 3. 风险评估（仅警告，不阻止）
        risk_score, risks = self.assess_risk(code)
        result.risk_score = risk_score
        result.risks = risks
        if risk_score > 0.3:
            result.warnings.append(f"高风险代码 (风险评分: {risk_score:.2f})")
            result.warnings.extend([f"检测到: {r}" for r in risks])
    
        # 4. 构建执行脚本（注入 inputs + 捕获结果）
        inputs = inputs or {}
        runner_script = self._build_runner_script(code, inputs, config)
    
        # 5. 写入临时文件（避免命令行注入）
        tmp_file = None
        try:
            tmp_file = tempfile.NamedTemporaryFile(
                mode='w', suffix='.py', dir=self.work_dir,
                delete=False, encoding='utf-8'
            )
            tmp_file.write(runner_script)
            tmp_file.close()
    
            # 6. 子进程执行（系统级隔离）
            network = "full" if config.allow_network else config.network_mode
            cmd = [sys.executable, tmp_file.name]
            exec_result = self._execute_isolated(
                cmd, timeout=config.timeout_seconds,
                cwd=self.work_dir, network=network
            )
    
            # 7. 解析结果
            raw_stdout = exec_result.get("stdout", "")
            result.stderr = exec_result.get("stderr", "")
            result.return_code = exec_result.get("returncode", -1)
    
            # 从 stdout 中提取并移除 __RESULT__ 行
            result.result_value = self._extract_result_value(raw_stdout)
            result.stdout = self._remove_result_marker(raw_stdout)
            result.output = result.stdout + result.stderr
    
            if exec_result.get("timeout", False):
                result.status = SandboxStatus.TIMEOUT
                result.error = f"执行超时 ({config.timeout_seconds}秒)"
            elif result.return_code == 0:
                result.status = SandboxStatus.COMPLETED
            else:
                result.status = SandboxStatus.FAILED
                result.error = exec_result.get("error", "") or f"执行失败 (返回码: {result.return_code})"
                result.traceback = result.stderr
    
        except Exception as e:
            result.status = SandboxStatus.FAILED
            result.error = str(e)
            result.traceback = traceback.format_exc()
        finally:
            # 清理临时文件
            if tmp_file:
                try:
                    os.unlink(tmp_file.name)
                except Exception:
                    pass
    
        result.end_time = time.time()
        result.duration_ms = (result.end_time - result.start_time) * 1000
    
        # 8. 限制输出长度
        if len(result.output) > config.max_output_chars:
            result.output = result.output[:config.max_output_chars] + "\n... [输出已截断]"
            result.warnings.append("输出超过最大长度，已截断")
    
        with self._lock:
            self._results[result.execution_id] = result
            self._execution_count += 1
            self._total_duration_ms += result.duration_ms
    
        return result
    
        def _build_runner_script(self, code: str, inputs: Dict[str, Any],
                                  config: SandboxConfig) -> str:
            """构建子进程执行脚本（注入 inputs + 受限环境 + 捕获结果）"""
            # 序列化 inputs
            inputs_json = json.dumps(inputs, ensure_ascii=False, default=str)
            allowed_modules_json = json.dumps(config.allowed_modules)
    
            script = f'''
    import sys
    import json
    import io
    
    # 注入输入变量
    try:
        inputs = json.loads({inputs_json!r})
        globals().update(inputs)
    except Exception:
        pass
    
    # 受限的 __import__（只允许白名单模块）
    _allowed_modules = set(json.loads({allowed_modules_json!r}))
    _original_import = __builtins__.__import__ if hasattr(__builtins__, '__import__') else __import__
    def _safe_import(name, *args, **kwargs):
        top = name.split('.')[0]
        if top not in _allowed_modules:
            raise ImportError(f"模块 '{{name}}' 在沙箱中被禁止")
        return _original_import(name, *args, **kwargs)
    
    try:
        __builtins__.__import__ = _safe_import
    except (AttributeError, TypeError):
        try:
            import builtins
            builtins.__import__ = _safe_import
        except Exception:
            pass
    
    # 重定向 stdout 到捕获
    class _OutputCapture:
        def __init__(self):
            self.buffer = io.StringIO()
        def write(self, s):
            self.buffer.write(s)
        def flush(self):
            pass
        def getvalue(self):
            return self.buffer.getvalue()
    
    _stdout_capture = _OutputCapture()
    _stderr_capture = _OutputCapture()
    _old_stdout = sys.stdout
    _old_stderr = sys.stderr
    sys.stdout = _stdout_capture
    sys.stderr = _stderr_capture
    
    _result_value = None
    try:
        # 执行用户代码
        exec(compile({code!r}, "<sandbox>", "exec"), globals())
        # 尝试获取 __result__
        _result_value = globals().get("__result__", None)
    except Exception as e:
        import traceback
        sys.stderr.write(traceback.format_exc())
        sys.exit(1)
    finally:
        sys.stdout = _old_stdout
        sys.stderr = _old_stderr
    
    # 输出捕获的 stdout/stderr
    sys.__stdout__.write(_stdout_capture.getvalue())
    sys.__stderr__.write(_stderr_capture.getvalue())
    
    # 输出结果值（JSON 格式，最后一行）
    if _result_value is not None:
        try:
            sys.__stdout__.write("\\n__RESULT__:" + json.dumps(_result_value, default=str, ensure_ascii=False))
        except Exception:
            pass
    '''
            return script

    def _extract_result_value(self, stdout: str) -> Any:
        """从 stdout 中提取结果值（最后一行的 __RESULT__: JSON）"""
        if not stdout:
            return None
        lines = stdout.strip().split('\n')
        for line in reversed(lines):
            if line.startswith("__RESULT__:"):
                try:
                    return json.loads(line[len("__RESULT__:"):])
                except Exception:
                    return None
        return None

    def _remove_result_marker(self, stdout: str) -> str:
        """从 stdout 中移除 __RESULT__ 标记行"""
        if not stdout:
            return ""
        lines = stdout.split('\n')
        cleaned = [line for line in lines if not line.startswith("__RESULT__:")]
        return '\n'.join(cleaned).rstrip()

    def _safe_decode(self, data: bytes) -> str:
        """安全解码字节数据（尝试 UTF-8，失败则用 GBK，最后用 replace）"""
        if not data:
            return ""
        if isinstance(data, str):
            return data
        # 尝试 UTF-8
        try:
            return data.decode('utf-8')
        except UnicodeDecodeError:
            pass
        # 尝试 GBK（Windows 中文系统）
        try:
            return data.decode('gbk')
        except UnicodeDecodeError:
            pass
        # 最后用 replace 避免错误
        return data.decode('utf-8', errors='replace')
