"""
工具管理器

管理工具的生命周期：发现、注册、初始化、启用、调用、禁用、卸载。
支持依赖管理、配置、状态监控、分组、导入导出。
"""
import os
import json
import time
import uuid
import importlib
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal
from libertas.utils.text_decode import decode_output, describe_exception


class ToolStatus(Enum):
    UNLOADED = "unloaded"
    LOADING = "loading"
    READY = "ready"
    RUNNING = "running"
    ERROR = "error"
    MAINTENANCE = "maintenance"
    DISABLED = "disabled"

class ToolMetadata:
    """工具元数据"""

    def __init__(self, name: str = "", description: str = "",
                 version: str = "1.0.0", author: str = "",
                 category: str = "general",
                 parameters: Optional[Dict[str, Any]] = None,
                 returns: str = "",
                 risk_level: str = "low",  # safe / low / medium / high / dangerous
                 required_permissions: Optional[List[str]] = None,
                 dependencies: Optional[List[str]] = None,
                 tags: Optional[List[str]] = None,
                 timeout: float = 60.0,
                 max_retries: int = 2):
        self.name = name
        self.description = description
        self.version = version
        self.author = author
        self.category = category
        self.parameters = parameters or {}
        self.returns = returns
        self.risk_level = risk_level
        self.required_permissions = required_permissions or []
        self.dependencies = dependencies or []
        self.tags = tags or []
        self.timeout = timeout
        self.max_retries = max_retries
        self.created_at = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name, "description": self.description,
            "version": self.version, "author": self.author,
            "category": self.category, "parameters": self.parameters,
            "returns": self.returns, "risk_level": self.risk_level,
            "required_permissions": self.required_permissions,
            "dependencies": self.dependencies, "tags": self.tags,
            "timeout": self.timeout, "max_retries": self.max_retries,
        }

class ToolInstance:
    """工具实例"""

    def __init__(self, metadata: ToolMetadata,
                 handler: Optional[Callable] = None,
                 init_handler: Optional[Callable] = None,
                 cleanup_handler: Optional[Callable] = None):
        self.metadata = metadata
        self.handler = handler
        self.init_handler = init_handler
        self.cleanup_handler = cleanup_handler
        self.status = ToolStatus.UNLOADED
        self.instance: Any = None
        self.config: Dict[str, Any] = {}
        self.call_count = 0
        self.success_count = 0
        self.failure_count = 0
        self.total_duration_ms = 0.0
        self.last_called = 0.0
        self.last_error = ""
        self.loaded_at = 0.0
        self.error_count = 0
        self.max_errors = 5

    def initialize(self, config: Optional[Dict[str, Any]] = None) -> bool:
        """初始化工具"""
        self.status = ToolStatus.LOADING
        self.config = config or {}
        try:
            if self.init_handler:
                self.instance = self.init_handler(self.config)
            self.status = ToolStatus.READY
            self.loaded_at = time.time()
            self.error_count = 0
            terminal.success(f"工具初始化成功: {self.metadata.name}", "tool_manager")
            return True
        except Exception as e:
            self.status = ToolStatus.ERROR
            self.last_error = str(e)
            self.error_count += 1
            terminal.error(f"工具初始化失败 [{self.metadata.name}]: {e}", "tool_manager")
            return False

    def execute(self, *args, **kwargs) -> Any:
        """执行工具"""
        if self.status not in (ToolStatus.READY, ToolStatus.RUNNING):
            raise RuntimeError(f"工具 {self.metadata.name} 未就绪 (状态: {self.status.value})")
        if not self.handler:
            raise RuntimeError(f"工具 {self.metadata.name} 没有处理函数")

        self.status = ToolStatus.RUNNING
        self.call_count += 1
        self.last_called = time.time()
        start = time.time()
        try:
            result = self.handler(self.instance, *args, **kwargs) if self.instance else self.handler(*args, **kwargs)
            self.success_count += 1
            self.status = ToolStatus.READY
            return result
        except Exception as e:
            self.failure_count += 1
            self.last_error = str(e)
            self.error_count += 1
            if self.error_count >= self.max_errors:
                self.status = ToolStatus.ERROR
            else:
                self.status = ToolStatus.READY
            raise
        finally:
            self.total_duration_ms += (time.time() - start) * 1000

    def cleanup(self) -> bool:
        """清理工具"""
        try:
            if self.cleanup_handler and self.instance:
                self.cleanup_handler(self.instance)
            self.instance = None
            self.status = ToolStatus.UNLOADED
            return True
        except Exception as e:
            self.last_error = str(e)
            return False

    def enable(self):
        if self.status == ToolStatus.DISABLED:
            self.status = ToolStatus.READY

    def disable(self):
        if self.status in (ToolStatus.READY, ToolStatus.RUNNING):
            self.status = ToolStatus.DISABLED

    def to_dict(self) -> Dict[str, Any]:
        return {
            "metadata": self.metadata.to_dict(),
            "status": self.status.value,
            "call_count": self.call_count,
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "avg_duration_ms": self.total_duration_ms / self.call_count if self.call_count > 0 else 0,
            "last_called": self.last_called,
            "last_error": self.last_error,
            "loaded_at": self.loaded_at,
            "error_count": self.error_count,
        }

class MissingToolParams(Exception):
    """外部工具缺少必填参数（用于把"缺参"从一句控制台告警升级成可回给模型的错误）。

    以前缺参只是 print 一条 `[WARN] 缺少必填参数: url`，然后**照样**拼出一条没有
    `-u` 的命令去跑，必然失败，模型也拿不到"该填哪个参数"的信息。
    """

    def __init__(self, tool_name, slots, expected=None):
        self.tool_name = tool_name
        self.slots = list(slots or [])
        # expected 既可能是 {名: 说明}，也可能只是声明过的 slot 名集合
        try:
            self.expected = dict(expected or {})
        except (TypeError, ValueError):
            self.expected = {str(x): "" for x in (expected or [])}
        super().__init__(f"{tool_name} 缺少必填参数: {', '.join(self.slots)}")
