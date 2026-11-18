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


class PluginRegistryAdapter:
    """
    适配 plugins/ 目录中插件的 register(registry) 接口。
    每个插件文件定义 register(registry) 函数，通过 registry.register_tool() 注册。
    本适配器将这些注册转换为 UnifiedToolHub 的标准 ToolDefinition。
    """

    def __init__(self, hub: "UnifiedToolHub"):
        self.hub = hub
        self._registered_count = 0

    def register_tool(self, name: str, handler: Callable,
                      params: Optional[Dict] = None,
                      category: str = "utility",
                      desc: str = "",
                      risk_level: str = "read_only",
                      tags: Optional[List[str]] = None,
                      timeout: float = 30.0):
        """插件注册接口 - 转换为标准 ToolDefinition"""
        # 从 handler 的函数签名推断参数
        tool_params = []
        if params:
            for pname, pdesc in params.items():
                tool_params.append(ToolParameter(
                    name=pname,
                    param_type="string",
                    description=pdesc,
                    required=False,
                ))
        else:
            try:
                sig = inspect.signature(handler)
                for pname, param in sig.parameters.items():
                    if pname in ("self", "cls"):
                        continue
                    ptype = "string"
                    if param.annotation != inspect.Parameter.empty:
                        ann = param.annotation
                        if ann == int:
                            ptype = "integer"
                        elif ann == float:
                            ptype = "number"
                        elif ann == bool:
                            ptype = "boolean"
                        elif ann in (list, List):
                            ptype = "array"
                        elif ann in (dict, Dict):
                            ptype = "object"
                    default = None
                    required = True
                    if param.default != inspect.Parameter.empty:
                        default = param.default
                        required = False
                    tool_params.append(ToolParameter(
                        name=pname,
                        param_type=ptype,
                        description=f"参数 {pname}",
                        required=required,
                        default=default,
                    ))
            except (ValueError, TypeError):
                pass

        # 从 handler docstring 获取描述
        if not desc and handler.__doc__:
            desc = handler.__doc__.strip().split("\n")[0][:200]

        definition = ToolDefinition(
            name=name,
            description=desc or f"插件工具: {name}",
            category=category,
            risk_level=risk_level,
            parameters=tool_params,
            returns="工具执行结果（字典格式）",
            tags=tags or ["plugin"],
            timeout=timeout,
            handler=handler,
            output_parser="json",
        )

        self.hub._register_internal(
            definition=definition,
            source=ToolSource.PLUGIN,
            module_path=getattr(handler, "__module__", ""),
            method_name=getattr(handler, "__name__", name),
        )
        self._registered_count += 1

    def get_registered_count(self) -> int:
        return self._registered_count


class ToolsDirAdapter:
    """
    适配 tools/ 目录中的工具文件。
    每个文件可能包含：
    - 一个或多个类（每个公开方法成为一个工具）
    - 一个或多个独立函数（每个函数成为一个工具）
    """

    # tools/ 文件的分类映射
    FILE_CATEGORY_MAP = {
        "scanner": "scanner",
        "security_search": "scanner",
        "net_recon": "recon",
        "network_share": "network",
        "wan_share": "network",
        "nat_traversal": "network",
        "web_search": "utility",
        "web_engine": "utility",
        "search_orchestrator": "utility",
        "content_fetcher": "utility",
        "http_pro": "utility",
        "file_ops": "file",
        "media_handler": "utility",
        "rag_engine": "utility",
        "tool_installer": "utility",
        "native_tools": "utility",
        "parsers": "utility",
        "dork_parser": "utility",
        "wordlist_manager": "utility",
        "governance": "utility",
        "chat_security": "utility",
        "chat_storage": "utility",
        "violations": "utility",
        "impacket_wrapper": "network",
        "tools_expansion": "utility",
        "tools_expansion2": "system",
    }

    # 风险等级映射
    FILE_RISK_MAP = {
        "scanner": "low_risk",
        "security_search": "low_risk",
        "net_recon": "low_risk",
        "impacket_wrapper": "medium_risk",
        "nat_traversal": "low_risk",
        "tool_installer": "medium_risk",
        "native_tools": "medium_risk",
    }

    def __init__(self, hub: "UnifiedToolHub", tools_dir: str = ""):
        self.hub = hub
        self.tools_dir = tools_dir or os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "tools"
        )
        self._loaded_modules: Dict[str, Any] = {}
        self._instances: Dict[str, Any] = {}

    def scan_and_register(self) -> int:
        """扫描 tools/ 目录并注册所有工具"""
        if not os.path.isdir(self.tools_dir):
            return 0

        registered = 0
        for filename in sorted(os.listdir(self.tools_dir)):
            if not filename.endswith(".py") or filename.startswith("_") or filename == "__init__.py":
                continue
            try:
                count = self._register_file(filename)
                registered += count
            except Exception as e:
                print(f"  [WARN] 加载 tools/{filename} 失败: {e}")
        return registered

    def _register_file(self, filename: str) -> int:
        """注册单个工具文件"""
        filepath = os.path.join(self.tools_dir, filename)
        module_name = f"libertas.tools.{filename[:-3]}"

        # 动态加载模块
        spec = importlib.util.spec_from_file_location(module_name, filepath)
        if not spec or not spec.loader:
            return 0
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        try:
            spec.loader.exec_module(module)
        except Exception as e:
            print(f"  [WARN] 执行模块 {filename} 失败: {e}")
            return 0

        self._loaded_modules[module_name] = module
        registered = 0

        # 获取分类和风险等级
        base_name = filename[:-3]
        category = self.FILE_CATEGORY_MAP.get(base_name, "utility")
        risk_level = self.FILE_RISK_MAP.get(base_name, "read_only")

        # 1. 注册类的公开方法
        for attr_name in dir(module):
            if attr_name.startswith("_"):
                continue
            attr = getattr(module, attr_name)
            if inspect.isclass(attr) and attr.__module__ == module_name:
                count = self._register_class(
                    cls=attr,
                    module_name=module_name,
                    filename=filename,
                    category=category,
                    risk_level=risk_level,
                )
                registered += count

        # 2. 注册独立函数
        for attr_name in dir(module):
            if attr_name.startswith("_"):
                continue
            attr = getattr(module, attr_name)
            if inspect.isfunction(attr) and attr.__module__ == module_name:
                count = self._register_function(
                    func=attr,
                    module_name=module_name,
                    filename=filename,
                    category=category,
                    risk_level=risk_level,
                )
                registered += count

        return registered

    def _register_class(self, cls, module_name: str, filename: str,
                        category: str, risk_level: str) -> int:
        """注册类的公开方法为工具"""
        registered = 0
        class_name = cls.__name__

        # 尝试实例化类
        instance = None
        try:
            sig = inspect.signature(cls.__init__)
            if len(sig.parameters) <= 1:  # 只有 self
                instance = cls()
            else:
                # 尝试用默认参数实例化
                try:
                    instance = cls()
                except Exception:
                    pass
        except (ValueError, TypeError):
            try:
                instance = cls()
            except Exception:
                pass

        if instance is not None:
            self._instances[f"{module_name}.{class_name}"] = instance

        # 注册公开方法
        for method_name in dir(cls):
            if method_name.startswith("_"):
                continue
            method = getattr(cls, method_name, None)
            if not inspect.isfunction(method) and not inspect.ismethod(method):
                continue

            # 跳过特殊方法
            if method_name in ("__init__", "__del__", "__str__", "__repr__"):
                continue

            # 从方法签名构建参数
            tool_params = self._build_params_from_signature(method)

            # 从 docstring 获取描述
            desc = ""
            if method.__doc__:
                desc = method.__doc__.strip().split("\n")[0][:200]

            tool_name = f"{class_name.lower()}_{method_name}"
            definition = ToolDefinition(
                name=tool_name,
                description=desc or f"{class_name}.{method_name}",
                category=category,
                risk_level=risk_level,
                parameters=tool_params,
                returns=f"{class_name}.{method_name} 的执行结果",
                tags=[class_name, filename[:-3], "tools_dir"],
                timeout=60.0,
                handler=None,  # 通过 instance 调用
                output_parser="json",
            )

            self.hub._register_internal(
                definition=definition,
                source=ToolSource.TOOLS_DIR,
                module_path=module_name,
                class_name=class_name,
                method_name=method_name,
                instance=instance,
            )
            registered += 1

        return registered

    def _register_function(self, func, module_name: str, filename: str,
                           category: str, risk_level: str) -> int:
        """注册独立函数为工具"""
        tool_params = self._build_params_from_signature(func)

        desc = ""
        if func.__doc__:
            desc = func.__doc__.strip().split("\n")[0][:200]

        tool_name = f"{filename[:-3]}_{func.__name__}"
        definition = ToolDefinition(
            name=tool_name,
            description=desc or f"工具函数: {func.__name__}",
            category=category,
            risk_level=risk_level,
            parameters=tool_params,
            returns=f"{func.__name__} 的执行结果",
            tags=[filename[:-3], "tools_dir", "function"],
            timeout=30.0,
            handler=func,
            output_parser="json",
        )

        self.hub._register_internal(
            definition=definition,
            source=ToolSource.TOOLS_DIR,
            module_path=module_name,
            method_name=func.__name__,
        )
        return 1

    def _build_params_from_signature(self, func) -> List[ToolParameter]:
        """从函数签名构建 ToolParameter 列表"""
        params = []
        try:
            sig = inspect.signature(func)
            for pname, param in sig.parameters.items():
                if pname in ("self", "cls"):
                    continue
                ptype = "string"
                if param.annotation != inspect.Parameter.empty:
                    ann = param.annotation
                    if ann == int:
                        ptype = "integer"
                    elif ann == float:
                        ptype = "number"
                    elif ann == bool:
                        ptype = "boolean"
                    elif ann in (list, List):
                        ptype = "array"
                    elif ann in (dict, Dict):
                        ptype = "object"
                default = None
                required = True
                if param.default != inspect.Parameter.empty:
                    default = param.default
                    required = False
                params.append(ToolParameter(
                    name=pname,
                    param_type=ptype,
                    description=f"参数 {pname}",
                    required=required,
                    default=default,
                ))
        except (ValueError, TypeError):
            pass
        return params

    def get_instance(self, module_name: str, class_name: str) -> Optional[Any]:
        """获取类实例"""
        return self._instances.get(f"{module_name}.{class_name}")
