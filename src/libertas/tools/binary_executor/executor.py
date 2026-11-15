"""职责模块：executor。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple, Union
from collections import defaultdict
import hashlib
import json
import os
import platform
import signal
import subprocess
import threading
import time

from .detector import BinaryPathDetector
from .models import BinaryResult
from .models import BinaryStatus
from .models import CacheEntry
from .constants import DEFAULT_TIMEOUT
from .constants import MAX_CACHE_ENTRIES
from .constants import MAX_OUTPUT_SIZE
from .parser import OutputParser
from .security import SecurityChecker
from .constants import WSL_DISTRO
from .wsl import windows_path_to_wsl

class BinaryExecutor:
    """
    增强二进制工具执行器

    特性：
    - 自动路径检测
    - 平台自适应
    - 安全检查
    - 进程管理
    - 流式输出
    - 输出解析
    - 结果缓存
    - 执行审计
    """

    def __init__(self, default_timeout: float = DEFAULT_TIMEOUT,
                 max_output_size: int = MAX_OUTPUT_SIZE,
                 enable_cache: bool = True,
                 enable_parsing: bool = True,
                 work_dir: str = ""):
        self.executor_id = f"bexec_{hashlib.md5(str(time.time()).encode()).hexdigest()[:8]}"
        self.default_timeout = default_timeout
        self.max_output_size = max_output_size
        self.enable_cache = enable_cache
        self.enable_parsing = enable_parsing
        self.work_dir = work_dir or os.getcwd()

        self.path_detector = BinaryPathDetector()
        self.security_checker = SecurityChecker()
        self.output_parser = OutputParser()

        self._cache: Dict[str, CacheEntry] = {}
        self._running_processes: Dict[str, subprocess.Popen] = {}
        self._audit_log: List[Dict] = []
        self._lock = threading.Lock()
        self._env_overrides: Dict[str, str] = {}

    def set_env(self, key: str, value: str):
        """设置环境变量"""
        self._env_overrides[key] = value

    def register_tool_path(self, tool_name: str, path: str):
        """注册工具路径"""
        self.path_detector.register_path(tool_name, path)

    def execute(self, command: str, args: Optional[List[str]] = None,
                timeout: float = 0.0,
                work_dir: str = "",
                env: Optional[Dict[str, str]] = None,
                stream_callback: Optional[Callable[[str, str], None]] = None,
                use_cache: bool = True,
                parse_output: bool = True) -> BinaryResult:
        """
        执行二进制命令

        Args:
            command: 命令名或完整路径
            args: 参数列表
            timeout: 超时秒数
            work_dir: 工作目录
            env: 环境变量
            stream_callback: 流式输出回调 (stream_name, data)
            use_cache: 是否使用缓存
            parse_output: 是否解析输出

        Returns:
            BinaryResult
        """
        args = args or []
        actual_timeout = timeout or self.default_timeout
        actual_work_dir = work_dir or self.work_dir

        result = BinaryResult(
            command=command,
            args=args,
            started_at=time.time(),
        )

        # 1. 查找二进制路径
        binary_path = self.path_detector.find(command)
        if not binary_path:
            # 尝试作为完整路径
            if os.path.isfile(command) and os.access(command, os.X_OK):
                binary_path = command
            else:
                result.status = BinaryStatus.NOT_FOUND
                result.error = f"未找到二进制工具: {command}"
                result.completed_at = time.time()
                result.duration_ms = (result.completed_at - result.started_at) * 1000
                self._audit(result)
                return result

        result.binary_path = binary_path

        # 检查是否是WSL工具
        is_wsl = binary_path.startswith("wsl://")
        if is_wsl:
            # 构建环境变量（WSL执行需要）
            wsl_env = os.environ.copy()
            wsl_env.update(self._env_overrides)
            if env:
                wsl_env.update(env)
            # 解析WSL路径：wsl://kali-linux/tool_name
            parts = binary_path.replace("wsl://", "").split("/", 1)
            wsl_distro = parts[0] if parts else WSL_DISTRO
            wsl_tool = parts[1] if len(parts) > 1 else command
            # 转换参数中的Windows路径为WSL路径
            wsl_args = [windows_path_to_wsl(arg) if os.path.isabs(arg) else arg for arg in args]
            # 构建WSL命令
            wsl_cmd = ["wsl", "-d", wsl_distro, wsl_tool] + wsl_args
            result.warnings.append(f"通过WSL执行: {wsl_distro}/{wsl_tool}")
            # 直接执行WSL命令
            try:
                result.status = BinaryStatus.RUNNING
                proc = subprocess.run(
                    wsl_cmd,
                    capture_output=True,
                    timeout=actual_timeout,
                    cwd=actual_work_dir,
                    env=wsl_env,
                    encoding="utf-8",
                    errors="replace"
                )
                result.stdout = proc.stdout
                result.stderr = proc.stderr
                result.return_code = proc.returncode
                result.status = BinaryStatus.COMPLETED if proc.returncode == 0 else BinaryStatus.FAILED
                result.completed_at = time.time()
                result.duration_ms = (result.completed_at - result.started_at) * 1000
                result.output = (result.stdout + result.stderr).strip()
                self._audit(result)
                return result
            except subprocess.TimeoutExpired:
                result.status = BinaryStatus.TIMEOUT
                result.error = f"WSL执行超时 ({actual_timeout}秒)"
                result.completed_at = time.time()
                result.duration_ms = (result.completed_at - result.started_at) * 1000
                self._audit(result)
                return result
            except Exception as e:
                result.status = BinaryStatus.FAILED
                result.error = f"WSL执行失败: {str(e)}"
                result.completed_at = time.time()
                result.duration_ms = (result.completed_at - result.started_at) * 1000
                self._audit(result)
                return result

        # 2. 安全检查
        safe, reason = self.security_checker.check_command(binary_path, args)
        if not safe:
            result.status = BinaryStatus.BLOCKED
            result.error = f"命令被安全策略阻止: {reason}"
            result.completed_at = time.time()
            result.duration_ms = (result.completed_at - result.started_at) * 1000
            self._audit(result)
            return result

        # 3. 缓存检查
        cache_key = self._make_cache_key(binary_path, args, actual_work_dir)
        if use_cache and self.enable_cache:
            cached = self._get_cache(cache_key)
            if cached:
                cached.from_cache = True
                cached.started_at = result.started_at
                cached.completed_at = time.time()
                cached.duration_ms = (cached.completed_at - cached.started_at) * 1000
                self._audit(cached)
                return cached

        # 4. 构建环境变量
        exec_env = os.environ.copy()
        exec_env.update(self._env_overrides)
        if env:
            exec_env.update(env)

        # 5. 执行命令
        try:
            result.status = BinaryStatus.RUNNING

            if stream_callback:
                # 流式输出模式
                result = self._execute_streaming(
                    binary_path, args, actual_timeout, actual_work_dir,
                    exec_env, stream_callback, result
                )
            else:
                # 普通模式
                result = self._execute_normal(
                    binary_path, args, actual_timeout, actual_work_dir,
                    exec_env, result
                )

        except subprocess.TimeoutExpired:
            result.status = BinaryStatus.TIMEOUT
            result.error = f"执行超时 ({actual_timeout}秒)"
        except Exception as e:
            result.status = BinaryStatus.FAILED
            result.error = str(e)

        # 6. 收尾
        result.completed_at = time.time()
        result.duration_ms = (result.completed_at - result.started_at) * 1000
        result.output = (result.stdout + result.stderr).strip()

        # 7. 输出解析
        if parse_output and self.enable_parsing and result.status == BinaryStatus.COMPLETED:
            tool_name = os.path.basename(binary_path).lower()
            if tool_name.endswith(".exe"):
                tool_name = tool_name[:-4]
            result.parsed_data = self.output_parser.parse(tool_name, result.stdout)

        # 8. 缓存结果
        if use_cache and self.enable_cache and result.status == BinaryStatus.COMPLETED:
            self._set_cache(cache_key, result)

        # 9. 审计
        self._audit(result)

        return result

    def _execute_normal(self, binary_path: str, args: List[str],
                         timeout: float, work_dir: str, env: Dict,
                         result: BinaryResult) -> BinaryResult:
        """普通执行模式"""
        proc = subprocess.run(
            [binary_path] + args,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=work_dir,
            env=env,
            encoding='utf-8',
            errors='replace',
        )
        result.pid = proc.pid
        result.return_code = proc.returncode
        result.stdout = proc.stdout or ""
        result.stderr = proc.stderr or ""

        # 限制输出大小
        if len(result.stdout) > self.max_output_size:
            result.stdout = result.stdout[:self.max_output_size] + "\n... [输出已截断]"
            result.warnings.append("stdout超过大小限制，已截断")
        if len(result.stderr) > self.max_output_size // 2:
            result.stderr = result.stderr[:self.max_output_size // 2] + "\n... [输出已截断]"
            result.warnings.append("stderr超过大小限制，已截断")

        result.status = BinaryStatus.COMPLETED if proc.returncode == 0 else BinaryStatus.FAILED
        if proc.returncode != 0:
            result.error = f"返回码非零: {proc.returncode}"
        return result

    def _execute_streaming(self, binary_path: str, args: List[str],
                             timeout: float, work_dir: str, env: Dict,
                             stream_callback: Callable,
                             result: BinaryResult) -> BinaryResult:
        """流式输出执行模式"""
        proc = subprocess.Popen(
            [binary_path] + args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=work_dir,
            env=env,
            encoding='utf-8',
            errors='replace',
            bufsize=1,
        )
        result.pid = proc.pid
        exec_id = f"proc_{proc.pid}"

        with self._lock:
            self._running_processes[exec_id] = proc

        stdout_lines = []
        stderr_lines = []

        def read_stream(stream, callback, lines_list, stream_name):
            try:
                for line in iter(stream.readline, ''):
                    lines_list.append(line)
                    try:
                        callback(stream_name, line)
                    except Exception:
                        pass
            except Exception:
                pass

        stdout_thread = threading.Thread(
            target=read_stream, args=(proc.stdout, stream_callback, stdout_lines, "stdout"), daemon=True
        )
        stderr_thread = threading.Thread(
            target=read_stream, args=(proc.stderr, stream_callback, stderr_lines, "stderr"), daemon=True
        )
        stdout_thread.start()
        stderr_thread.start()

        try:
            proc.wait(timeout=timeout)
            stdout_thread.join(timeout=5)
            stderr_thread.join(timeout=5)
            result.return_code = proc.returncode
            result.stdout = "".join(stdout_lines)
            result.stderr = "".join(stderr_lines)
            result.status = BinaryStatus.COMPLETED if proc.returncode == 0 else BinaryStatus.FAILED
            if proc.returncode != 0:
                result.error = f"返回码非零: {proc.returncode}"
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            result.status = BinaryStatus.TIMEOUT
            result.error = f"执行超时 ({timeout}秒)"
            result.stdout = "".join(stdout_lines)
            result.stderr = "".join(stderr_lines)
        finally:
            with self._lock:
                self._running_processes.pop(exec_id, None)

        return result

    def execute_async(self, command: str, args: Optional[List[str]] = None,
                       on_complete: Optional[Callable[[BinaryResult], None]] = None,
                       **kwargs) -> str:
        """异步执行，返回执行ID"""
        exec_id = f"async_{hashlib.md5(f'{command}{time.time()}'.encode()).hexdigest()[:8]}"

        def run():
            result = self.execute(command, args, **kwargs)
            if on_complete:
                try:
                    on_complete(result)
                except Exception:
                    pass

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        return exec_id

    def kill(self, exec_id: str) -> bool:
        """终止运行中的进程"""
        with self._lock:
            proc = self._running_processes.get(exec_id)
            if proc and proc.poll() is None:
                try:
                    if platform.system().lower() == "windows":
                        proc.terminate()
                    else:
                        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                    return True
                except Exception:
                    try:
                        proc.kill()
                        return True
                    except Exception:
                        return False
            return False

    def is_tool_available(self, tool_name: str) -> bool:
        """检查工具是否可用"""
        return self.path_detector.is_available(tool_name)

    def get_available_tools(self, tool_names: List[str]) -> List[str]:
        """获取可用工具列表"""
        return self.path_detector.get_available_tools(tool_names)

    def _make_cache_key(self, binary_path: str, args: List[str], work_dir: str) -> str:
        """生成缓存键"""
        data = json.dumps({
            "binary": binary_path,
            "args": args,
            "work_dir": work_dir,
        }, sort_keys=True)
        return hashlib.sha256(data.encode()).hexdigest()

    def _get_cache(self, key: str) -> Optional[BinaryResult]:
        """获取缓存"""
        entry = self._cache.get(key)
        if entry and not entry.is_expired():
            return entry.result
        if entry and entry.is_expired():
            del self._cache[key]
        return None

    def _set_cache(self, key: str, result: BinaryResult):
        """设置缓存"""
        if len(self._cache) >= MAX_CACHE_ENTRIES:
            # 淘汰最旧的
            oldest_key = min(self._cache.keys(), key=lambda k: self._cache[k].created_at)
            del self._cache[oldest_key]
        # 深拷贝结果，避免缓存被修改
        import copy
        self._cache[key] = CacheEntry(key=key, result=copy.deepcopy(result))

    def clear_cache(self):
        """清空缓存"""
        self._cache.clear()

    def _audit(self, result: BinaryResult):
        """记录审计日志"""
        entry = {
            "timestamp": time.time(),
            "command": result.command,
            "binary_path": result.binary_path,
            "args": result.args,
            "status": result.status.value,
            "return_code": result.return_code,
            "duration_ms": round(result.duration_ms, 2),
            "error": result.error,
            "from_cache": result.from_cache,
        }
        self._audit_log.append(entry)
        if len(self._audit_log) > 1000:
            self._audit_log = self._audit_log[-1000:]

    def get_audit_log(self, limit: int = 100) -> List[Dict]:
        """获取审计日志"""
        return self._audit_log[-limit:]

    def get_stats(self) -> Dict[str, Any]:
        """获取统计"""
        status_counts = defaultdict(int)
        for entry in self._audit_log:
            status_counts[entry["status"]] += 1

        return {
            "executor_id": self.executor_id,
            "default_timeout": self.default_timeout,
            "cache_enabled": self.enable_cache,
            "cache_entries": len(self._cache),
            "running_processes": len(self._running_processes),
            "total_executions": len(self._audit_log),
            "status_counts": dict(status_counts),
            "cached_paths": len(self.path_detector._cache),
        }
