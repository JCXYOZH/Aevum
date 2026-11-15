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


class UnifiedToolQueryMixin:
    """工具查询、搜索、匹配、函数调用清单、统计与健康。"""

    def get_tool(self, tool_name: str) -> Optional[Dict]:
        """获取工具详细信息"""
        reg = self._get_registration(tool_name)
        if not reg:
            return None
        return {
            "tool_id": reg.tool_id,
            "name": reg.name,
            "source": reg.source.value,
            "category": reg.definition.category,
            "risk_level": reg.definition.risk_level,
            "description": reg.definition.description,
            "parameters": [
                {"name": p.name, "type": p.type, "description": p.description,
                 "required": p.required, "default": p.default}
                for p in reg.definition.parameters
            ],
            "returns": reg.definition.returns,
            "tags": reg.definition.tags,
            "timeout": reg.definition.timeout,
            "enabled": reg.definition.enabled,
            "health": reg.health.value,
            "call_count": reg.definition.call_count,
            "success_count": reg.definition.success_count,
            "failure_count": reg.definition.failure_count,
            "avg_duration_ms": round(
                reg.definition.total_duration_ms / max(reg.definition.call_count, 1), 1
            ),
            "module_path": reg.module_path,
            "class_name": reg.class_name,
            "method_name": reg.method_name,
            "registered_at": reg.registered_at,
            "last_called_at": reg.last_called_at,
        }

    def list_tools(self, category: str = "", source: str = "",
                   risk_level: str = "", tag: str = "",
                   enabled_only: bool = False,
                   include_details: bool = False) -> List[Dict]:
        """列出所有工具，支持按分类/来源/风险/标签过滤"""
        with self._lock:
            tool_ids = set(self._tools.keys())
    
            if category:
                tool_ids &= set(self._category_index.get(category, []))
            if source:
                tool_ids &= set(self._source_index.get(source, []))
            if risk_level:
                tool_ids = {
                    tid for tid in tool_ids
                    if self._tools[tid].definition.risk_level == risk_level
                }
            if tag:
                tool_ids &= set(self._tag_index.get(tag, []))
            if enabled_only:
                tool_ids = {
                    tid for tid in tool_ids
                    if self._tools[tid].definition.enabled
                }
    
            if include_details:
                return [self.get_tool(self._tools[tid].name) for tid in tool_ids]
            else:
                return [
                    {
                        "name": self._tools[tid].name,
                        "source": self._tools[tid].source.value,
                        "category": self._tools[tid].definition.category,
                        "risk_level": self._tools[tid].definition.risk_level,
                        "description": self._tools[tid].definition.description[:100],
                        "enabled": self._tools[tid].definition.enabled,
                        "health": self._tools[tid].health.value,
                    }
                    for tid in tool_ids
                ]

    def search_tools(self, query: str, limit: int = 20) -> List[Dict]:
        """搜索工具（按名称/描述/标签关键词匹配）"""
        query_lower = query.lower()
        scored = []
        for reg in self._tools.values():
            score = 0
            if query_lower in reg.name.lower():
                score += 10
            if query_lower in reg.definition.description.lower():
                score += 5
            for tag in reg.definition.tags:
                if query_lower in tag.lower():
                    score += 3
            if query_lower in reg.definition.category.lower():
                score += 2
            if score > 0:
                scored.append((score, reg.name))
    
        scored.sort(key=lambda x: -x[0])
        return [self.get_tool(name) for _, name in scored[:limit] if self.get_tool(name)]

    def match_tool(self, user_intent: str, context: Optional[Dict] = None) -> List[Dict]:
        """
        语义匹配工具 - 根据用户意图推荐最合适的工具。
        使用 tool_matcher 进行语义匹配。
        """
        # 构建工具描述列表
        tool_descriptors = []
        for reg in self._tools.values():
            if not reg.definition.enabled:
                continue
            tool_descriptors.append({
                "name": reg.name,
                "description": reg.definition.description,
                "category": reg.definition.category,
                "tags": reg.definition.tags,
                "parameters": [p.name for p in reg.definition.parameters],
            })
    
        # 使用 matcher 匹配
        try:
            matches = self.matcher.match(user_intent, tool_descriptors, top_k=5)
        except Exception:
            # fallback: 关键词搜索
            return self.search_tools(user_intent, limit=5)
    
        results = []
        for match in matches:
            tool_info = self.get_tool(match.get("name", ""))
            if tool_info:
                tool_info["match_score"] = match.get("score", 0)
                tool_info["match_reason"] = match.get("reason", "")
                results.append(tool_info)
        return results

    def get_function_calling_tools(self, category: str = "",
                                    risk_level: str = "",
                                    max_risk: str = "medium_risk") -> List[Dict]:
        """
        获取所有工具的 Function Calling 标准格式。
        用于 AI 模型的工具调用。
        """
        risk_order = ["read_only", "low_risk", "medium_risk", "high_risk", "destructive"]
        max_risk_idx = risk_order.index(max_risk) if max_risk in risk_order else 2
    
        tools = []
        for reg in self._tools.values():
            if not reg.definition.enabled:
                continue
            if category and reg.definition.category != category:
                continue
            if risk_level and reg.definition.risk_level != risk_level:
                continue
            # 风险等级过滤
            try:
                risk_idx = risk_order.index(reg.definition.risk_level)
                if risk_idx > max_risk_idx:
                    continue
            except ValueError:
                pass
    
            tools.append(reg.definition.to_function_calling_format())
        return tools

    def get_stats(self) -> Dict:
        """获取工具系统统计"""
        with self._lock:
            source_counts = defaultdict(int)
            category_counts = defaultdict(int)
            risk_counts = defaultdict(int)
            health_counts = defaultdict(int)
            enabled_count = 0
            total_calls = 0
            total_success = 0
    
            for reg in self._tools.values():
                source_counts[reg.source.value] += 1
                category_counts[reg.definition.category] += 1
                risk_counts[reg.definition.risk_level] += 1
                health_counts[reg.health.value] += 1
                if reg.definition.enabled:
                    enabled_count += 1
                total_calls += reg.definition.call_count
                total_success += reg.definition.success_count
    
            return {
                "total_tools": len(self._tools),
                "enabled_tools": enabled_count,
                "disabled_tools": len(self._tools) - enabled_count,
                "by_source": dict(source_counts),
                "by_category": dict(category_counts),
                "by_risk": dict(risk_counts),
                "by_health": dict(health_counts),
                "total_calls": self._total_calls,
                "total_success": self._total_success,
                "total_failed": self._total_failed,
                "overall_success_rate": round(
                    self._total_success / max(self._total_calls, 1), 3
                ),
                "avg_duration_ms": round(
                    self._total_duration_ms / max(self._total_calls, 1), 1
                ),
                "governance_enabled": self.governance is not None,
            }

    def get_health_report(self) -> Dict:
        """获取工具健康报告"""
        broken = []
        degraded = []
        for reg in self._tools.values():
            if reg.health == ToolHealth.BROKEN:
                broken.append({
                    "name": reg.name,
                    "source": reg.source.value,
                    "error_count": reg.error_count,
                    "consecutive_errors": reg.consecutive_errors,
                })
            elif reg.health == ToolHealth.DEGRADED:
                degraded.append({
                    "name": reg.name,
                    "source": reg.source.value,
                    "error_count": reg.error_count,
                    "consecutive_errors": reg.consecutive_errors,
                })
        return {
            "total": len(self._tools),
            "healthy": len(self._tools) - len(broken) - len(degraded),
            "degraded": degraded,
            "broken": broken,
        }

    def get_tool_categories(self) -> List[str]:
        """获取所有工具分类"""
        return sorted(self._category_index.keys())

    def get_tool_sources(self) -> List[str]:
        """获取所有工具来源"""
        return sorted(self._source_index.keys())
