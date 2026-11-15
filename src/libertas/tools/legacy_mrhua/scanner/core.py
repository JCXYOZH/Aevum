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


class CoreMixin:
    def __init__(
        self,
        nmap_path: Optional[str] = None,
        xray_path: Optional[str] = None,
        nuclei_path: Optional[str] = None,
        msf_path: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
        memory_system: Optional[Any] = None,
        stats_panel: Optional[Dict[str, Any]] = None,
    ):
        # config 形参此前无兜底：不传参时 config=None，下面 config.get(...)
        # 直接抛 AttributeError（形参本身也遮蔽了模块级 config，故统一兜底成空字典）
        if config is None:
            config = {}
        # 查找 nmap（空字符串也视为未设置，触发 shutil.which）
        if not nmap_path:
            self.nmap_path = shutil.which("nmap") or config.get('nmap_path', 'nmap')
        else:
            self.nmap_path = nmap_path
        # xray 路径
        if not xray_path:
            self.xray_path = (
                os.environ.get("XRAY_PATH")
                or shutil.which("xray")
                or config.get('xray_path', 'xray')
            )
        else:
            self.xray_path = xray_path
        # nuclei 路径
        if not nuclei_path:
            self.nuclei_path = (
                os.environ.get("NUCLEI_PATH")
                or shutil.which("nuclei")
                or config.get('nuclei_path', 'nuclei')
            )
        else:
            self.nuclei_path = nuclei_path
        # msf 路径
        if not msf_path:
            self.msf_path = (
                os.environ.get("MSF_PATH")
                or shutil.which("msfconsole")
                or config.get('msf_path', 'msfconsole')
            )
        else:
            self.msf_path = msf_path
        # 外部依赖注入
        self.config = config or {}
        self.memory_system = memory_system
        self.stats_panel = stats_panel or {"tool_usage_count": 0}
        if self.nmap_path == "nmap" and shutil.which("nmap") is None:
            logger.warning("nmap 未在系统路径中找到，请确保已安装")
        logger.info(f"安全检查器初始化，nmap路径: {self.nmap_path}")
        self.tool_manager = ToolManager()
        self.running_processes = {}
        self.process_lock = threading.Lock()
        self.model_engine = None
        self.vuln_graph = None
        self.native_tools = native_tools.NATIVE_TOOLS
        self._cancel_event = threading.Event()
        try:
            from .wordlist_manager import get_wordlist_manager
            from libertas.foundation.config import config as global_config
            wl_config = dict(config) if isinstance(config, dict) else {}
            if hasattr(global_config, '_config'):
                for k, v in global_config._config.items():
                    wl_config.setdefault(k, v)
            elif hasattr(global_config, 'get'):
                wl_config.setdefault("字典", global_config.get("字典", {}))
            self.wordlist_mgr = get_wordlist_manager(wl_config)
        except Exception:
            self.wordlist_mgr = None
        self._build_trie()

    def _build_trie(self):
        from libertas.tools.tool_assembler import Trie, build_system_trie
        self.trie = build_system_trie(self.tool_manager.assembler)

    def autocomplete(self, prefix: str, limit: int = 20) -> List[str]:
        return self.trie.autocomplete(prefix, limit)

    def cancel_scan(self):
        self._cancel_event.set()
        native_tools.cancel_all()

    def reset_cancel(self):
        self._cancel_event.clear()
        native_tools.reset_cancel()

    def is_cancelled(self) -> bool:
        return self._cancel_event.is_set()

    def list_native_tools(self) -> List[Dict]:
        return native_tools.list_native_tools()

    def run_native(self, tool_name: str, **kwargs) -> Dict[str, Any]:
        result = native_tools.run_native_tool(tool_name, **kwargs)
        if result.get("success") and self.memory_system:
            self._save_native_result(tool_name, result, kwargs)
        if result.get("success"):
            target = result.get("target", kwargs.get("target",
                         kwargs.get("url", kwargs.get("domain", ""))))
            self._feed_graph(tool_name, target, result, kwargs)
            self._notify_tool(tool_name, target, result, True)
        elif result.get("error"):
            target = kwargs.get("target", kwargs.get("url", kwargs.get("domain", "")))
            self._notify_tool(tool_name, target, result, False)
        return result

    def _notify_tool(self, tool_name, target, result, success):
        """工具执行完成后发送通知+告警检查+协作动态广播"""
        try:
            from libertas.observability.notifications import notify
            from libertas.observability.alert_system import get_alert_system
            elapsed = result.get("elapsed", 0)
            if success:
                # 告警检查
                try:
                    get_alert_system().check_tool_result(tool_name, target or "unknown", result)
                except Exception:
                    pass
                if elapsed >= 5:
                    summary = str(result.get("summary", result.get("data", "")))[:80]
                    notify(f"工具完成: {tool_name}", f"目标: {target or '未知'}\n{summary}",
                           level="info", category="tool")
            else:
                err = str(result.get("error", "未知错误"))[:80]
                notify(f"工具失败: {tool_name}", f"目标: {target or '未知'}\n{err}",
                       level="error", category="tool")
                try:
                    get_alert_system().trigger("tool_failed",
                                    f"工具 {tool_name} 在 {target} 失败: {err}",
                                    {"tool": tool_name, "target": target})
                except Exception:
                    pass
            # 广播到镜像舱协作动态
            try:
                self._broadcast_activity(tool_name, target, result, success)
            except Exception:
                pass
        except Exception:
            pass

    def _broadcast_activity(self, tool_name, target, result, success):
        """广播工具执行动态到WAN房间（镜像舱协作）"""
        try:
            import json as _json
            import urllib.request as _ur

            # 判断严重级别
            severity = "info"
            data_str = str(result.get("data", "")) + str(result.get("summary", ""))
            if any(kw in data_str.lower() for kw in ["critical", "cve-", "rce", "sql injection"]):
                severity = "critical"
            elif any(kw in data_str.lower() for kw in ["open", "21/", "22/", "3389", "password", "admin"]):
                severity = "warning"
            if not success:
                severity = "error"
            summary = str(result.get("summary", result.get("data", "")))[:120]
            payload = _json.dumps({
                "activity_type": "tool_result",
                "tool": tool_name,
                "target": target or "",
                "summary": summary if success else str(result.get("error", ""))[:120],
                "severity": severity,
            }, ensure_ascii=False).encode("utf-8")
            req = _ur.Request("http://127.0.0.1:5000/api/mirror/activity",
                              data=payload, headers={"Content-Type": "application/json"}, method="POST")
            _ur.urlopen(req, timeout=2).read()
        except Exception:
            pass

    def _save_native_result(self, tool_name: str, result: Dict, params: Dict):
        try:
            target = result.get("target", params.get("target", params.get("url", params.get("domain", "unknown"))))
            data = result.get("data", {})
            raw = result.get("raw_output", "")
            summary = self._summarize_native(tool_name, target, data)
            self.memory_system.record_scan_memory(
                target=target,
                scan_type=f"原生.{tool_name}",
                content=summary,
                raw_output=raw,
                extra={"native": True, "data": data}
            )
            self._inject_scan_context(tool_name, result, params)
        except Exception as e:
            logger.warning(f"保存原生工具结果到记忆失败: {e}")

    def _summarize_native(self, tool_name: str, target: str, data: Dict) -> str:
        if tool_name == "port_scan":
            ports = data.get("open_ports", [])
            if ports:
                plist = ", ".join(f"{p['port']}/{p['service']}" for p in ports[:10])
                return f"原生端口扫描 - 目标: {target}\n开放端口: {plist}"
            return f"原生端口扫描 - 目标: {target}\n未发现开放端口"
        if tool_name == "dns_lookup":
            records = data.get("records", [])
            return f"原生DNS查询 - {target}\n" + "\n".join(f"  {r['type']}: {r['value']}" for r in records)
        if tool_name == "whois":
            info = data.get("info", {})
            return f"原生WHOIS - {target}\n注册商: {info.get('registrar','未知')}\n到期: {info.get('expiration_date','未知')}"
        if tool_name == "http_fingerprint":
            return f"原生HTTP指纹 - {target}\n状态: {data.get('status_code')}\n标题: {data.get('title','')}\n技术栈: {', '.join(data.get('technologies',[]))}"
        if tool_name == "ssl_info":
            cert = data.get("certificate", {})
            return f"原生SSL信息 - {target}\n协议: {data.get('protocol')}\n颁发者: {cert.get('issuer',{})}\n到期: {cert.get('notAfter','')}"
        if tool_name == "ping":
            return f"原生Ping - {target}\n存活: {data.get('alive')}\n延迟: {data.get('avg_ms')}ms"
        if tool_name == "subdomain_enum":
            subs = data.get("subdomains", [])
            return f"原生子域名枚举 - {target}\n发现 {len(subs)} 个子域名"
        if tool_name == "traceroute":
            return f"原生路由追踪 - {target}\n{len(data.get('hops',[]))} 跳"
        if tool_name == "dir_bruteforce":
            paths = data.get("paths", [])
            return f"原生目录扫描 - {target}\n发现 {len(paths)} 个路径"
        return f"原生工具 {tool_name} - {target} 执行完成"

    def set_model_engine(self, model_engine):
        self.model_engine = model_engine

    def set_vuln_graph(self, vuln_graph):
        """注入漏洞知识图谱实例，工具执行后自动喂入结果。"""
        self.vuln_graph = vuln_graph

    def _feed_graph(self, tool_name, target, result, params=None):
        """将工具执行结果喂给知识图谱（失败不影响主流程）。"""
        if not self.vuln_graph or not result.get("success"):
            return
        try:
            self.vuln_graph.ingest_result(tool_name, target or "",
                                          result, params or {})
        except Exception as e:
            logger.debug(f"图谱摄入失败({tool_name}): {e}")
