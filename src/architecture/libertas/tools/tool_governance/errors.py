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

from .catalog_data import CATEGORY_DEFAULT_RISK, EXTERNAL_TOOL_RISK, NATIVE_TOOL_REGISTRY, PLUGIN_REGISTRY
from .constants import WSL_SECURITY_TOOLS, WSL_TOOL_RISK
from .models import PendingApproval, RiskLevel, ToolCallRecord


class GovernanceErrorMixin:
    """工具错误识别、替代工具与本地错误文案。"""

    def handle_error(self, tool_name: str, tool_type: str,
                     error: str, params: Dict,
                     alternate_tools: List[str] = None) -> Dict:
        """处理工具调用错误，返回回退策略
    
        返回：
        {
            "strategy": "retry" / "alternate" / "skip" / "abort",
            "retry_after": float,
            "alternate_tool": str,
            "message": str
        }
        """
        error_lower = error.lower()
        strategy = self._config["fallback_strategy"]
    
        # 超时错误 → 优先换「功能对等」的工具（与默认策略一致），没有替代工具才重试
        if "timeout" in error_lower or "timed out" in error_lower:
            alt = (self._find_native_alternate(tool_name)
                   or self._find_alternate(tool_name, alternate_tools))
            return {
                "strategy": "alternate" if alt else "retry",
                "retry_after": 1.0 if alt else 2.0,
                "alternate_tool": alt,
                "message": (f"{tool_name} 超时，改用 {alt}" if alt
                            else f"{tool_name} 超时，2秒后重试"),
            }
    
        # 连接错误 → 换工具
        if "connection" in error_lower or "refused" in error_lower or "unreachable" in error_lower:
            alt = (self._find_native_alternate(tool_name)
                   or self._find_alternate(tool_name, alternate_tools))
            return {
                "strategy": "alternate" if alt else "skip",
                "retry_after": 0,
                "alternate_tool": alt,
                "message": f"{tool_name} 连接失败" + (f"，尝试使用 {alt}" if alt else "，跳过"),
            }
    
        # 工具未安装 → 换原生工具
        # 判定必须覆盖中文 Windows / PowerShell 的真实文案，否则「'dig' 不是内部或
        # 外部命令」会落到 unknown，用户只得到「工具失败: dig」而没有原生替代。
        _missing_binary = False
        try:
            from ..tools.native_tools import is_missing_binary_text as _is_missing_binary
            _missing_binary = _is_missing_binary(error)
        except Exception:
            _missing_binary = False
        if (_missing_binary or "not found" in error_lower
                or "no such file" in error_lower or "not installed" in error_lower):
            alt = self._find_native_alternate(tool_name)
            return {
                "strategy": "alternate" if alt else "skip",
                "retry_after": 0,
                "alternate_tool": alt,
                "message": f"{tool_name} 未安装" + (f"，使用原生工具 {alt}" if alt else "，跳过"),
            }
    
        # 权限错误 → 跳过
        if "permission" in error_lower or "forbidden" in error_lower or "403" in error_lower:
            return {
                "strategy": "skip",
                "retry_after": 0,
                "alternate_tool": None,
                "message": f"{tool_name} 权限不足，跳过",
            }
    
        # 默认策略
        if strategy == "retry_then_alternate":
            # 优先选"功能对等"的原生工具（nmap→port_scan、dig→dns_lookup…），
            # 而不是随便挑一个外部工具 —— 否则会出现「要 dig 却把 whois 的结果当成功」。
            alt = (self._find_native_alternate(tool_name)
                   or self._find_alternate(tool_name, alternate_tools))
            return {
                "strategy": "alternate" if alt else "retry",
                "retry_after": 1.0,
                "alternate_tool": alt,
                "message": f"{tool_name} 失败: {error[:100]}",
            }
        elif strategy == "skip":
            return {"strategy": "skip", "retry_after": 0, "alternate_tool": None,
                    "message": f"{tool_name} 失败，跳过: {error[:100]}"}
        else:
            return {"strategy": "abort", "retry_after": 0, "alternate_tool": None,
                    "message": f"{tool_name} 失败，中止: {error[:100]}"}

    def _find_alternate(self, tool_name: str, candidates: List[str] = None) -> Optional[str]:
        """查找替代工具"""
        if candidates:
            for c in candidates:
                perm = self.check_permission(c, "external")
                if perm["allowed"]:
                    return c
        return None

    def _find_native_alternate(self, external_tool: str) -> Optional[str]:
        """为外部工具找到对应的原生替代"""
        mapping = {
            "nmap": "port_scan", "masscan": "port_scan", "rustscan": "port_scan",
            "naabu": "port_scan",
            "subfinder": "subdomain_enum", "amass": "subdomain_enum",
            "sublist3r": "subdomain_enum", "dnsx": "dns_lookup",
            "dig": "dns_lookup", "dnsenum": "dns_lookup",
            "whatweb": "http_fingerprint", "wappalyzer": "http_fingerprint",
            "httpx": "http_fingerprint", "httprobe": "tcp_ping",
            "ping": "ping", "traceroute": "traceroute",
            "ffuf": "dir_bruteforce", "gobuster": "dir_bruteforce",
            "dirsearch": "dir_bruteforce", "feroxbuster": "dir_bruteforce",
            "nikto": "http_headers", "testssl": "ssl_info", "sslyze": "ssl_info",
            "openssl": "ssl_info", "whois": "whois",
            "wafw00f": "http_headers", "enum4linux": "port_scan",
            # 通用 HTTP 客户端失败（没装 / 退出码非零）时，用内置实现兜底：
            # 至少能拿到响应头与指纹，比直接回一句「工具失败: curl」有用。
            "curl": "http_headers", "wget": "http_fingerprint",
            "httpie": "http_headers", "http": "http_headers",
        }
        return mapping.get(external_tool)
