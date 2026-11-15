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

from .models import MissingToolParams, ToolInstance, ToolMetadata, ToolStatus


class ToolLifecycleMixin:
    """工具列表、分组、启停、清理、健康与统计。"""

    def get_tool(self, name: str):
        """获取工具配置（兼容0.1.5版本：优先返回self.tools中的字典）"""
        # 优先返回旧版security_tools配置（字典格式，run_tool_stream需要）
        if name in self.tools:
            return self.tools[name]
        # 其次返回新工具实例
        return self._tools.get(name)

    def list_tools(self, status: str = "", category: str = "",
                    group: str = "", risk_level: str = "") -> List[ToolInstance]:
        tools = list(self._tools.values())
        if status:
            tools = [t for t in tools if t.status.value == status]
        if category:
            tools = [t for t in tools if t.metadata.category == category]
        if risk_level:
            tools = [t for t in tools if t.metadata.risk_level == risk_level]
        if group and group in self._groups:
            group_names = set(self._groups[group])
            tools = [t for t in tools if t.metadata.name in group_names]
        return tools

    def list_categories(self) -> List[str]:
        return sorted(set(t.metadata.category for t in self._tools.values()))

    def list_groups(self) -> List[str]:
        return list(self._groups.keys())

    def add_to_group(self, tool_name: str, group: str) -> bool:
        if tool_name not in self._tools:
            return False
        self._groups.setdefault(group, []).append(tool_name)
        self._save()
        return True

    def remove_from_group(self, tool_name: str, group: str) -> bool:
        if group in self._groups and tool_name in self._groups[group]:
            self._groups[group].remove(tool_name)
            self._save()
            return True
        return False

    def enable_tool(self, name: str) -> bool:
        tool = self._tools.get(name)
        if tool:
            tool.enable()
            return True
        return False

    def disable_tool(self, name: str) -> bool:
        tool = self._tools.get(name)
        if tool:
            tool.disable()
            return True
        return False

    def cleanup_tool(self, name: str) -> bool:
        tool = self._tools.get(name)
        if tool:
            return tool.cleanup()
        return False

    def cleanup_all(self):
        for tool in self._tools.values():
            tool.cleanup()

    def get_tool_health(self, name: str) -> Dict[str, Any]:
        tool = self._tools.get(name)
        if not tool:
            return {"error": "工具不存在"}
        return {
            "name": name,
            "status": tool.status.value,
            "healthy": tool.status in (ToolStatus.READY, ToolStatus.RUNNING),
            "call_count": tool.call_count,
            "success_rate": tool.success_count / tool.call_count if tool.call_count > 0 else 0,
            "avg_duration_ms": tool.total_duration_ms / tool.call_count if tool.call_count > 0 else 0,
            "error_count": tool.error_count,
            "last_error": tool.last_error,
        }

    def get_all_health(self) -> List[Dict[str, Any]]:
        return [self.get_tool_health(name) for name in self._tools]

    def get_stats(self) -> Dict[str, Any]:
        total = len(self._tools)
        by_status = {}
        by_category = {}
        by_risk = {}
        total_calls = 0
        for tool in self._tools.values():
            by_status[tool.status.value] = by_status.get(tool.status.value, 0) + 1
            by_category[tool.metadata.category] = by_category.get(tool.metadata.category, 0) + 1
            by_risk[tool.metadata.risk_level] = by_risk.get(tool.metadata.risk_level, 0) + 1
            total_calls += tool.call_count
        return {
            "total": total,
            "by_status": by_status,
            "by_category": by_category,
            "by_risk": by_risk,
            "total_calls": total_calls,
            "groups": len(self._groups),
            "discovery_paths": len(self._discovery_paths),
        }
