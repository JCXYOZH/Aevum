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
from .models import PendingApproval, RiskLevel, ToolCallRecord


class ExecutorModelMixin:
    """模型工具定义、参数提示、搜索定义与工具搜索。"""

    @staticmethod
    def _accepted_param_keys(tool_name: str):
        """该工具**真实签名**能接受的关键字名；拿不到签名时返回 None（不过滤）。
    
        **kwargs 兜底的工具返回 None：任何键都能进，示例参数无需裁剪。
        """
        try:
            from ..tools import native_tools as _nt
            import inspect as _inspect
            info = _nt.NATIVE_TOOLS.get(tool_name) or {}
            fn = info.get("fn")
            if fn is None:
                return None
            sig = _inspect.signature(fn)
            if any(p.kind == _inspect.Parameter.VAR_KEYWORD
                   for p in sig.parameters.values()):
                return None
            return {n for n, p in sig.parameters.items()
                    if p.kind not in (_inspect.Parameter.VAR_POSITIONAL,)}
        except Exception:
            return None

    def _build_contract_examples(self, available: List[str]) -> str:
        """按当前可用工具动态生成调用示例（保证示例即契约、可直接执行）。"""
        avail = set(available)
        lines: List[str] = []
        for label, candidates, target, params in self._CONTRACT_EXAMPLE_SPECS:
            name = next((c for c in candidates if c in avail), None)
            if not name:
                continue
            accepted = self._accepted_param_keys(name)
            if accepted is not None:
                params = {k: v for k, v in params.items() if k in accepted}
            body: Dict[str, Any] = {"tool_name": name, "target": target}
            if params:
                body["params"] = params
            lines.append(f"- {label}: " + json.dumps(body, ensure_ascii=False))
        if not lines:
            return ""
        lines.append("不确定工具名或参数时，先调用 search_tools 查询可用工具。")
        return "示例：\n" + "\n".join(lines) + "\n"

    def get_model_tool_definition(self) -> Dict:
        """返回给模型的function calling工具定义（精简版：enum + 一句话描述）。
    
        附带一份「参数速查」：把每个工具**除 target 之外**还需要/建议提供的参数
        直接写进描述里。以前模型只知道工具名，参数键名全靠猜（猜错就是
        「缺少必填参数: url」），只能失败一次再 search_tools 补救。
        """
        tools = self._collect_available_tools()
        all_names = [t["display_name"] for t in tools]
    
        examples = self._build_contract_examples(all_names)
        param_hints = self._build_param_hints(set(all_names))
        hints_block = (
            "\n【参数速查】下面这些工具除 target 外还需要/建议提供括号里的参数，"
            "键名照抄即可；没列出的工具只需要 target：\n  " + param_hints + "\n"
            "（括号里的参数有默认值的可以不传，例如 nmap 的 ports 默认 1-1000）\n"
        ) if param_hints else ""
    
        return {
            "type": "function",
            "function": {
                "name": "security_tool",
                "description": (
                    "调用系统安全工具执行网络侦察、扫描、信息收集、编码解码等操作。"
                    "本机已授权到高危级别：扫描/检测/漏洞验证类工具都可以**直接执行**，不需要再请求确认。\n"
                    "使用原则：\n"
                    "  1) 用户要求扫描、找漏洞、探测、侦察、验证时，直接调用工具去做，"
                    "不要只给方案、清单或\"建议你自己跑\"；\n"
                    "  2) 一次不成功就换等价工具或改参数继续（如 ffuf↔dir_bruteforce、"
                    "nmap↔port_scan、dig↔dns_lookup）；\n"
                    "  3) 需要组合多个工具时连续调用，不要中途停下来等用户催；\n"
                    "工具名称必须从 tool_name 的 enum 中选择。\n"
                    + hints_block +
                    "需要某个工具的完整参数说明与用法时，调用 search_tools 查询。\n\n"
                    + examples
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "tool_name": {
                            "type": "string",
                            "description": "要调用的工具名称（从enum中选择，插件版以plugin_开头）",
                            "enum": all_names,
                        },
                        "target": {
                            "type": "string",
                            "description": "目标IP、域名或URL（编码解码等无目标工具可留空）"
                        },
                        "params": {
                            "type": "object",
                            "description": "额外参数，键名见 description 的【参数速查】，"
                                           "如 {\"ports\": \"1-1024\", \"record_type\": \"A\"}",
                            "properties": {}
                        }
                    },
                    "required": ["tool_name"]
                }
            }
        }

    def _build_param_hints(self, visible: set) -> str:
        """生成「工具(额外参数)」速查表，直接写进 security_tool 的描述。
    
        只列「除 target 之外还需要/建议提供」的参数，所以绝大多数工具不会出现，
        整张表约 1KB，代价很小，但让模型调用前就知道键名，不用靠试错。
        """
        parts = []
        # 原生工具：按真实函数签名取必填参数
        try:
            import inspect as _inspect
            from ..tools import native_tools as _nt
            for name, info in _nt.NATIVE_TOOLS.items():
                if name not in visible:
                    continue
                try:
                    sig = _inspect.signature(info.get("fn"))
                except Exception:
                    continue
                extra = [
                    p for p, v in sig.parameters.items()
                    if v.default is _inspect.Parameter.empty
                    and v.kind not in (_inspect.Parameter.VAR_KEYWORD,
                                       _inspect.Parameter.VAR_POSITIONAL)
                    and p not in self._GENERIC_TARGET_PARAMS
                ]
                if extra:
                    parts.append("%s(%s)" % (name, ", ".join(extra)))
        except Exception:
            pass
        # 外部工具：按命令模板里声明过的必填槽
        try:
            tm = getattr(self.scanner, "tool_manager", None)
            asm_tools = getattr(getattr(tm, "assembler", None), "tools", {}) or {}
            for name, td in asm_tools.items():
                if name not in visible:
                    continue
                slots = getattr(td, "slots", {}) or {}
                extra = [
                    s for s, v in slots.items()
                    if getattr(v, "required", False)
                    and s not in self._GENERIC_TARGET_PARAMS
                ]
                if extra:
                    parts.append("%s(%s)" % (name, ", ".join(extra)))
        except Exception:
            pass
        return "  ".join(sorted(set(parts)))

    def get_search_tools_definition(self) -> Dict:
        """search_tools 函数定义：模型按需查询工具目录。"""
        return {
            "type": "function",
            "function": {
                "name": "search_tools",
                "description": (
                    "查询可用的安全工具目录。可以按类别、关键词、风险级别筛选。"
                    "不传参数返回所有工具（按类别分组）。"
                    "传 tool_name 返回该工具的详细帮助（参数、用法、示例）。"
                    "在以下情况调用：(1)用户问你有什么工具/能力；(2)不确定用什么工具；"
                    "(3)需要了解工具参数；(4)想查看某类工具有哪些。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "category": {
                            "type": "string",
                            "description": "按类别筛选，如 信息收集、Web安全、密码破解、漏洞检测、流量分析、网络诊断、逆向分析、编码解码、实用工具等"
                        },
                        "keyword": {
                            "type": "string",
                            "description": "按关键词搜索工具名或描述（如 dns、端口、爆破、编码）"
                        },
                        "risk": {
                            "type": "string",
                            "description": "按风险级别筛选：safe、low、medium、high",
                            "enum": ["safe", "low", "medium", "high"]
                        },
                        "tool_name": {
                            "type": "string",
                            "description": "查询指定工具的详细帮助和参数说明（如 dns_lookup、dig、curl）"
                        }
                    }
                }
            }
        }

    def search_tools(self, category: str = None, keyword: str = None, risk: str = None, tool_name: str = None) -> str:
        """查询可用工具目录，返回紧凑的格式化文本（给模型直接阅读）。
    
        传 tool_name 时返回该工具的详细帮助（从 help_parser 获取）。
    
        全量查询：按类别列出工具名，不带描述（省token）。
        带筛选时：结果少，附带描述和风险级别。
        传 tool_name：返回该工具的详细帮助（参数、用法）。
        """
        # 指定工具名：返回详细帮助
        if tool_name:
            tool_name = tool_name.strip().lower()
            # 先找工具信息
            tools = self._collect_available_tools()
            found = None
            for t in tools:
                if t["display_name"].lower() == tool_name or t["name"].lower() == tool_name:
                    found = t
                    break
            if not found:
                return f"未找到工具 '{tool_name}'。调用 search_tools() 查看所有可用工具。"
            # 外部工具：用 help_parser 解析 --help
            if found.get("type") == "external" and found.get("path"):
                try:
                    from libertas.tools.help_parser import get_help_parser
                    hp = get_help_parser()
                    help_text = hp.get_help(found["name"], tool_path=found["path"], max_chars=2000)
                    if help_text:
                        return f"【{found['display_name']}】[{found['risk']}]\n{found['desc']}\n\n{help_text}"
                except Exception:
                    pass
            # 原生工具：从函数签名和docstring生成
            if found.get("type") == "native":
                try:
                    import inspect
                    from ..tools import native_tools as _nt
                    func = getattr(_nt, f"native_{found['name']}", None)
                    if func:
                        sig = inspect.signature(func)
                        params = []
                        for pname, param in sig.parameters.items():
                            if pname in ("timeout", "_extra"):
                                continue
                            if param.default is inspect.Parameter.empty:
                                params.append(pname)
                            else:
                                params.append(f"{pname}={param.default!r}")
                        doc = (func.__doc__ or "").strip()
                        # 只有第一个参数确实是"目标"时才提示 <目标>；
                        # 否则（如 encode_decode(text, ...)）会误导模型去传一个并不存在的目标。
                        _first = str(params[0]).split("=")[0].lower() if params else ""
                        _needs_target = _first in (
                            "target", "domain", "host", "url", "uri", "ip",
                            "addr", "address", "cidr", "query", "email")
                        _usage = (f"<<<TOOL:{found['name']} <目标> [选项]>>>" if _needs_target
                                  else f"<<<TOOL:{found['name']} [选项]>>>")
                        return (
                            f"【{found['display_name']}】[{found['risk']}]\n"
                            f"{found['desc']}\n\n"
                            f"参数: {', '.join(params)}\n"
                            f"调用: {_usage}\n\n"
                            f"{doc[:500]}"
                        )
                except Exception:
                    pass
            return f"【{found['display_name']}】[{found['risk']}]\n{found['desc']}\n类别: {found['category']}"
    
        tools = self._collect_available_tools()
    
        # 筛选
        result = tools
        _filtered = bool(category or keyword or risk)
        if category:
            cat_lower = category.lower()
            result = [t for t in result if cat_lower in t["category"].lower()]
        if risk:
            result = [t for t in result if t["risk"] == risk.lower()]
        if keyword:
            kw_lower = keyword.lower()
            result = [t for t in result if kw_lower in t["name"].lower() or kw_lower in t["desc"].lower()]
    
        # 按类别分组（保持收集顺序）
        grouped: Dict[str, List[Dict]] = {}
        for t in result:
            grouped.setdefault(t["category"], []).append(t)
    
        lines = [f"共 {len(result)} 个工具，{len(grouped)} 个类别："]
        for cat, items in grouped.items():
            if _filtered and len(items) <= 30:
                # 筛选模式：带描述和风险
                lines.append(f"\n【{cat}】({len(items)}个)")
                for t in items:
                    tag = "插件" if t["type"] == "plugin" else ""
                    tag_str = f"[{t['risk']}{'/'+tag if tag else ''}] " if tag or t['risk'] != 'safe' else ""
                    lines.append(f"  {t['display_name']} {tag_str}{t['desc']}")
            else:
                # 全量模式：只列工具名，逗号分隔，最紧凑
                names = ", ".join(t["display_name"] for t in items)
                lines.append(f"\n【{cat}】({len(items)}个): {names}")
    
        return "\n".join(lines)
