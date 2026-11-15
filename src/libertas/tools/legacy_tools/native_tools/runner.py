# tools/native_tools.py
"""
原生网络安全工具 - 纯Python标准库实现，不依赖外部工具安装
支持跨平台（Windows/macOS/Linux）

每个工具返回统一格式：
{
    "success": bool,
    "tool": str,
    "target": str,
    "data": Any,
    "raw_output": str,
    "scan_time": str,
    "error": str (可选)
}
"""
import os
import re
import ssl
import sys
import json
import time
import socket
import struct
import shutil
import platform
import inspect
import subprocess
import threading
import urllib.request
import urllib.error
from typing import Dict, List, Any, Optional, Callable
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeout
from datetime import datetime
from libertas.utils.text_decode import decode_output

from .constants import *


def _registry():
        return NATIVE_TOOLS


def run_native_tool(tool_name: str, **kwargs) -> Dict[str, Any]:
    tool = _registry().get(tool_name)
    fn = tool.get("fn") if tool else None
    if not fn:
        return _result(tool_name, _display_target(kwargs), False,
                       error=f"未知原生工具: {tool_name}"
                             "（可调用 search_tools 查询可用工具名）")

    normalized, report = normalize_native_args(fn, kwargs)
    target_display = _display_target({**normalized, **kwargs})

    # 必填参数缺失：给可执行的结构化失败，不要抛 TypeError
    if report["missing"]:
        expected_str = "、".join(f"{k}({v})" for k, v in report["expected"].items())
        return _result(
            tool_name, target_display, False,
            data={
                "missing_params": report["missing"],
                "expected_params": report["expected"],
                "ignored_params": report["ignored"],
                "aliased_params": report["aliased"],
            },
            error=(f"缺少必填参数 {'、'.join(report['missing'])}。"
                   f"本工具的参数：{expected_str}。"
                   "请补齐后重试，或调用 search_tools 查询参数说明"),
        )

    reset_cancel()
    try:
        result = fn(**normalized)
    except Exception as e:
        friendly, kind, detail = _error_kind_and_text(str(e), exc=e)
        first_line = (str(e).splitlines() or [""])[0][:160]
        raw_detail = f"{type(e).__name__}: {first_line}"
        unclassified = friendly is None
        if unclassified:
            # 未归类异常：可读人话给用户/模型，类型名与内部信息只进 error_detail
            friendly = (f"{tool_name} 执行失败：发生未预期的内部错误，未能给出可诊断原因。"
                        "可稍后重试或改用其它工具；需要参数说明可调用 search_tools")
            kind = "internal"
        result = _result(
            tool_name, target_display, False,
            data={"error_kind": kind,
                  "error_type": type(e).__name__,
                  "error_detail": (raw_detail if unclassified
                                   else (detail or raw_detail))[:500],
                  "ignored_params": report["ignored"]},
            error=friendly,
        )

    if isinstance(result, dict):
        result = polish_native_result(tool_name, result)
        if report["ignored"] and isinstance(result.get("data"), dict):
            result["data"].setdefault("ignored_params", report["ignored"])
    return result

def list_native_tools() -> List[Dict[str, Any]]:
    result = []
    for name, info in _registry().items():
        result.append({
            "name": name,
            "description": info["description"],
            "category": info["category"],
            "params": info["params"],
            "native": True,
        })
    return result
