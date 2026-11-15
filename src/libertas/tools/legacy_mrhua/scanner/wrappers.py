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


class WrappersMixin:
    def execute_tool(self, tool_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
        native_map = {
            "native_port_scan": "port_scan",
            "native_dns": "dns_lookup",
            "native_whois": "whois",
            "native_http": "http_fingerprint",
            "native_ssl": "ssl_info",
            "native_ping": "ping",
            "native_subdomain": "subdomain_enum",
            "native_traceroute": "traceroute",
            "native_dirscan": "dir_bruteforce",
        }
        if tool_name in native_map:
            native_kwargs = self._map_params_to_native(native_map[tool_name], params)
            return self.run_native(native_map[tool_name], **native_kwargs)

        if tool_name in self.native_tools:
            return self.run_native(tool_name, **params)

        return self.run_tool(tool_name, params)

    def _map_params_to_native(self, native_name: str, params: Dict) -> Dict:
        mapping = {
            "port_scan": {"target": "target", "ports": "ports", "timeout": "timeout"},
            "dns_lookup": {"domain": "target", "record_type": "record_type"},
            "whois": {"domain": "target"},
            "http_fingerprint": {"url": "target"},
            "ssl_info": {"host": "target", "port": "port"},
            "ping": {"target": "target", "count": "count"},
            "subdomain_enum": {"domain": "target"},
            "traceroute": {"target": "target", "max_hops": "max_hops"},
            "dir_bruteforce": {"url": "target"},
        }
        m = mapping.get(native_name, {})
        kwargs = {}
        for nk, pk in m.items():
            if pk in params and params[pk] is not None:
                kwargs[nk] = params[pk]
        return kwargs

    def scan_ports(self, target: str, ports: str = "1-1024", use_native: bool = True) -> Dict[str, Any]:
        if use_native or not self._check_tool(self.nmap_path):
            return self.run_native("port_scan", target=target, ports=ports)
        return self.port_scan(target, port_range=ports)

    def dns_query(self, domain: str, record_type: str = "A") -> Dict[str, Any]:
        return self.run_native("dns_lookup", domain=domain, record_type=record_type)

    def whois_query(self, domain: str) -> Dict[str, Any]:
        return self.run_native("whois", domain=domain)

    def http_probe(self, url: str) -> Dict[str, Any]:
        return self.run_native("http_fingerprint", url=url)

    def ssl_probe(self, host: str, port: int = 443) -> Dict[str, Any]:
        return self.run_native("ssl_info", host=host, port=port)

    def ping_host(self, target: str, count: int = 4) -> Dict[str, Any]:
        return self.run_native("ping", target=target, count=count)

    def enumerate_subdomains(self, domain: str) -> Dict[str, Any]:
        return self.run_native("subdomain_enum", domain=domain)

    def trace_route(self, target: str, max_hops: int = 20) -> Dict[str, Any]:
        return self.run_native("traceroute", target=target, max_hops=max_hops)

    def brute_directories(self, url: str) -> Dict[str, Any]:
        return self.run_native("dir_bruteforce", url=url)

    def run_subfinder(self, target: str) -> Dict[str, Any]:
        return self.run_tool("subfinder", {"target": target})

    def run_ffuf(self, url: str, wordlist: str = "") -> Dict[str, Any]:
        params = {"url": url}
        if wordlist:
            params["wordlist"] = wordlist
        return self.run_tool("ffuf", params)

    def run_gobuster(self, url: str, wordlist: str = "") -> Dict[str, Any]:
        params = {"url": url}
        if wordlist:
            params["wordlist"] = wordlist
        return self.run_tool("gobuster", params)

    def run_nuclei(self, target: str) -> Dict[str, Any]:
        if self._check_tool(self.nuclei_path):
            return self.run_nuclei_scan(target)
        return self.run_native("http_fingerprint", url=target)

    def run_whatweb(self, target: str) -> Dict[str, Any]:
        if shutil.which("whatweb"):
            return self.run_tool("whatweb", {"target": target})
        return self.run_native("http_fingerprint", url=target)

    def run_wafw00f(self, target: str) -> Dict[str, Any]:
        return self.run_tool("wafw00f", {"target": target})

    def run_enum4linux(self, target: str) -> Dict[str, Any]:
        return self.run_tool("enum4linux", {"target": target})

    def run_smbmap(self, target: str) -> Dict[str, Any]:
        return self.run_tool("smbmap", {"target": target})

    def run_dig(self, target: str, record_type: str = "A") -> Dict[str, Any]:
        if shutil.which("dig"):
            return self.run_tool("dig", {"target": target, "record_type": record_type})
        return self.run_native("dns_lookup", domain=target, record_type=record_type)

    def run_nikto(self, target: str) -> Dict[str, Any]:
        return self.run_tool("nikto", {"target": target})

    def run_wpscan(self, target: str) -> Dict[str, Any]:
        return self.run_tool("wpscan", {"target": target})

    def run_searchsploit(self, query: str) -> Dict[str, Any]:
        return self.run_tool("searchsploit", {"query": query})

    def run_hashcat(self, hash_file: str, hash_type: str = "0", wordlist: str = "") -> Dict[str, Any]:
        params = {"hash_file": hash_file, "hash_type": hash_type}
        if wordlist:
            params["wordlist"] = wordlist
        return self.run_tool("hashcat", params)

    def run_john(self, hash_file: str, wordlist: str = "") -> Dict[str, Any]:
        params = {"hash_file": hash_file}
        if wordlist:
            params["wordlist"] = wordlist
        return self.run_tool("john", params)

    def run_tshark(self, pcap_file: str) -> Dict[str, Any]:
        return self.run_tool("tshark", {"pcap_file": pcap_file})

    def run_aircrack(self, bssid: str, wordlist: str, cap_file: str) -> Dict[str, Any]:
        return self.run_tool("aircrack-ng", {"bssid": bssid, "wordlist": wordlist, "cap_file": cap_file})

    def run_testssl(self, target: str, port: str = "443") -> Dict[str, Any]:
        return self.run_tool("testssl", {"target": target, "port": port})

    def run_sslyze(self, target: str, port: str = "443") -> Dict[str, Any]:
        return self.run_tool("sslyze", {"target": target, "port": port})

    def run_openssl(self, target: str, port: str = "443") -> Dict[str, Any]:
        if shutil.which("openssl"):
            return self.run_tool("openssl", {"target": target, "port": port})
        return self.run_native("ssl_info", host=target, port=int(port))

    def get_tool_help(self, tool_name: str) -> Dict[str, Any]:
        tool = self.tool_manager.get_tool(tool_name)
        if not tool:
            return {"success": False, "error": f"工具 {tool_name} 未注册"}
        # 兼容两种形态：旧版字典配置取 path；新版 ToolInstance 没有外部程序路径，
        # 只有元数据（此前无条件 tool.get(...) 会抛 AttributeError → 路由 500）。
        if isinstance(tool, dict):
            path = tool.get("path", tool_name)
        else:
            metadata = getattr(tool, "metadata", None)
            if metadata is None:
                return {"success": False,
                        "error": f"工具 {tool_name} 的配置格式无法识别"}
            return {"success": True, "tool": tool_name,
                    "help": (f"【{metadata.name}】{metadata.description}\n"
                             f"类别: {metadata.category}    风险: {metadata.risk_level}")}
        if not self._check_tool(path):
            return {"success": False, "error": f"工具 {tool_name} 未安装"}
        try:
            r = subprocess.run([path, "--help"], capture_output=True, timeout=10)
            output = decode_output(r.stdout) or decode_output(r.stderr)
            if not output:
                r = subprocess.run([path, "-h"], capture_output=True, timeout=10)
                output = decode_output(r.stdout) or decode_output(r.stderr)
            if not output:
                # 两种帮助开关都没吐出任何文本：此前仍回 success=True + help=""，
                # 属"失败被当成成功"的同族缺陷（调用方无法区分"该工具本来就没有
                # 帮助输出"与"帮助查询失败"）。注意 --help 的退出码不具语义
                # （不少工具非零退出仍打印帮助），所以判据是"有没有拿到帮助文本"。
                return {"success": False,
                        "error": (f"工具 {tool_name} 未返回帮助信息"
                                  f"（--help/-h 均无输出，退出码 {r.returncode}）"),
                        "error_kind": "no_help_output",
                        "returncode": r.returncode}
            return {"success": True, "tool": tool_name, "help": output[:5000]}
        except Exception as e:
            friendly, kind = describe_exception(e)
            return {"success": False, "error": friendly, "error_kind": kind}
