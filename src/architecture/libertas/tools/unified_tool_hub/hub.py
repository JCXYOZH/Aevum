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

from .adapters import PluginRegistryAdapter, ToolsDirAdapter
from .execution import UnifiedToolExecutionMixin
from .models import ToolSource, ToolHealth, ToolRegistration, UnifiedToolResult
from .query import UnifiedToolQueryMixin
from .registry import UnifiedToolRegistryMixin


class UnifiedToolHub(UnifiedToolRegistryMixin, UnifiedToolExecutionMixin, UnifiedToolQueryMixin):
    """统一工具调度中心。"""

    def __init__(self, auto_scan: bool = True, tools_dir: str = "",
                 plugins_dir: str = "", enable_governance: bool = True):
        self._tools: Dict[str, ToolRegistration] = {}
        self._name_index: Dict[str, str] = {}  # name -> tool_id
        self._category_index: Dict[str, List[str]] = defaultdict(list)
        self._source_index: Dict[str, List[str]] = defaultdict(list)
        self._tag_index: Dict[str, List[str]] = defaultdict(list)
        self._lock = threading.RLock()
    
        # 子系统
        self.governance = ToolGovernanceManager() if enable_governance else None
        self.matcher = ToolMatcher()
        self.binary_executor = BinaryExecutor()
        self.plugin_adapter = PluginRegistryAdapter(self)
        self.tools_adapter = ToolsDirAdapter(self, tools_dir)
    
        # 插件目录
        self.plugins_dir = plugins_dir or os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "plugins"
        )
    
        # 统计
        self._total_calls = 0
        self._total_success = 0
        self._total_failed = 0
        self._total_duration_ms = 0.0
    
        if auto_scan:
            self.scan_all()
