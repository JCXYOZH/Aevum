"""职责模块：registry。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, Union
from collections import deque, Counter, defaultdict
import re
from libertas.foundation.terminal import terminal
import threading
import uuid

from .models import ToolDefinition

class ToolRegistry:
    """工具注册中心"""

    def __init__(self):
        self.registry_id = f"reg_{uuid.uuid4().hex[:8]}"
        self.tools: Dict[str, ToolDefinition] = {}
        self.category_index: Dict[str, List[str]] = defaultdict(list)
        self.tag_index: Dict[str, List[str]] = defaultdict(list)
        self.risk_index: Dict[str, List[str]] = defaultdict(list)
        self._lock = threading.RLock()

    def register(self, tool: ToolDefinition) -> str:
        """注册工具"""
        with self._lock:
            self.tools[tool.name] = tool
            self.category_index[tool.category].append(tool.name)
            for tag in tool.tags:
                self.tag_index[tag].append(tool.name)
            self.risk_index[tool.risk_level].append(tool.name)
        terminal.info(f"工具已注册: {tool.name} ({tool.category}, {tool.risk_level})", "tool_registry")
        return tool.name

    def unregister(self, tool_name: str) -> bool:
        with self._lock:
            tool = self.tools.pop(tool_name, None)
            if tool:
                self.category_index[tool.category] = [
                    n for n in self.category_index[tool.category] if n != tool_name
                ]
                for tag in tool.tags:
                    self.tag_index[tag] = [n for n in self.tag_index[tag] if n != tool_name]
                self.risk_index[tool.risk_level] = [
                    n for n in self.risk_index[tool.risk_level] if n != tool_name
                ]
                return True
        return False

    def get(self, tool_name: str) -> Optional[ToolDefinition]:
        return self.tools.get(tool_name)

    def list_tools(self, category: str = "", risk_level: str = "",
                    tag: str = "", enabled_only: bool = True) -> List[ToolDefinition]:
        tools = list(self.tools.values())
        if category:
            tools = [t for t in tools if t.category == category]
        if risk_level:
            tools = [t for t in tools if t.risk_level == risk_level]
        if tag:
            tools = [t for t in tools if tag in t.tags]
        if enabled_only:
            tools = [t for t in tools if t.enabled]
        return tools

    def search(self, query: str, limit: int = 10) -> List[ToolDefinition]:
        """语义搜索工具"""
        query_lower = query.lower()
        scored = []
        for tool in self.tools.values():
            if not tool.enabled:
                continue
            score = 0
            if query_lower in tool.name.lower():
                score += 10
            if query_lower in tool.description.lower():
                score += 8
            if any(query_lower in tag.lower() for tag in tool.tags):
                score += 6
            if query_lower in tool.category.lower():
                score += 4
            # 关键词匹配
            query_words = set(re.findall(r'[a-zA-Z0-9]+', query_lower))
            desc_words = set(re.findall(r'[a-zA-Z0-9]+', tool.description.lower()))
            overlap = len(query_words & desc_words)
            score += overlap * 2
            if score > 0:
                scored.append((tool, score))
        scored.sort(key=lambda x: x[1], reverse=True)
        return [t for t, _ in scored[:limit]]

    def get_function_calling_list(self) -> List[Dict[str, Any]]:
        """获取所有工具的Function Calling格式列表（供AI使用）"""
        return [tool.to_function_calling_format() for tool in self.tools.values() if tool.enabled]

    def get_categories(self) -> List[str]:
        return list(self.category_index.keys())

    def get_tags(self) -> List[str]:
        return list(self.tag_index.keys())

    def get_stats(self) -> Dict[str, Any]:
        return {
            "registry_id": self.registry_id,
            "total_tools": len(self.tools),
            "enabled_tools": sum(1 for t in self.tools.values() if t.enabled),
            "by_category": {cat: len(tools) for cat, tools in self.category_index.items()},
            "by_risk": {risk: len(tools) for risk, tools in self.risk_index.items()},
            "total_tags": len(self.tag_index),
            "total_calls": sum(t.call_count for t in self.tools.values()),
            "success_rate": round(
                sum(t.success_count for t in self.tools.values()) /
                max(sum(t.call_count for t in self.tools.values()), 1), 4
            ),
        }
