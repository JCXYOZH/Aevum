# tools/scanner.py
# 安全扫描器：基于 nmap、msfconsole、xray、nuclei 等工具执行安全扫描
# 同时集成原生Python工具（不依赖外部安装），支持结果自动存入记忆系统
import os
import re
import json
import time
import shutil
import subprocess
import tempfile
import logging
import platform
from typing import Dict, List, Optional, Any
from libertas.tools.tool_manager import ToolManager
from libertas.utils.text_decode import decode_output, describe_exception
from libertas.tools.legacy_mrhua import native_tools
import threading
# 可选依赖
try:
    import yaml
except ImportError:
    yaml = None

# 导入配置
from libertas.foundation.config import config

# 配置日志
logger = logging.getLogger(__name__)

from .base import *


class WorkflowMixin:
    def quick_scan(self, target: str, mode: str = "standard",
                   timeout: int = 0, wordlist_size: str = "medium") -> Dict[str, Any]:
        self.reset_cancel()
        results = {}
        start = time.time()

        timeouts = {
            "fast": {"port_scan": 30, "subdomain_enum": 20, "dir_bruteforce": 30, "default": 15},
            "standard": {"port_scan": 60, "subdomain_enum": 30, "dir_bruteforce": 60, "default": 20},
            "full": {"port_scan": 180, "subdomain_enum": 90, "dir_bruteforce": 120, "default": 30},
            "web": {"port_scan": 30, "subdomain_enum": 20, "dir_bruteforce": 120, "default": 30},
        }
        to = timeouts.get(mode, timeouts["standard"])
        if timeout > 0:
            for k in to:
                to[k] = timeout

        scan_plans = {
            "fast": [
                ("ping", {"target": target}),
                ("port_scan", {"target": target, "ports": "21,22,23,25,53,80,110,135,139,143,443,445,993,995,1433,3306,3389,5432,5900,6379,8080,8443",
                               "timeout": 1.5, "max_workers": 100, "overall_timeout": to["port_scan"]}),
                ("dns_lookup", {"domain": target}),
            ],
            "standard": [
                ("ping", {"target": target}),
                ("port_scan", {"target": target, "ports": "1-1024", "timeout": 1.5,
                               "max_workers": 200, "overall_timeout": to["port_scan"]}),
                ("dns_lookup", {"domain": target}),
                ("http_fingerprint", {"url": target}),
            ],
            "full": [
                ("ping", {"target": target}),
                ("port_scan", {"target": target, "ports": "1-65535", "timeout": 0.8,
                               "max_workers": 800, "overall_timeout": to["port_scan"]}),
                ("dns_lookup", {"domain": target}),
                ("whois", {"domain": target}),
                ("http_fingerprint", {"url": target}),
                ("ssl_info", {"host": target}),
                ("subdomain_enum", {"domain": target, "wordlist_name": "subdomains",
                                    "timeout": 1.5, "max_workers": 100,
                                    "overall_timeout": to["subdomain_enum"]}),
            ],
            "web": [
                ("http_fingerprint", {"url": target}),
                ("ssl_info", {"host": target}),
                ("dir_bruteforce", {"url": target, "wordlist_name": f"directories_{wordlist_size}" if wordlist_size != "medium" else "directories",
                                    "timeout": 4, "max_workers": 30,
                                    "overall_timeout": to["dir_bruteforce"]}),
            ],
        }

        plan = scan_plans.get(mode, scan_plans["standard"])
        errors = []
        for tool_name, tool_params in plan:
            if self._cancel_event.is_set():
                results[tool_name] = {"success": False, "error": "用户中止", "cancelled": True}
                continue
            try:
                if tool_name in self.native_tools:
                    results[tool_name] = self.run_native(tool_name, **tool_params)
                else:
                    results[tool_name] = self.run_tool(tool_name, tool_params)
            except Exception as e:
                err_msg = str(e)
                errors.append(f"{tool_name}: {err_msg}")
                results[tool_name] = {"success": False, "error": err_msg}

        elapsed = time.time() - start
        summary = self._build_quick_summary(target, results, mode)
        return {
            "success": True,
            "target": target,
            "mode": mode,
            "elapsed": round(elapsed, 2),
            "results": results,
            "summary": summary,
            "errors": errors,
            "cancelled": self._cancel_event.is_set(),
        }

    def _build_quick_summary(self, target: str, results: Dict, mode: str) -> str:
        lines = [f"快速扫描 ({mode}) - 目标: {target}"]
        for tool_name, r in results.items():
            if not isinstance(r, dict):
                continue
            if r.get("success"):
                data = r.get("data", {})
                if tool_name == "port_scan":
                    ports = data.get("open_ports", [])
                    plist = ", ".join(f"{p['port']}/{p['service']}" for p in ports[:10])
                    lines.append(f"  [端口] {len(ports)} 个开放: {plist}")
                elif tool_name == "dns_lookup":
                    recs = data.get("records", [])
                    lines.append(f"  [DNS] {len(recs)} 条记录")
                elif tool_name == "ping":
                    lines.append(f"  [Ping] {'存活' if data.get('alive') else '不可达'}")
                elif tool_name == "whois":
                    info = data.get("info", {})
                    lines.append(f"  [WHOIS] 注册商: {info.get('registrar', '未知')}")
                elif tool_name == "http_fingerprint":
                    lines.append(f"  [HTTP] {data.get('status_code')} - {data.get('title', '')[:40]}")
                elif tool_name == "ssl_info":
                    lines.append(f"  [SSL] {data.get('protocol')}")
                elif tool_name == "subdomain_enum":
                    lines.append(f"  [子域名] {len(data.get('subdomains', []))} 个")
                elif tool_name == "dir_bruteforce":
                    lines.append(f"  [目录] {len(data.get('paths', []))} 个路径")
                else:
                    lines.append(f"  [{tool_name}] 完成")
            else:
                lines.append(f"  [{tool_name}] 失败: {r.get('error', '未知错误')[:60]}")
        return "\n".join(lines)

    def run_workflow(self, steps: List[Dict[str, Any]]) -> Dict[str, Any]:
        results = []
        context = {}
        start = time.time()

        for i, step in enumerate(steps):
            tool_name = step.get("tool")
            params = step.get("params", {})
            if not tool_name:
                continue

            for k, v in list(params.items()):
                if isinstance(v, str) and v.startswith("$"):
                    ref_key = v[1:]
                    if ref_key in context:
                        params[k] = context[ref_key]

            try:
                if tool_name in self.native_tools:
                    r = self.run_native(tool_name, **params)
                else:
                    r = self.run_tool(tool_name, params)
                results.append({"step": i + 1, "tool": tool_name, "result": r})

                if r.get("success"):
                    data = r.get("data", {})
                    if "open_ports" in data and data["open_ports"]:
                        context["open_port"] = str(data["open_ports"][0]["port"])
                        if params.get("target"):
                            context["target_with_port"] = f"{params['target']}:{data['open_ports'][0]['port']}"
                    if "records" in data and data["records"]:
                        context["ip"] = data["records"][0].get("value", "")
            except Exception as e:
                results.append({"step": i + 1, "tool": tool_name, "error": str(e)})

        return {
            "success": True,
            "steps_count": len(steps),
            "elapsed": round(time.time() - start, 2),
            "results": results,
        }

    def check_all_tools(self) -> Dict[str, Any]:
        import shutil as _shutil
        external = []
        native = []
        for name, cfg in self.tool_manager.tools.items():
            path = cfg.get("path", name)
            available = _shutil.which(path) is not None
            external.append({
                "name": name,
                "path": path,
                "available": available,
                "category": cfg.get("category", "其他"),
                "description": cfg.get("description", ""),
            })
        for t in native_tools.list_native_tools():
            native.append({
                "name": t["name"],
                "available": True,
                "category": t["category"],
                "description": t["description"],
                "native": True,
            })
        installed = sum(1 for t in external if t["available"])
        return {
            "external": external,
            "native": native,
            "external_total": len(external),
            "external_installed": installed,
            "native_total": len(native),
            "total_available": installed + len(native),
        }
