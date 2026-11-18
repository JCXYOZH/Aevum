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

from .models import ToolSource, ToolHealth, ToolRegistration, UnifiedToolResult


class UnifiedToolRegistryMixin:
    """工具来源扫描、内置/动态注册、启用、重载与移除。"""

    def scan_all(self) -> Dict[str, int]:
        """扫描所有工具来源"""
        results = {}
        with self._lock:
            results["plugins"] = self._scan_plugins()
            results["tools_dir"] = self.tools_adapter.scan_and_register()
            results["binary"] = self._scan_binary_tools()
            results["total"] = sum(results.values())
        return results

    def _scan_plugins(self) -> int:
        """扫描 plugins/ 目录，调用每个插件的 register()"""
        if not os.path.isdir(self.plugins_dir):
            return 0
    
        registered = 0
        for filename in sorted(os.listdir(self.plugins_dir)):
            if not filename.endswith(".py") or filename.startswith("_") or filename == "__init__.py":
                continue
            try:
                filepath = os.path.join(self.plugins_dir, filename)
                module_name = f"libertas.plugins.{filename[:-3]}"
    
                spec = importlib.util.spec_from_file_location(module_name, filepath)
                if not spec or not spec.loader:
                    continue
                module = importlib.util.module_from_spec(spec)
                sys.modules[module_name] = module
                spec.loader.exec_module(module)
    
                # 调用 register() 函数
                if hasattr(module, "register") and callable(module.register):
                    before = self.plugin_adapter.get_registered_count()
                    module.register(self.plugin_adapter)
                    after = self.plugin_adapter.get_registered_count()
                    registered += (after - before)
            except Exception as e:
                print(f"  [WARN] 加载插件 {filename} 失败: {e}")
        return registered

    def _scan_binary_tools(self) -> int:
        """扫描可用的二进制工具"""
        registered = 0
        binary_tools = [
            ("nmap", "网络扫描器", "scanner", "low_risk"),
            ("masscan", "高速端口扫描器", "scanner", "low_risk"),
            ("curl", "HTTP客户端", "utility", "read_only"),
            ("wget", "文件下载", "utility", "read_only"),
            ("ping", "网络连通性测试", "network", "read_only"),
            ("traceroute", "路由追踪", "network", "read_only"),
            ("dig", "DNS查询", "network", "read_only"),
            ("nslookup", "DNS查询", "network", "read_only"),
            ("whois", "域名注册信息", "recon", "read_only"),
            ("ssh", "SSH客户端", "network", "medium_risk"),
            ("python", "Python解释器", "utility", "medium_risk"),
            ("git", "版本控制", "utility", "read_only"),
            ("gobuster", "目录爆破", "scanner", "low_risk"),
            ("ffuf", "模糊测试", "scanner", "low_risk"),
            ("sqlmap", "SQL注入检测", "exploit", "medium_risk"),
            ("nikto", "Web漏洞扫描", "scanner", "low_risk"),
            ("hydra", "密码爆破", "exploit", "high_risk"),
            ("john", "密码破解", "exploit", "high_risk"),
            ("hashcat", "哈希破解", "exploit", "high_risk"),
        ]
    
        for name, desc, category, risk in binary_tools:
            try:
                path = self.binary_executor.path_detector.find(name)
                if path:
                    definition = ToolDefinition(
                        name=f"binary_{name}",
                        description=f"{desc}（二进制工具: {path}）",
                        category=category,
                        risk_level=risk,
                        parameters=[
                            ToolParameter("args", "array", "命令行参数", required=False, default=[]),
                            ToolParameter("timeout", "number", "超时时间（秒）", required=False, default=30.0),
                        ],
                        returns=f"{name} 命令的执行输出",
                        tags=["binary", name],
                        timeout=120.0,
                        command=name,
                        output_parser="text",
                    )
                    self._register_internal(
                        definition=definition,
                        source=ToolSource.BINARY,
                        module_path=path,
                    )
                    registered += 1
            except Exception:
                pass
        return registered

    def _register_internal(self, definition: ToolDefinition,
                           source: ToolSource,
                           module_path: str = "",
                           class_name: str = "",
                           method_name: str = "",
                           instance: Any = None):
        """内部注册工具"""
        registration = ToolRegistration(
            tool_id=definition.tool_id,
            name=definition.name,
            source=source,
            definition=definition,
            module_path=module_path,
            class_name=class_name,
            method_name=method_name,
            instance=instance,
        )
        self._tools[definition.tool_id] = registration
        self._name_index[definition.name] = definition.tool_id
        self._category_index[definition.category].append(definition.tool_id)
        self._source_index[source.value].append(definition.tool_id)
        for tag in definition.tags:
            self._tag_index[tag].append(definition.tool_id)

    def register_dynamic_tool(self, name: str, handler: Callable,
                               description: str = "",
                               category: str = "utility",
                               risk_level: str = "read_only",
                               parameters: Optional[List[ToolParameter]] = None,
                               tags: Optional[List[str]] = None,
                               timeout: float = 30.0) -> str:
        """动态注册工具"""
        definition = ToolDefinition(
            name=name,
            description=description or f"动态工具: {name}",
            category=category,
            risk_level=risk_level,
            parameters=parameters or [],
            returns="动态工具执行结果",
            tags=tags or ["dynamic"],
            timeout=timeout,
            handler=handler,
            output_parser="json",
        )
        with self._lock:
            self._register_internal(definition, ToolSource.DYNAMIC)
        return definition.tool_id

    def _get_registration(self, tool_name: str) -> Optional[ToolRegistration]:
        """根据名称获取注册信息"""
        tool_id = self._name_index.get(tool_name)
        if tool_id:
            return self._tools.get(tool_id)
        # 模糊匹配
        for name, tid in self._name_index.items():
            if tool_name.lower() in name.lower():
                return self._tools.get(tid)
        return None

    def enable_tool(self, tool_name: str) -> bool:
        """启用工具"""
        reg = self._get_registration(tool_name)
        if reg:
            reg.definition.enabled = True
            return True
        return False

    def disable_tool(self, tool_name: str) -> bool:
        """禁用工具"""
        reg = self._get_registration(tool_name)
        if reg:
            reg.definition.enabled = False
            return True
        return False

    def reload_tools(self) -> Dict[str, int]:
        """重新加载所有工具"""
        with self._lock:
            self._tools.clear()
            self._name_index.clear()
            self._category_index.clear()
            self._source_index.clear()
            self._tag_index.clear()
        return self.scan_all()

    def remove_tool(self, tool_name: str) -> bool:
        """移除工具"""
        reg = self._get_registration(tool_name)
        if not reg:
            return False
        with self._lock:
            self._tools.pop(reg.tool_id, None)
            self._name_index.pop(tool_name, None)
            self._category_index[reg.definition.category] = [
                tid for tid in self._category_index[reg.definition.category]
                if tid != reg.tool_id
            ]
            self._source_index[reg.source.value] = [
                tid for tid in self._source_index[reg.source.value]
                if tid != reg.tool_id
            ]
            for tag in reg.definition.tags:
                self._tag_index[tag] = [
                    tid for tid in self._tag_index[tag]
                    if tid != reg.tool_id
                ]
        return True
