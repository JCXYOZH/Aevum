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


class SandboxCommandMixin:
    """沙箱命令执行、隔离进程与终止。"""

    def execute_command(self, command: str, config: Optional[SandboxConfig] = None,
                        shell: bool = False) -> SandboxResult:
        """在沙箱中执行系统命令（Shell白名单 + 子进程隔离）
    
        Args:
            command: 命令字符串
            config: 沙箱配置
            shell: 是否使用 shell 执行
    
        Returns:
            SandboxResult 执行结果
        """
        config = config or self._default_config
        result = SandboxResult()
        result.status = SandboxStatus.RUNNING
        result.start_time = time.time()
    
        # 1. 空命令检查
        if not command.strip():
            result.status = SandboxStatus.BLOCKED
            result.error = "命令为空"
            result.end_time = time.time()
            result.duration_ms = (result.end_time - result.start_time) * 1000
            return result
    
        # 2. 检查是否允许执行系统命令
        if not config.allow_subprocess:
            result.status = SandboxStatus.BLOCKED
            result.error = "沙箱配置禁止执行系统命令"
            result.end_time = time.time()
            result.duration_ms = (result.end_time - result.start_time) * 1000
            return result
    
        # 3. Shell 白名单检查（如果启用）
        if config.enable_shell_whitelist:
            violation = _check_shell_command(command)
            if violation:
                result.status = SandboxStatus.BLOCKED
                result.error = f"{violation}。允许: {', '.join(sorted(_SHELL_WHITELIST))}"
                result.blocked_operations.append(violation)
                result.end_time = time.time()
                result.duration_ms = (result.end_time - result.start_time) * 1000
                with self._lock:
                    self._results[result.execution_id] = result
                    self._execution_count += 1
                return result
    
        # 4. 网络控制检查
        network = "full" if config.allow_network else config.network_mode
        if network == "none":
            import shlex
            try:
                tokens = shlex.split(command)
                for t in tokens:
                    if os.path.basename(t) in _NETWORK_COMMANDS:
                        result.status = SandboxStatus.BLOCKED
                        result.error = "网络被沙箱禁止"
                        result.blocked_operations.append("网络访问")
                        result.end_time = time.time()
                        result.duration_ms = (result.end_time - result.start_time) * 1000
                        with self._lock:
                            self._results[result.execution_id] = result
                            self._execution_count += 1
                        return result
            except Exception:
                pass
    
        # 5. 构建命令
        if shell:
            if self._is_windows:
                cmd = ["cmd.exe", "/c", command]
            else:
                cmd = ["/bin/bash", "-c", command]
        else:
            cmd = command.split()
    
        # 6. 子进程执行（系统级隔离）
        try:
            exec_result = self._execute_isolated(
                cmd, timeout=config.timeout_seconds,
                cwd=self.work_dir, network=network
            )
    
            result.stdout = exec_result.get("stdout", "")
            result.stderr = exec_result.get("stderr", "")
            result.output = result.stdout + result.stderr
            result.return_code = exec_result.get("returncode", -1)
    
            if exec_result.get("timeout", False):
                result.status = SandboxStatus.TIMEOUT
                result.error = f"命令执行超时 ({config.timeout_seconds}秒)"
            elif result.return_code == 0:
                result.status = SandboxStatus.COMPLETED
            else:
                result.status = SandboxStatus.FAILED
                result.error = f"命令执行失败 (返回码: {result.return_code})"
    
        except Exception as e:
            result.status = SandboxStatus.FAILED
            result.error = str(e)
            result.traceback = traceback.format_exc()
    
        result.end_time = time.time()
        result.duration_ms = (result.end_time - result.start_time) * 1000
    
        # 7. 限制输出长度
        if len(result.output) > config.max_output_chars:
            result.output = result.output[:config.max_output_chars] + "\n... [输出已截断]"
            result.warnings.append("输出超过最大长度，已截断")
    
        with self._lock:
            self._results[result.execution_id] = result
            self._execution_count += 1
            self._total_duration_ms += result.duration_ms
    
        return result

    def _execute_isolated(self, cmd: list, timeout: float, cwd: str,
                          network: str = "none") -> Dict[str, Any]:
        """带系统级隔离的执行（子进程，可以被杀死）
    
        Args:
            cmd: 命令列表
            timeout: 超时秒数
            cwd: 工作目录
            network: 网络模式（none / local / full）
    
        Returns:
            执行结果字典（stdout, stderr, returncode, timeout）
        """
        start = time.time()
        try:
            # 环境变量隔离
            if self._is_windows:
                # Windows: 保留必要的系统环境变量，避免 Python 无法启动
                env = {
                    "PATH": os.environ.get("PATH", ""),
                    "TEMP": cwd,
                    "TMP": cwd,
                    "HOME": cwd,
                    "USERPROFILE": os.environ.get("USERPROFILE", cwd),
                    "SYSTEMROOT": os.environ.get("SYSTEMROOT", "C:\\Windows"),
                    "PATHEXT": os.environ.get("PATHEXT", ".COM;.EXE;.BAT;.CMD"),
                    "COMPUTERNAME": os.environ.get("COMPUTERNAME", "UNKNOWN"),
                    "OS": os.environ.get("OS", "Windows_NT"),
                    "PROCESSOR_ARCHITECTURE": os.environ.get("PROCESSOR_ARCHITECTURE", "AMD64"),
                    "NUMBER_OF_PROCESSORS": os.environ.get("NUMBER_OF_PROCESSORS", "1"),
                }
            else:
                env = {
                    "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
                    "HOME": cwd,
                    "LANG": "en_US.UTF-8",
                    "TMPDIR": cwd,
                }
    
            # macOS: 使用 sandbox-exec 系统级隔离
            if self._is_macos and shutil.which("sandbox-exec"):
                profile = _make_sandbox_profile(cwd, network)
                profile_path = os.path.join(cwd, f".sb_profile_{os.getpid()}")
                try:
                    with open(profile_path, 'w', encoding='utf-8') as f:
                        f.write(profile)
                    full_cmd = ["sandbox-exec", "-f", profile_path] + cmd
                    proc = subprocess.Popen(
                        full_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                        cwd=cwd, env=env
                    )
                finally:
                    try:
                        os.unlink(profile_path)
                    except Exception:
                        pass
            else:
                # Windows/Linux: 基础隔离（cwd + env + timeout）
                proc = subprocess.Popen(
                    cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    cwd=cwd, env=env
                )
    
            # 记录运行中的进程（用于 kill_execution）
            exec_id = f"proc_{id(proc)}"
            self._running_processes[exec_id] = proc
    
            try:
                # 使用 wait 超时，而不是 communicate 超时（避免管道阻塞）
                try:
                    proc.wait(timeout=timeout)
                    timed_out = False
                except subprocess.TimeoutExpired:
                    timed_out = True
                    # 真正杀死进程
                    proc.kill()
                    proc.wait()
    
                # 进程已结束，安全读取输出（不会阻塞）
                try:
                    stdout_bytes, stderr_bytes = proc.communicate(timeout=5)
                except Exception:
                    stdout_bytes = b""
                    stderr_bytes = b""
    
                # 安全解码（使用 errors='replace' 避免 Unicode 错误）
                stdout = self._safe_decode(stdout_bytes)
                stderr = self._safe_decode(stderr_bytes)
    
                elapsed = time.time() - start
                return {
                    "stdout": stdout[-8000:] if stdout else "",
                    "stderr": stderr[-4000:] if stderr else "",
                    "returncode": proc.returncode if not timed_out else -1,
                    "elapsed": round(elapsed, 2),
                    "timeout": timed_out,
                }
            finally:
                self._running_processes.pop(exec_id, None)
    
        except Exception as e:
            return {
                "stdout": "",
                "stderr": str(e),
                "returncode": -1,
                "elapsed": round(time.time() - start, 2),
                "timeout": False,
                "error": str(e),
            }

    def kill_execution(self, execution_id: str) -> bool:
        """终止执行中的进程"""
        # 先检查结果中是否有对应的进程
        result = self._results.get(execution_id)
        if result and result.status == SandboxStatus.RUNNING:
            # 遍历运行中的进程，找到对应的
            for pid, proc in list(self._running_processes.items()):
                try:
                    if proc.poll() is None:  # 还在运行
                        proc.kill()
                        proc.wait()
                        result.status = SandboxStatus.KILLED
                        result.error = "被用户终止"
                        self._running_processes.pop(pid, None)
                        return True
                except Exception:
                    continue
        # 直接尝试杀死所有运行中的进程（保守做法）
        killed = False
        for pid, proc in list(self._running_processes.items()):
            try:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
                    killed = True
            except Exception:
                continue
            self._running_processes.pop(pid, None)
        return killed
