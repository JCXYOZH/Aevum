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


class ToolSource(Enum):
    """工具来源"""
    BUILTIN = "builtin"           # core/tool_library.py 内置
    TOOLS_DIR = "tools_dir"       # tools/ 目录
    PLUGIN = "plugin"             # plugins/ 目录
    BINARY = "binary"             # 二进制外部工具
    SECURITY = "security"         # security/ 安全工具
    DYNAMIC = "dynamic"           # 动态注册

class ToolHealth(Enum):
    """工具健康状态"""
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    BROKEN = "broken"
    UNKNOWN = "unknown"

@dataclass
class ToolRegistration:
    """工具注册信息"""
    tool_id: str
    name: str
    source: ToolSource
    definition: ToolDefinition
    module_path: str = ""
    class_name: str = ""
    method_name: str = ""
    instance: Any = None
    registered_at: float = field(default_factory=time.time)
    last_called_at: float = 0.0
    health: ToolHealth = ToolHealth.UNKNOWN
    error_count: int = 0
    consecutive_errors: int = 0

@dataclass
class UnifiedToolResult:
    """统一工具执行结果"""
    tool_name: str
    success: bool = False
    data: Any = None
    raw_output: str = ""
    error: str = ""
    error_type: str = ""
    error_kind: str = ""
    error_detail: str = ""
    status: str = "pending"
    duration_ms: float = 0.0
    source: str = ""
    tool_id: str = ""
    parameters: Dict = field(default_factory=dict)
    started_at: float = 0.0
    completed_at: float = 0.0

    def to_dict(self) -> Dict:
        return {
            "success": self.success,
            "tool_name": self.tool_name,
            "data": self.data,
            "raw_output": self.raw_output[:5000] if self.raw_output else "",
            "error": self.error,
            "error_type": self.error_type,
            "error_kind": self.error_kind,
            "error_detail": self.error_detail,
            "status": self.status,
            "duration_ms": round(self.duration_ms, 2),
            "source": self.source,
            "tool_id": self.tool_id,
            "parameters": self.parameters,
        }
