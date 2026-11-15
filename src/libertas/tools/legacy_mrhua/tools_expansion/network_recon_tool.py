"""
tools/tools_expansion.py - 工具集综合扩展模块

新增高级工具：网络侦察工具集、密码学工具集、数据处理工具集、
系统管理工具集、文件分析工具集、文本处理工具集。
"""
import os
import json
import time
import uuid
import math
import hashlib
import hmac
import base64
import socket
import struct
import threading
import subprocess
import re
from typing import Any, Dict, List, Optional, Tuple
from libertas.foundation.byte_stream import safe_decode
from collections import deque, Counter
from enum import Enum
from libertas.foundation.terminal import terminal


# ================================================================
# 网络侦察工具集
# ================================================================


class NetworkReconTool:
    """网络侦察工具"""

    def __init__(self, timeout: float = 5.0):
        self.tool_id = f"nrt_{uuid.uuid4().hex[:8]}"
        self.timeout = timeout
        self.scan_results: deque = deque(maxlen=100)
        self._lock = threading.RLock()

    def dns_lookup(self, domain: str) -> Dict[str, Any]:
        """DNS 查找"""
        result = {"domain": domain, "records": [], "error": ""}
        try:
            ip = socket.gethostbyname(domain)
            result["records"].append({"type": "A", "value": ip})
            try:
                infos = socket.getaddrinfo(domain, None)
                for info in infos:
                    if info[0] == socket.AF_INET6:
                        result["records"].append({"type": "AAAA", "value": info[4][0]})
            except Exception:
                pass
        except socket.gaierror as e:
            result["error"] = str(e)
        return result

    def reverse_dns(self, ip: str) -> Dict[str, Any]:
        """反向 DNS 查找"""
        result = {"ip": ip, "hostname": "", "error": ""}
        try:
            hostname, _, _ = socket.gethostbyaddr(ip)
            result["hostname"] = hostname
        except Exception as e:
            result["error"] = str(e)
        return result

    def port_scan(self, host: str, ports: List[int],
                  timeout: float = 1.0) -> Dict[str, Any]:
        """端口扫描"""
        result = {"host": host, "open_ports": [], "closed_ports": [], "filtered": []}
        for port in ports:
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(timeout)
                conn = sock.connect_ex((host, port))
                if conn == 0:
                    result["open_ports"].append(port)
                else:
                    result["closed_ports"].append(port)
                sock.close()
            except socket.timeout:
                result["filtered"].append(port)
            except Exception as e:
                result["filtered"].append(port)
        return result

    def service_banner(self, host: str, port: int,
                        timeout: float = 3.0) -> Dict[str, Any]:
        """获取服务横幅"""
        result = {"host": host, "port": port, "banner": "", "error": ""}
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            sock.connect((host, port))
            # 发送常见探测
            try:
                sock.send(b"GET / HTTP/1.0\r\n\r\n")
            except Exception:
                pass
            try:
                data = sock.recv(1024)
                result["banner"] = data.decode("utf-8", errors="replace")[:500]
            except Exception:
                pass
            sock.close()
        except Exception as e:
            result["error"] = str(e)
        return result

    def whois_lookup(self, domain: str) -> Dict[str, Any]:
        """WHOIS 查找（简化版）"""
        result = {"domain": domain, "registrar": "", "created": "",
                  "expires": "", "nameservers": [], "error": ""}
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(self.timeout)
            sock.connect(("whois.iana.org", 43))
            sock.send((domain + "\r\n").encode())
            data = b""
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                data += chunk
            sock.close()
            text = data.decode("utf-8", errors="replace")
            # 简单解析
            for line in text.split("\n"):
                line = line.strip()
                if line.lower().startswith("registrar:"):
                    result["registrar"] = line.split(":", 1)[1].strip()
                elif line.lower().startswith("created:") or line.lower().startswith("creation date:"):
                    result["created"] = line.split(":", 1)[1].strip()
                elif line.lower().startswith("expires:") or line.lower().startswith("expiry date:"):
                    result["expires"] = line.split(":", 1)[1].strip()
                elif line.lower().startswith("nserver:") or line.lower().startswith("name server:"):
                    result["nameservers"].append(line.split(":", 1)[1].strip())
        except Exception as e:
            result["error"] = str(e)
        return result

    def ping(self, host: str, count: int = 4) -> Dict[str, Any]:
        """Ping 测试"""
        result = {"host": host, "packets_sent": count, "packets_received": 0,
                  "packet_loss": 100.0, "rtt_min": 0.0, "rtt_avg": 0.0,
                  "rtt_max": 0.0, "error": ""}
        try:
            cmd = ["ping", "-n", str(count), host] if os.name == "nt" else ["ping", "-c", str(count), host]
            proc = subprocess.run(cmd, capture_output=True, timeout=30)
            output = safe_decode(proc.stdout) + safe_decode(proc.stderr)
            # 解析结果
            if os.name == "nt":
                loss_match = re.search(r"(\d+)% 丢失", output)
                if loss_match:
                    result["packet_loss"] = float(loss_match.group(1))
            else:
                loss_match = re.search(r"(\d+)% packet loss", output)
                if loss_match:
                    result["packet_loss"] = float(loss_match.group(1))
            result["packets_received"] = int(count * (1 - result["packet_loss"] / 100))
        except Exception as e:
            result["error"] = str(e)
        return result

    def traceroute(self, host: str, max_hops: int = 30) -> Dict[str, Any]:
        """Traceroute"""
        result = {"host": host, "hops": [], "error": ""}
        try:
            cmd = ["tracert", "-d", "-h", str(max_hops), host] if os.name == "nt" else ["traceroute", "-n", "-m", str(max_hops), host]
            proc = subprocess.run(cmd, capture_output=True, timeout=60)
            for line in safe_decode(proc.stdout).split("\n"):
                hop_match = re.match(r"\s*(\d+)\s+(.+)", line)
                if hop_match:
                    result["hops"].append({
                        "hop": int(hop_match.group(1)),
                        "info": hop_match.group(2).strip(),
                    })
        except Exception as e:
            result["error"] = str(e)
        return result

    def get_stats(self) -> Dict[str, Any]:
        return {
            "tool_id": self.tool_id,
            "scan_count": len(self.scan_results),
            "timeout": self.timeout,
        }
