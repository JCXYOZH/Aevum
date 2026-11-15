"""职责模块：library。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, Union
from libertas.foundation.terminal import terminal
import threading
import uuid

from .security_tools import NetworkSecurityTools
from .chain import ToolChain
from .chain import ToolChainPlanner
from .models import ToolDefinition
from .executor import ToolExecutor
from .external import ExternalToolLoader
from .permissions import ToolPermissionManager
from .registry import ToolRegistry
from .models import ToolResult
from .parser import ToolResultParser

class ToolLibrary:
    """工具库主类 - 整合注册中心、执行器、编排器、解析器、权限管理、安全工具封装"""

    def __init__(self, auto_register_security_tools: bool = True,
                 default_max_risk: str = "low_risk",
                 load_external_tools: bool = True):
        self.library_id = f"lib_{uuid.uuid4().hex[:8]}"
        self.registry = ToolRegistry()
        self.executor = ToolExecutor(self.registry)
        self.planner = ToolChainPlanner(self.registry)
        self.parser = ToolResultParser()
        self.permissions = ToolPermissionManager(default_max_risk)
        self.chains: Dict[str, ToolChain] = {}
        self._lock = threading.RLock()

        if auto_register_security_tools:
            self.security_tools = NetworkSecurityTools(self.registry)
        if load_external_tools:
            self.external_tools = ExternalToolLoader(self.registry)
            self.external_tools.load()

        terminal.info(f"工具库已初始化 ({len(self.registry.tools)} 个工具)", "tool_library")

    def register(self, tool: ToolDefinition) -> str:
        """注册工具"""
        return self.registry.register(tool)

    def unregister(self, tool_name: str) -> bool:
        return self.registry.unregister(tool_name)

    def get_tool(self, tool_name: str) -> Optional[ToolDefinition]:
        return self.registry.get(tool_name)

    def list_tools(self, category: str = "", risk_level: str = "",
                    tag: str = "") -> List[ToolDefinition]:
        return self.registry.list_tools(category, risk_level, tag)

    def search_tools(self, query: str, limit: int = 10) -> List[ToolDefinition]:
        return self.registry.search(query, limit)

    def get_function_calling_list(self) -> List[Dict[str, Any]]:
        """获取AI可直接使用的Function Calling格式工具列表"""
        return self.registry.get_function_calling_list()

    def execute(self, tool_name: str, parameters: Optional[Dict] = None,
                user: str = "default",
                auto_parse: bool = True,
                caller_type: str = "ai") -> ToolResult:
        """执行工具（带权限检查）

        caller_type=human 时跳过风险等级上限与高风险确认；黑白名单仍生效。
        """
        tool = self.registry.get(tool_name)
        if not tool:
            result = ToolResult(tool_name=tool_name, status="failed")
            result.error = f"工具不存在: {tool_name}"
            return result

        # 权限检查
        can_exec, reason = self.permissions.can_execute(
            tool_name, tool.risk_level, user, caller_type=caller_type
        )
        if not can_exec:
            result = ToolResult(tool_name=tool_name, status="failed")
            result.error = reason
            result.error_type = "PermissionDenied"
            return result

        # 高风险工具需要确认
        if self.permissions.requires_confirmation(
            tool_name, tool.risk_level, caller_type=caller_type
        ):
            confirm_id = self.permissions.request_confirmation(
                tool_name, parameters or {}, tool.risk_level, user
            )
            result = ToolResult(tool_name=tool_name, status="pending")
            result.error = f"高风险工具需要确认，确认ID: {confirm_id}"
            result.metadata["confirmation_id"] = confirm_id
            return result

        # 执行
        result = self.executor.execute(tool_name, parameters)

        # 自动解析结果
        if auto_parse and result.status == "success" and result.raw_output:
            parsed_data, success = self.parser.parse(
                result.raw_output, tool.output_parser, tool_name
            )
            if success:
                result.data = parsed_data
                result.parsed = True

        return result

    def execute_async(self, tool_name: str, parameters: Optional[Dict] = None,
                      on_complete: Optional[Callable] = None) -> str:
        return self.executor.execute_async(tool_name, parameters, on_complete)

    def execute_parallel(self, tasks: List[Tuple[str, Dict]]) -> List[ToolResult]:
        return self.executor.execute_parallel(tasks)

    def execute_chain(self, chain: ToolChain,
                      initial_vars: Optional[Dict] = None) -> Dict[str, Any]:
        """执行工具链"""
        return chain.execute(self.executor, initial_vars)

    def plan_and_execute(self, task: str,
                         context: Optional[Dict] = None) -> Dict[str, Any]:
        """自动规划并执行工具链"""
        chain = self.planner.plan(task, context)
        self.chains[chain.chain_id] = chain
        return self.execute_chain(chain, context)

    def create_chain(self, name: str = "", description: str = "") -> ToolChain:
        chain = ToolChain(name, description)
        self.chains[chain.chain_id] = chain
        return chain

    def get_chain(self, chain_id: str) -> Optional[ToolChain]:
        return self.chains.get(chain_id)

    def list_chains(self) -> List[ToolChain]:
        return list(self.chains.values())

    def parse_result(self, raw_output: str, parser_type: str = "text",
                      tool_name: str = "") -> Tuple[Any, bool]:
        return self.parser.parse(raw_output, parser_type, tool_name)

    def approve_execution(self, confirm_id: str, approver: str = "") -> bool:
        return self.permissions.approve(confirm_id, approver)

    def deny_execution(self, confirm_id: str, reason: str = "") -> bool:
        return self.permissions.deny(confirm_id, reason)

    def get_pending_confirmations(self) -> List[Dict]:
        return self.permissions.get_pending_confirmations()

    def add_to_whitelist(self, tool_name: str):
        self.permissions.add_to_whitelist(tool_name)

    def add_to_blacklist(self, tool_name: str):
        self.permissions.add_to_blacklist(tool_name)

    def set_user_permission(self, user: str, max_risk: str):
        self.permissions.set_user_permission(user, max_risk)

    def get_stats(self) -> Dict[str, Any]:
        """获取完整统计"""
        return {
            "library_id": self.library_id,
            "registry": self.registry.get_stats(),
            "executor": self.executor.get_stats(),
            "planner": self.planner.get_stats(),
            "parser": self.parser.get_stats(),
            "permissions": self.permissions.get_stats(),
            "chains": len(self.chains),
            "security_tools": {
                "registered": len(self.security_tools.get_tool_names()) if hasattr(self, 'security_tools') else 0,
                "names": self.security_tools.get_tool_names() if hasattr(self, 'security_tools') else [],
            },
        }

    def get_ai_tool_descriptions(self) -> str:
        """生成AI可读的工具描述文本"""
        tools = self.registry.list_tools()
        lines = ["可用工具列表:"]
        for tool in tools:
            lines.append(f"\n- {tool.name} ({tool.category}, {tool.risk_level})")
            lines.append(f"  描述: {tool.description}")
            if tool.parameters:
                params = ", ".join(
                    f"{p.name}:{p.type}" + ("(必填)" if p.required else "")
                    for p in tool.parameters
                )
                lines.append(f"  参数: {params}")
        return "\n".join(lines)
