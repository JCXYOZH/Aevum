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


class RiskLevel(str, Enum):
    SAFE = "safe"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    DANGEROUS = "dangerous"

@dataclass
class ToolCallRecord:
    """工具调用记录"""
    id: str
    timestamp: float
    tool_name: str
    tool_type: str  # native / external / web
    risk_level: str
    params: Dict
    target: str
    success: bool
    duration: float
    error: str = ""
    result_summary: str = ""
    user_approved: bool = False
    session_id: str = ""

@dataclass
class PendingApproval:
    """待审批的工具调用"""
    id: str
    tool_name: str
    tool_type: str
    risk_level: str
    params: Dict
    target: str
    created_at: float
    description: str
    resolved: bool = False
    approved: bool = False
    resolved_at: float = 0.0
