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


class GovernanceCatalogMixin:
    """工具信息与全部工具目录。"""

    def get_tool_info(self, tool_name: str, tool_type: str = "native") -> Dict:
        """获取工具元信息"""
        if tool_type == "native":
            info = NATIVE_TOOL_REGISTRY.get(tool_name, {})
            return {
                "name": tool_name,
                "type": "native",
                "risk": info.get("risk", RiskLevel.MEDIUM).value if isinstance(info.get("risk"), RiskLevel) else str(info.get("risk", "medium")),
                "category": info.get("category", "其他"),
                "desc": info.get("desc", tool_name),
            }
        elif tool_type == "plugin":
            info = PLUGIN_REGISTRY.get(tool_name, {})
            return {
                "name": tool_name,
                "type": "plugin",
                "risk": info.get("risk", RiskLevel.LOW).value if isinstance(info.get("risk"), RiskLevel) else str(info.get("risk", "low")),
                "category": "插件工具",
                "desc": info.get("desc", f"插件 {tool_name}"),
            }
        elif tool_type == "external":
            risk = EXTERNAL_TOOL_RISK.get(tool_name, RiskLevel.MEDIUM)
            return {
                "name": tool_name,
                "type": "external",
                "risk": risk.value if isinstance(risk, RiskLevel) else str(risk),
                "category": "外部工具",
                "desc": f"外部工具 {tool_name}",
            }
        elif tool_type == "wordlist":
            return {
                "name": tool_name,
                "type": "wordlist",
                "risk": RiskLevel.SAFE.value,
                "category": "字典资源",
                "desc": f"字典 {tool_name}",
            }
        elif tool_type == "installable":
            try:
                from ..tools.tool_installer import TOOL_REGISTRY
                info = TOOL_REGISTRY.get(tool_name, {})
                cat = info.get("category", "其他")
                # 分类映射到标准分类名称
                _cat_map = {
                    "信息收集": "信息收集", "侦察": "信息收集", "OSINT": "信息收集",
                    "扫描器": "扫描爆破", "Web扫描": "Web安全", "目录扫描": "扫描爆破",
                    "漏洞扫描": "漏洞检测", "漏洞利用": "漏洞检测", "渗透框架": "漏洞检测",
                    "密码攻击": "密码破解", "密码破解": "密码破解",
                    "网络攻击": "网络诊断", "网络工具": "网络诊断",
                    "无线安全": "无线安全",
                    "逆向工程": "逆向分析", "逆向": "逆向分析",
                    "数据库": "其他", "移动安全": "其他", "云安全": "系统审计",
                    "取证": "取证分析", "取证分析": "取证分析",
                    "Web代理": "Web安全", "Web安全": "Web安全",
                    "流量分析": "流量分析", "网络分析": "流量分析",
                    "加密": "编码解码", "编码解码": "编码解码",
                    "开发工具": "工具管理", "工具管理": "工具管理",
                    "其他": "其他",
                }
                standard_cat = _cat_map.get(cat, cat)
                # 根据分类推断风险级别
                if standard_cat in ("密码破解", "无线安全"):
                    risk = RiskLevel.HIGH
                elif standard_cat in ("扫描爆破", "Web安全", "漏洞检测", "逆向分析", "流量分析"):
                    risk = RiskLevel.MEDIUM
                else:
                    risk = RiskLevel.LOW
                return {
                    "name": tool_name,
                    "type": "installable",
                    "risk": risk.value,
                    "category": standard_cat,
                    "desc": info.get('desc', tool_name),
                }
            except Exception:
                return {
                    "name": tool_name,
                    "type": "installable",
                    "risk": RiskLevel.MEDIUM.value,
                    "category": "其他",
                    "desc": f"可安装工具 {tool_name}",
                }
        else:
            info = NATIVE_TOOL_REGISTRY.get(tool_name, {})
            return {
                "name": tool_name,
                "type": tool_type,
                "risk": info.get("risk", RiskLevel.SAFE).value if isinstance(info.get("risk"), RiskLevel) else "safe",
                "category": info.get("category", "网络工具"),
                "desc": info.get("desc", tool_name),
            }

    def list_all_tools(self, scanner=None) -> List[Dict]:
        """列出所有可用工具（原生+外部+网络工具）"""
        tools = []
    
        # 网络工具
        for name in ["web_search", "web_fetch", "web_deep_search", "media_analyze",
                      "link_check", "link_repair"]:
            info = NATIVE_TOOL_REGISTRY.get(name, {})
            tools.append({
                "name": name,
                "type": "web",
                "risk": info.get("risk", RiskLevel.SAFE).value if isinstance(info.get("risk"), RiskLevel) else "safe",
                "category": info.get("category", "网络工具"),
                "desc": info.get("desc", name),
                "available": True,
            })
    
        # 原生工具
        for name, info in NATIVE_TOOL_REGISTRY.items():
            if name.startswith("web_") or name in ("media_analyze", "link_check", "link_repair"):
                continue
            risk = info["risk"].value if isinstance(info["risk"], RiskLevel) else str(info["risk"])
            tools.append({
                "name": name,
                "type": "native",
                "risk": risk,
                "category": info.get("category", "其他"),
                "desc": info.get("desc", name),
                "available": True,
            })
    
        # 外部工具（如果有scanner，检查是否安装）
        if scanner is not None:
            try:
                ext_status = scanner.check_all_tools()
                # check_all_tools 返回 {"external": [{name, available, ...}], ...}
                ext_list = ext_status.get("external", []) if isinstance(ext_status, dict) else []
                ext_installed = {}
                ext_category = {}
                ext_desc = {}
                for item in ext_list:
                    n = item.get("name", "")
                    if n:
                        ext_installed[n] = bool(item.get("available", False))
                        ext_category[n] = item.get("category", "外部工具")
                        ext_desc[n] = item.get("description", "")
                # 合并 EXTERNAL_TOOL_RISK 中定义的 + config.yaml 中动态发现的
                all_ext_names = set(EXTERNAL_TOOL_RISK.keys()) | set(ext_installed.keys())
                import shutil as _shutil
                for name in sorted(all_ext_names):
                    risk = EXTERNAL_TOOL_RISK.get(name, RiskLevel.MEDIUM)
                    # 根据类别推断风险级别
                    cat = ext_category.get(name, "外部工具")
                    if name not in EXTERNAL_TOOL_RISK:
                        risk = CATEGORY_DEFAULT_RISK.get(cat, RiskLevel.MEDIUM)
                    # 可用状态：config.yaml检测结果优先，否则检查PATH
                    if name in ext_installed:
                        avail = ext_installed[name]
                    else:
                        avail = bool(_shutil.which(name))
                    tools.append({
                        "name": name,
                        "type": "external",
                        "risk": risk.value if isinstance(risk, RiskLevel) else str(risk),
                        "category": cat,
                        "desc": ext_desc.get(name, f"外部安全工具 {name}"),
                        "available": avail,
                    })
            except Exception:
                for name, risk in EXTERNAL_TOOL_RISK.items():
                    tools.append({
                        "name": name,
                        "type": "external",
                        "risk": risk.value if isinstance(risk, RiskLevel) else str(risk),
                        "category": "外部工具",
                        "desc": f"外部安全工具 {name}",
                        "available": None,
                    })
    
        # 内置插件（硬编码注册表）
        for name, info in PLUGIN_REGISTRY.items():
            risk = info["risk"].value if isinstance(info["risk"], RiskLevel) else str(info["risk"])
            tools.append({
                "name": name,
                "type": "plugin",
                "risk": risk,
                "category": "插件工具",
                "desc": info.get("desc", name),
                "available": True,
            })
    
        # 动态扫描用户插件目录（新下载/自定义的插件）
        try:
            import glob as _glob
            plugin_dirs = [
                os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "plugins"),
                os.path.join(os.path.expanduser("~"), "LibertasData", "plugins"),
            ]
            seen_plugins = set(t["name"] for t in tools if t["type"] == "plugin")
            for pdir in plugin_dirs:
                if not os.path.isdir(pdir):
                    continue
                for fn in sorted(os.listdir(pdir)):
                    if not fn.endswith(".py") or fn.startswith("_"):
                        continue
                    mod_name = fn[:-3]
                    if mod_name in seen_plugins:
                        continue
                    seen_plugins.add(mod_name)
                    # 尝试读取插件描述
                    desc = f"自定义插件 {mod_name}"
                    try:
                        with open(os.path.join(pdir, fn), "r", encoding="utf-8", errors="replace") as _f:
                            head = _f.read(2000)
                        import re as _re
                        m = _re.search(r'["\']{3}(.*?)["\']{3}', head, _re.DOTALL)
                        if m:
                            first_line = m.group(1).strip().split("\n")[0].strip()
                            if first_line:
                                desc = first_line[:60]
                    except Exception:
                        pass
                    tools.append({
                        "name": mod_name,
                        "type": "plugin",
                        "risk": RiskLevel.LOW.value,
                        "category": "自定义插件",
                        "desc": desc,
                        "available": True,
                    })
        except Exception:
            pass
    
        # 字典资源（检查是否已下载到 LibertasWorkspace）
        try:
            from ..tools.tool_installer import WORDLIST_REGISTRY
            home = os.path.expanduser("~")
            for name, info in WORDLIST_REGISTRY.items():
                target_subdir = info.get("target_subdir", "Wordlists")
                target_dir = os.path.join(home, "LibertasWorkspace", target_subdir)
                is_git = "git" in info or name == "SecLists"
                if is_git:
                    # git 仓库：检查目录是否存在
                    repo_name = info.get("git", "").rstrip("/").split("/")[-1].replace(".git", "") if info.get("git") else name
                    wl_available = os.path.isdir(os.path.join(target_dir, repo_name))
                else:
                    # 单文件：检查文件是否存在
                    url = info.get("url", "")
                    fname = url.split("/")[-1].split("?")[0] if url else ""
                    wl_available = os.path.isfile(os.path.join(target_dir, fname)) if fname else False
                tools.append({
                    "name": name,
                    "type": "wordlist",
                    "risk": RiskLevel.SAFE.value,
                    "category": "字典资源",
                    "desc": info.get("desc", name),
                    "available": wl_available,
                })
        except Exception:
            pass
    
        # 工具安装器中所有可安装工具（检查是否已安装）
        try:
            from ..tools.tool_installer import TOOL_REGISTRY
            import shutil as _shutil
            # 分类映射到标准分类名称
            _cat_map = {
                "信息收集": "信息收集", "侦察": "信息收集", "OSINT": "信息收集",
                "扫描器": "扫描爆破", "Web扫描": "Web安全", "目录扫描": "扫描爆破",
                "漏洞扫描": "漏洞检测", "漏洞利用": "漏洞检测", "渗透框架": "漏洞检测",
                "密码攻击": "密码破解", "密码破解": "密码破解",
                "网络攻击": "网络诊断", "网络工具": "网络诊断",
                "无线安全": "无线安全",
                "逆向工程": "逆向分析", "逆向": "逆向分析",
                "数据库": "其他", "移动安全": "其他", "云安全": "系统审计",
                "取证": "取证分析", "取证分析": "取证分析",
                "Web代理": "Web安全", "Web安全": "Web安全",
                "流量分析": "流量分析", "网络分析": "流量分析",
                "加密": "编码解码", "编码解码": "编码解码",
                "开发工具": "工具管理", "工具管理": "工具管理",
                "其他": "其他",
            }
            # 收集已在外部工具中列出的名称，避免重复
            ext_names = set(t["name"] for t in tools if t["type"] == "external")
            for name, info in TOOL_REGISTRY.items():
                if name in ext_names:
                    continue  # 已在外部工具中列出
                cat = info.get("category", "其他")
                standard_cat = _cat_map.get(cat, cat)
                # 根据标准分类推断风险
                if standard_cat in ("密码破解", "无线安全"):
                    risk = RiskLevel.HIGH
                elif standard_cat in ("扫描爆破", "Web安全", "漏洞检测", "逆向分析", "流量分析"):
                    risk = RiskLevel.MEDIUM
                else:
                    risk = RiskLevel.LOW
                # 检查命令是否在 PATH 中
                cmd_name = info.get("cmd", name)
                installed = bool(_shutil.which(cmd_name))
                tools.append({
                    "name": name,
                    "type": "installable",
                    "risk": risk.value,
                    "category": standard_cat,
                    "desc": info.get('desc', name),
                    "available": installed,
                })
        except Exception:
            pass
    
        return tools
