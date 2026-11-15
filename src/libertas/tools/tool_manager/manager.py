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

from .command import ToolCommandMixin
from .execution import ToolExecutionMixin
from .lifecycle import ToolLifecycleMixin
from .models import MissingToolParams, ToolInstance, ToolMetadata, ToolStatus
from .paths import ToolPathMixin
from .registry import ToolRegistryMixin


class ToolManager(ToolPathMixin, ToolRegistryMixin, ToolCommandMixin, ToolExecutionMixin, ToolLifecycleMixin):
    """工具管理器。"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "tools")
        os.makedirs(self.data_dir, exist_ok=True)
        self._tools: Dict[str, ToolInstance] = {}
        self._groups: Dict[str, List[str]] = {"default": []}
        self._lock = threading.RLock()
        self._discovery_paths: List[str] = []
        self.tools: Dict[str, Any] = {}  # 兼容旧版：外部工具配置字典（如 security_tools）
        self._load()
        # 兼容旧版：从 config.yaml 加载 security_tools 配置
        self._load_security_tools()
        # 工具命令组装器（必须在_load_security_tools之后初始化，这样才能加载self.tools）
        try:
            from libertas.tools.tool_assembler import ToolAssembler
            self.assembler = ToolAssembler(self.tools)
        except Exception:
            self.assembler = None
