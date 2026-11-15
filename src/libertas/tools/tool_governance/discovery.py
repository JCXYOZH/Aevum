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

from .constants import WSL_SECURITY_TOOLS, WSL_TOOL_RISK


def discover_platform_tools() -> List[Dict]:
    """发现当前平台可用的安全工具
    - Windows: 通过WSL检查Kali中的工具
    - Linux/macOS: 直接检查PATH中的工具

    返回: [{"name", "category", "risk", "desc", "type"}, ...]
    """
    system = _platform.system().lower()

    if system == "windows":
        # Windows: 通过WSL检查
        try:
            from libertas.tools.binary_executor import is_wsl_available, check_wsl_tool
        except ImportError:
            try:
                from libertas.core.binary_executor import is_wsl_available, check_wsl_tool
            except ImportError:
                return []
        if not is_wsl_available():
            return []
        check_func = lambda name: check_wsl_tool(name)
        tool_type = "wsl"
        desc_suffix = "（通过WSL Kali执行）"
    else:
        # Linux/macOS: 直接检查PATH
        check_func = lambda name: _shutil.which(name) is not None
        tool_type = "native"
        desc_suffix = ""

    available = []
    for category, tools in WSL_SECURITY_TOOLS.items():
        for name, desc in tools.items():
            try:
                if check_func(name):
                    risk = WSL_TOOL_RISK.get(name, "medium")
                    available.append({
                        "name": name,
                        "category": category,
                        "risk": risk,
                        "desc": desc + desc_suffix,
                        "type": tool_type,
                    })
            except Exception:
                continue
    return available


def discover_wsl_tools() -> List[Dict]:
    """发现WSL中可用的安全工具（向后兼容）"""
    return discover_platform_tools()
