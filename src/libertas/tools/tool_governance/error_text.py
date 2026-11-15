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

from .models import RiskLevel, ToolCallRecord, PendingApproval


def _derive_error_text(result: Any, tool_name: str = "") -> str:
    """派生一条可读的失败原因（保证非空，不产出「未知错误」）。

    工具返回字典不一定带 error（例如外部命令非零退出时只带 returncode/stderr），
    这里统一按 error → message → stderr/stdout 首个有效行 → 退出码 的顺序兜底。
    """
    label = tool_name or "工具"
    if isinstance(result, dict):
        for key in ("error", "stderr", "raw_output", "stdout"):
            value = result.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        rc = result.get("returncode")
        if rc is not None:
            return f"{label} 执行失败（退出码 {rc}）"
        return f"{label} 执行失败，但未返回可读的错误信息"
    return f"{label} 执行失败：未返回结构化结果（实际类型 {type(result).__name__}）"


def _humanize_exception(exc: BaseException, tool_name: str = "") -> str:
    """把执行期异常归类成可读文案；无法归类时给出带工具名的原始描述。"""
    label = tool_name or "工具"
    raw = str(exc).strip() or type(exc).__name__
    lowered = raw.lower()
    rules = (
        (("timed out", "timeout"), "执行超时"),
        (("permission denied", "access is denied", "operation not permitted"), "权限不足"),
        (("no such file", "not found", "does not exist"), "目标或文件不存在"),
        (("connection refused",), "连接被拒绝"),
        (("name or service not known", "getaddrinfo", "temporary failure in name resolution"), "域名解析失败"),
        (("connection reset", "broken pipe"), "连接中断"),
        (("address already in use",), "端口已被占用"),
        (("winerror 5", "winerror 32"), "文件被占用或权限不足"),
    )
    for needles, friendly in rules:
        if any(needle in lowered for needle in needles):
            return f"{label} 执行失败：{friendly}（{raw}）"
    return f"{label} 执行异常：{raw}"
