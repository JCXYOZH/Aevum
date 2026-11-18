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

from .hub import UnifiedToolHub
from .models import ToolSource, ToolHealth, ToolRegistration, UnifiedToolResult

_global_tool_hub = None


def create_unified_tool_hub(auto_scan: bool = True) -> UnifiedToolHub:
    """创建统一工具调度中心实例"""
    return UnifiedToolHub(auto_scan=auto_scan)


def get_global_tool_hub() -> UnifiedToolHub:
    """获取全局统一工具调度中心单例"""
    global _global_hub
    if _global_hub is None:
        _global_hub = UnifiedToolHub(auto_scan=True)
    return _global_hub
