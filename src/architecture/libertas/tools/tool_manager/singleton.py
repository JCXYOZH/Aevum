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

from .manager import ToolManager
from .models import MissingToolParams, ToolInstance, ToolMetadata, ToolStatus

_tool_manager = None


def get_tool_manager() -> ToolManager:
    return _tool_manager


def register_tool(metadata: ToolMetadata, **kwargs) -> str:
    return _tool_manager.register(metadata, **kwargs)
