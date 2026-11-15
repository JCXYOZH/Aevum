"""职责模块：models。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, Union
from enum import Enum
import json
import re
import threading
import time
import uuid

class ToolRiskLevel(Enum):
    READ_ONLY = "read_only"        # 只读，无任何副作用
    LOW_RISK = "low_risk"          # 低风险，如端口扫描、信息收集
    MEDIUM_RISK = "medium_risk"    # 中等风险，如弱口令检测、漏洞扫描
    HIGH_RISK = "high_risk"        # 高风险，如漏洞利用、密码破解
    DESTRUCTIVE = "destructive"

class ToolCategory(Enum):
    NETWORK = "network"             # 网络工具
    SCANNER = "scanner"             # 扫描器
    EXPLOIT = "exploit"             # 漏洞利用
    CRYPTO = "crypto"               # 密码学
    FORENSICS = "forensics"         # 取证
    RECON = "recon"                 # 侦察
    UTILITY = "utility"             # 实用工具
    FILE = "file"                   # 文件操作
    SYSTEM = "system"               # 系统工具
    CODE = "code"                   # 代码工具
    DATA = "data"

class ToolStatus(Enum):
    SUCCESS = "success"
    FAILED = "failed"
    TIMEOUT = "timeout"
    SKIPPED = "skipped"
    PENDING = "pending"
    RUNNING = "running"

class ToolParameter:
    """工具参数定义"""

    def __init__(self, name: str, param_type: str = "string",
                 description: str = "", required: bool = False,
                 default: Any = None, enum: Optional[List[Any]] = None,
                 minimum: Optional[float] = None,
                 maximum: Optional[float] = None,
                 min_length: Optional[int] = None,
                 max_length: Optional[int] = None,
                 pattern: str = "",
                 items: Optional[Dict] = None,
                 properties: Optional[Dict] = None):
        self.name = name
        self.type = param_type
        self.description = description
        self.required = required
        self.default = default
        self.enum = enum
        self.minimum = minimum
        self.maximum = maximum
        self.min_length = min_length
        self.max_length = max_length
        self.pattern = pattern
        self.items = items
        self.properties = properties

    def to_json_schema(self) -> Dict[str, Any]:
        """转换为JSON Schema格式"""
        schema: Dict[str, Any] = {
            "type": self.type,
            "description": self.description,
        }
        if self.enum is not None:
            schema["enum"] = self.enum
        if self.minimum is not None:
            schema["minimum"] = self.minimum
        if self.maximum is not None:
            schema["maximum"] = self.maximum
        if self.min_length is not None:
            schema["minLength"] = self.min_length
        if self.max_length is not None:
            schema["maxLength"] = self.max_length
        if self.pattern:
            schema["pattern"] = self.pattern
        if self.default is not None:
            schema["default"] = self.default
        if self.items:
            schema["items"] = self.items
        if self.properties:
            schema["properties"] = self.properties
        return schema

    def validate(self, value: Any) -> Tuple[bool, str]:
        """验证参数值"""
        if value is None:
            if self.required:
                return False, f"参数 {self.name} 为必填项"
            return True, ""
        # 类型检查
        type_map = {
            "string": str, "integer": int, "number": (int, float),
            "boolean": bool, "array": list, "object": dict, "null": type(None),
        }
        expected = type_map.get(self.type)
        if expected and not isinstance(value, expected):
            return False, f"参数 {self.name} 类型应为 {self.type}，实际为 {type(value).__name__}"
        # 枚举检查
        if self.enum is not None and value not in self.enum:
            return False, f"参数 {self.name} 值应为 {self.enum} 之一，实际为 {value}"
        # 范围检查
        if isinstance(value, (int, float)):
            if self.minimum is not None and value < self.minimum:
                return False, f"参数 {self.name} 最小值为 {self.minimum}"
            if self.maximum is not None and value > self.maximum:
                return False, f"参数 {self.name} 最大值为 {self.maximum}"
        # 长度检查
        if isinstance(value, str):
            if self.min_length is not None and len(value) < self.min_length:
                return False, f"参数 {self.name} 最小长度为 {self.min_length}"
            if self.max_length is not None and len(value) > self.max_length:
                return False, f"参数 {self.name} 最大长度为 {self.max_length}"
            if self.pattern and not re.match(self.pattern, value):
                return False, f"参数 {self.name} 格式不匹配"
        return True, ""

class ToolDefinition:
    """工具定义 - AI可直接理解的标准格式"""

    def __init__(self, name: str, description: str = "",
                 category: str = "utility",
                 risk_level: str = "read_only",
                 parameters: Optional[List[ToolParameter]] = None,
                 returns: str = "",
                 examples: Optional[List[Dict]] = None,
                 tags: Optional[List[str]] = None,
                 timeout: float = 30.0,
                 max_retries: int = 0,
                 requires_confirmation: bool = False,
                 enabled: bool = True,
                 handler: Optional[Callable] = None,
                 command: str = "",
                 output_parser: str = "text"):
        self.tool_id = f"tool_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.description = description
        self.category = category
        self.risk_level = risk_level
        self.parameters = parameters or []
        self.returns = returns
        self.examples = examples or []
        self.tags = tags or []
        self.timeout = timeout
        self.max_retries = max_retries
        self.requires_confirmation = requires_confirmation
        self.enabled = enabled
        self.handler = handler
        self.command = command
        self.output_parser = output_parser  # text / json / xml / nmap_xml / custom
        self.created_at = time.time()
        self.call_count = 0
        self.success_count = 0
        self.failure_count = 0
        self.total_duration_ms = 0.0
        self._lock = threading.RLock()

    def to_function_calling_format(self) -> Dict[str, Any]:
        """转换为OpenAI Function Calling标准格式"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": {p.name: p.to_json_schema() for p in self.parameters},
                    "required": [p.name for p in self.parameters if p.required],
                },
            },
        }

    def validate_parameters(self, params: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """验证参数"""
        errors = []
        for param in self.parameters:
            value = params.get(param.name, param.default)
            valid, error = param.validate(value)
            if not valid:
                errors.append(error)
        # 检查未知参数
        known_names = {p.name for p in self.parameters}
        unknown = set(params.keys()) - known_names
        if unknown:
            errors.append(f"未知参数: {', '.join(unknown)}")
        return len(errors) == 0, errors

    def get_usage_example(self) -> str:
        """获取使用示例"""
        if not self.examples:
            return f"{self.name}()"
        example = self.examples[0]
        params = example.get("input", {})
        param_str = ", ".join(f"{k}={v}" for k, v in params.items())
        return f"{self.name}({param_str})"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "tool_id": self.tool_id,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "risk_level": self.risk_level,
            "parameters": [p.name for p in self.parameters],
            "required_params": [p.name for p in self.parameters if p.required],
            "returns": self.returns,
            "tags": self.tags,
            "timeout": self.timeout,
            "max_retries": self.max_retries,
            "requires_confirmation": self.requires_confirmation,
            "enabled": self.enabled,
            "call_count": self.call_count,
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "avg_duration_ms": round(self.total_duration_ms / max(self.call_count, 1), 1),
        }

class ToolResult:
    """工具执行结果 - 统一结构化格式"""

    def __init__(self, tool_name: str = "", status: str = "pending"):
        self.result_id = f"result_{uuid.uuid4().hex[:8]}"
        self.tool_name = tool_name
        self.status = status
        self.data: Any = None          # 结构化数据
        self.raw_output: str = ""      # 原始输出
        self.error: str = ""
        self.error_type: str = ""
        self.started_at = 0.0
        self.completed_at = 0.0
        self.duration_ms = 0.0
        self.parameters: Dict[str, Any] = {}
        self.return_code: int = 0
        self.metadata: Dict[str, Any] = {}
        self.parsed: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "result_id": self.result_id,
            "tool_name": self.tool_name,
            "status": self.status,
            "data": self.data if isinstance(self.data, (dict, list, str, int, float, bool, type(None))) else str(self.data),
            "raw_output": self.raw_output[:2000] if self.raw_output else "",
            "error": self.error,
            "error_type": self.error_type,
            "duration_ms": round(self.duration_ms, 1),
            "parameters": self.parameters,
            "return_code": self.return_code,
            "metadata": self.metadata,
            "parsed": self.parsed,
        }

    def to_ai_summary(self) -> str:
        """生成AI可读的摘要"""
        if self.status == "success":
            summary = f"工具 {self.tool_name} 执行成功（耗时 {self.duration_ms:.0f}ms）"
            if self.data:
                if isinstance(self.data, dict):
                    summary += f"\n结果: {json.dumps(self.data, ensure_ascii=False, indent=2)[:1000]}"
                elif isinstance(self.data, list):
                    summary += f"\n结果: 共{len(self.data)}项"
                    if self.data:
                        summary += f"\n首项: {json.dumps(self.data[0], ensure_ascii=False)[:500]}"
                else:
                    summary += f"\n结果: {str(self.data)[:500]}"
            return summary
        else:
            return f"工具 {self.tool_name} 执行失败: {self.error}"
