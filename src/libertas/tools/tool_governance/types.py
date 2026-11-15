"""工具治理模块（ToolGovernance）

四大能力：
1. 操作许可边界 —— 明确模型可以调用哪些工具、不可以调用哪些工具、什么条件下可以执行
2. 执行确认机制 —— 模型在执行操作前获得用户明确授权，而不是自动执行
3. 操作记录与追溯 —— 每一次操作都被记录和存储，随时查看和审计
4. 错误处理与回退 —— 工具失败时识别错误并选择处理策略，不停留在失败状态

工具风险分级：
- safe:    只读、无副作用（DNS查询、WHOIS、HTTP头检查、SSL信息、编码解码）
- low:     轻度主动探测（Ping、端口扫描、HTTP指纹、子域名枚举）
- medium:  目录爆破、漏洞扫描、爬虫（可能触发目标告警）
- high:    暴力破解、攻击利用、哈希破解（需要明确授权）
- dangerous: 可能造成破坏的操作（默认禁止）
"""

from __future__ import annotations

import os
import json
import time
import uuid
import logging
import threading
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, field, asdict
from enum import Enum

logger = logging.getLogger(__name__)

from .models import RiskLevel


def detect_tool_type(tool_name: str, scanner=None) -> str:
    """检测工具类型。

    优先级：plugin_前缀 > native > plugin(唯一名称) > external > native(默认)。
    原生工具不被插件覆盖；重名插件用 plugin_前缀 显式调用。
    """
    # 0. ext_/wsl_ 前缀 = "明确要外部/平台二进制"的入口
    #    （_collect_available_tools 对同名工具用前缀区分；不带前缀时会被判成 native 而找不到实现）
    if tool_name.startswith(("ext_", "wsl_")) and tool_name.split("_", 1)[1]:
        return "external"
    # 1. 显式 plugin_ 前缀 → 插件
    if tool_name.startswith("plugin_"):
        return "plugin"
    # 2. 原生工具优先（不被插件覆盖）
    if tool_name in NATIVE_TOOL_REGISTRY and not tool_name.startswith("web_"):
        return "native"
    # 3. 唯一名称的插件（不与原生重名）
    try:
        from libertas.tools.plugin_system import get_plugin_manager
        pm = get_plugin_manager()
        if tool_name in pm.registry.tools:
            return "plugin"
    except Exception:
        pass
    # 4. 外部工具（EXTERNAL_TOOL_RISK 或 tool_manager 中注册）
    if tool_name in EXTERNAL_TOOL_RISK:
        return "external"
    if scanner is not None:
        tm = getattr(scanner, 'tool_manager', None)
        if tm is not None and tm.get_tool(tool_name) is not None:
            return "external"
    # 5. 默认原生（_do_execute 会动态注册并尝试执行）
    return "native"
