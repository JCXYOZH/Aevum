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


class ExecutorCatalogMixin:
    """可用工具清单收集。"""

    def _collect_available_tools(self) -> List[Dict]:
        """收集所有当前可用工具的结构化数据（按治理配置过滤）。
    
        返回: [{"name", "display_name", "type", "category", "risk", "desc", "installed"}, ...]
        供 get_model_tool_definition（生成enum）和 search_tools（按需查询）复用。
        """
        cfg = self.gov._config
        # 这里用「模型可见上限」，而不是「自动执行上限」。
        # 两者混用会有两个后果：调高自动执行级别会把中高危工具一并塞给模型；
        # 而中高危工具又**永远无法**通过任何权限单独开放。
        visible_max_risk = self.gov._risk_level_value(
            cfg.get("model_visible_max_risk", "safe")
            if isinstance(cfg.get("model_visible_max_risk"), str)
            else cfg.get("model_visible_max_risk", RiskLevel.SAFE).value
        )
        enabled_types = cfg.get("enabled_types", {})
        enabled_categories = cfg.get("enabled_categories", {})
        blocked_risks = set(cfg.get("blocked_risks", ["dangerous"]))
    
        def _is_allowed(risk_str: str, tool_type: str, category: str) -> bool:
            if risk_str in blocked_risks:
                return False
            if not enabled_types.get(tool_type, True):
                return False
            if category in enabled_categories and not enabled_categories[category]:
                return False
            if self.gov._risk_level_value(risk_str) > visible_max_risk:
                return False
            return True
    
        tools: List[Dict] = []
        seen_names = set()
    
        # 1. 原生工具
        for name, info in NATIVE_TOOL_REGISTRY.items():
            if name.startswith("web_") or name in ("media_analyze", "link_check", "link_repair"):
                continue
            risk = info["risk"].value if isinstance(info["risk"], RiskLevel) else str(info["risk"])
            cat = info.get("category", "其他")
            if not _is_allowed(risk, "native", cat):
                continue
            seen_names.add(name)
            tools.append({
                "name": name, "display_name": name, "type": "native",
                "category": cat, "risk": risk,
                "desc": info.get("desc", name), "installed": True,
            })
    
        # 2. 插件工具
        try:
            from libertas.tools.plugin_system import get_plugin_manager
            pm = get_plugin_manager()
            for pt in pm.list_registered_tools():
                pname = pt["name"]
                pdesc = pt.get("desc", pname)
                pcat = pt.get("category", "实用工具")
                pinfo = PLUGIN_REGISTRY.get(pname, {})
                prisk = pinfo.get("risk", RiskLevel.LOW)
                prisk_v = prisk.value if isinstance(prisk, RiskLevel) else str(prisk)
                if not _is_allowed(prisk_v, "plugin", pcat):
                    continue
                display_cat = "编码解码" if pcat in ("工具", "编码解码") else pcat
                if pname in seen_names:
                    # 重名插件用 plugin_ 前缀
                    display_name = f"plugin_{pname}"
                else:
                    display_name = pname
                seen_names.add(pname)
                tools.append({
                    "name": pname, "display_name": display_name, "type": "plugin",
                    "category": display_cat, "risk": prisk_v,
                    "desc": pdesc, "installed": True,
                })
        except Exception:
            pass
    
        # 3. 外部工具（config.yaml + 自动发现）
        if self.scanner:
            try:
                ext_status = self.scanner.check_all_tools()
                ext_list = ext_status.get("external", []) if isinstance(ext_status, dict) else []
                for item in ext_list:
                    if not item.get("available"):
                        continue
                    name = item.get("name", "")
                    if name in seen_names:
                        # 重名外部工具用 ext_ 前缀（代码支持重叠，不跳过）
                        display_name = f"ext_{name}"
                    else:
                        display_name = name
                    risk = EXTERNAL_TOOL_RISK.get(name, RiskLevel.MEDIUM)
                    cat = item.get("category", "外部工具")
                    if name not in EXTERNAL_TOOL_RISK:
                        risk = CATEGORY_DEFAULT_RISK.get(cat, RiskLevel.MEDIUM)
                    risk_v = risk.value if isinstance(risk, RiskLevel) else str(risk)
                    if not _is_allowed(risk_v, "external", cat):
                        continue
                    seen_names.add(name)
                    tools.append({
                        "name": name, "display_name": display_name, "type": "external",
                        "category": cat, "risk": risk_v,
                        "desc": item.get("description", cat), "installed": True,
                    })
            except Exception:
                pass
    
            # 自动发现：TOOL_REGISTRY 中已安装但未列出的工具
            try:
                from ..tools.tool_installer import TOOL_REGISTRY
                import shutil as _shutil
                _cat_map = {
                    "信息收集": "信息收集", "扫描器": "扫描爆破", "Web扫描": "Web安全",
                    "Web代理": "Web安全", "密码攻击": "密码破解", "网络分析": "流量分析",
                    "网络工具": "网络诊断", "逆向工程": "逆向分析", "漏洞利用": "漏洞检测",
                    "渗透框架": "漏洞检测", "无线安全": "无线安全", "云安全": "系统审计",
                    "OSINT": "信息收集", "加密": "其他", "数据库": "其他",
                    "移动安全": "其他", "取证": "取证分析",
                }
                _dev_categories = {"开发工具"}  # 只过滤开发工具，工具管理有权限管理，应该开放
                for name, info in sorted(TOOL_REGISTRY.items()):
                    if name in seen_names:
                        # 重名外部工具用 ext_ 前缀（代码支持重叠，不跳过）
                        display_name = f"ext_{name}"
                    else:
                        display_name = name
                    cat_raw = info.get("category", "其他")
                    if cat_raw in _dev_categories:
                        continue
                    # 移除 _shutil.which(cmd) 检查，让模型能调用除了开发工具之外的全部可用工具
                    # （最高权限开放给人工智能，工具是否可用由执行器在调用时判断）
                    risk = EXTERNAL_TOOL_RISK.get(name, RiskLevel.MEDIUM)
                    if name not in EXTERNAL_TOOL_RISK:
                        risk = CATEGORY_DEFAULT_RISK.get(_cat_map.get(cat_raw, "其他"), RiskLevel.MEDIUM)
                    risk_v = risk.value if isinstance(risk, RiskLevel) else str(risk)
                    cat = _cat_map.get(cat_raw, "其他")
                    if not _is_allowed(risk_v, "external", cat):
                        continue
                    seen_names.add(name)
                    tools.append({
                        "name": name, "display_name": display_name, "type": "external",
                        "category": cat, "risk": risk_v,
                        "desc": info.get("desc", cat_raw), "installed": True,
                    })
            except Exception:
                pass
    
        # 4. 平台工具动态注册（Windows通过WSL，Linux/macOS直接检查PATH）
        try:
            platform_tools = discover_platform_tools()
            for pt in platform_tools:
                name = pt["name"]
                if name in seen_names:
                    # 重名工具用平台前缀（代码支持重叠，不跳过）
                    tool_type = pt.get("type", "native")
                    prefix = "wsl_" if tool_type == "wsl" else "ext_"
                    display_name = f"{prefix}{name}"
                else:
                    display_name = name
                risk_v = pt["risk"]
                cat = pt["category"]
                tool_type = pt.get("type", "native")
                if not _is_allowed(risk_v, "external", cat):
                    continue
                seen_names.add(name)
                tools.append({
                    "name": name, "display_name": display_name, "type": tool_type,
                    "category": cat, "risk": risk_v,
                    "desc": pt["desc"], "installed": True,
                })
        except Exception:
            pass
    
        return tools
