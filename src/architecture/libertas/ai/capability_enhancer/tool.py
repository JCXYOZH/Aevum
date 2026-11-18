"""能力增强职责：tool。"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
import time
import uuid
from collections import OrderedDict, defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from libertas.foundation.byte_stream import safe_decode

from .models import EnhancedTool

class ToolEnhancer:
    """工具库增强器

    - 工具自动发现（扫描系统PATH和已知工具）
    - 依赖自动安装检测
    - 工具健康检查
    - 输出标准化
    - 工具调用统计与成功率
    """

    # 已知工具目录
    KNOWN_TOOLS = {
        "network": ["nmap", "masscan", "nc", "curl", "wget", "dig", "nslookup", "whois", "tcpdump", "wireshark"],
        "web": ["sqlmap", "nikto", "dirb", "gobuster", "ffuf", "wfuzz", "whatweb", "wappalyzer"],
        "exploit": ["metasploit", "msfconsole", "searchsploit", "hydra", "medusa", "john", "hashcat"],
        "recon": ["subfinder", "amass", "assetfinder", "httpx", "nuclei", "katana"],
        "system": ["python3", "pip", "git", "docker", "ssh", "scp", "rsync", "make", "gcc"],
        "crypto": ["openssl", "gpg", "steghide", "exiftool", "binwalk", "foremost"],
    }

    def __init__(self):
        self.tools: Dict[str, EnhancedTool] = {}

    def discover_tools(self) -> List[EnhancedTool]:
        """自动发现系统中已安装的工具"""
        discovered = []
        for category, tool_names in self.KNOWN_TOOLS.items():
            for name in tool_names:
                if self._is_tool_available(name):
                    tool = EnhancedTool(
                        name=name,
                        category=category,
                        installed=True,
                        health_status="healthy",
                        last_health_check=time.time(),
                    )
                    self.tools[name] = tool
                    discovered.append(tool)
        return discovered

    def _is_tool_available(self, name: str) -> bool:
        """检查工具是否可用"""
        import shutil
        return shutil.which(name) is not None

    def check_health(self, tool_name: str) -> EnhancedTool:
        """检查工具健康状态"""
        tool = self.tools.get(tool_name)
        if not tool:
            tool = EnhancedTool(name=tool_name, installed=self._is_tool_available(tool_name))
            self.tools[tool_name] = tool

        if not tool.installed:
            tool.health_status = "unhealthy"
            tool.last_health_check = time.time()
            return tool

        # 执行版本检查
        try:
            import subprocess
            result = subprocess.run(
                [tool_name, "--version"],
                capture_output=True, timeout=5
            )
            # 不请求 text=True：Windows 中文环境会按区域编码(cp936)解码，外部工具输出多为 UTF-8
            ver_out = safe_decode(result.stdout)
            if result.returncode == 0 or ver_out:
                tool.health_status = "healthy"
                tool.version = ver_out.strip().split("\n")[0][:50]
            else:
                tool.health_status = "unhealthy"
        except Exception:
            tool.health_status = "unknown"

        tool.last_health_check = time.time()
        return tool

    def check_all_health(self) -> Dict:
        """检查所有工具健康状态"""
        healthy = 0
        unhealthy = 0
        unknown = 0
        for name in list(self.tools.keys()):
            tool = self.check_health(name)
            if tool.health_status == "healthy":
                healthy += 1
            elif tool.health_status == "unhealthy":
                unhealthy += 1
            else:
                unknown += 1
        return {
            "total": len(self.tools),
            "healthy": healthy,
            "unhealthy": unhealthy,
            "unknown": unknown,
        }

    def get_missing_dependencies(self, tool_name: str) -> List[str]:
        """获取工具缺失的依赖"""
        tool = self.tools.get(tool_name)
        if not tool:
            return []
        missing = []
        for dep in tool.dependencies:
            if not self._is_tool_available(dep):
                missing.append(dep)
        return missing

    def standardize_output(self, raw_output: str, tool_name: str) -> Dict:
        """标准化工具输出"""
        return {
            "tool": tool_name,
            "raw_length": len(raw_output),
            "parsed": self._parse_output(raw_output, tool_name),
            "timestamp": time.time(),
        }

    def _parse_output(self, output: str, tool_name: str) -> Dict:
        """解析工具输出为结构化数据"""
        if tool_name == "nmap":
            return self._parse_nmap(output)
        elif tool_name == "sqlmap":
            return self._parse_sqlmap(output)
        elif tool_name == "curl":
            return self._parse_curl(output)
        else:
            return {"raw_preview": output[:500]}

    def _parse_nmap(self, output: str) -> Dict:
        ports = []
        for line in output.split("\n"):
            match = re.match(r"(\d+)/(\w+)\s+(\w+)\s+(.+)", line)
            if match:
                ports.append({
                    "port": int(match.group(1)),
                    "protocol": match.group(2),
                    "state": match.group(3),
                    "service": match.group(4),
                })
        return {"ports": ports, "port_count": len(ports)}

    def _parse_sqlmap(self, output: str) -> Dict:
        dbs = []
        for line in output.split("\n"):
            if "available databases" in line.lower():
                dbs.append(line.strip())
        return {"databases": dbs, "injectable": "parameter" in output.lower()}

    def _parse_curl(self, output: str) -> Dict:
        return {"response_preview": output[:500], "length": len(output)}

    def record_call(self, tool_name: str, success: bool, duration: float):
        """记录工具调用统计"""
        tool = self.tools.get(tool_name)
        if not tool:
            tool = EnhancedTool(name=tool_name)
            self.tools[tool_name] = tool
        tool.call_count += 1
        tool.avg_duration = (tool.avg_duration * (tool.call_count - 1) + duration) / tool.call_count
        if success:
            tool.success_rate = (tool.success_rate * (tool.call_count - 1) + 1) / tool.call_count
        else:
            tool.success_rate = (tool.success_rate * (tool.call_count - 1)) / tool.call_count

    def get_statistics(self) -> Dict:
        return {
            "total_tools": len(self.tools),
            "installed": sum(1 for t in self.tools.values() if t.installed),
            "healthy": sum(1 for t in self.tools.values() if t.health_status == "healthy"),
            "total_calls": sum(t.call_count for t in self.tools.values()),
            "avg_success_rate": round(
                sum(t.success_rate for t in self.tools.values()) / len(self.tools), 2
            ) if self.tools else 0,
        }
