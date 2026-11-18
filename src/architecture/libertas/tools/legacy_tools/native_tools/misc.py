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


def native_ip_info(target: str, timeout: float = 10) -> Dict[str, Any]:
    """查询IP地址的地理位置、ASN等信息（通过ip-api.com）"""
    # 如果是域名，先解析IP
    ip = target
    try:
        socket.inet_aton(target)
    except socket.error:
        try:
            ip = socket.gethostbyname(target)
        except Exception:
            pass
    try:
        url = f"http://ip-api.com/json/{ip}?fields=status,message,country,regionName,city,isp,org,as,query,lat,lon,timezone"
        req = urllib.request.Request(url, headers={"User-Agent": "MrHua Scanner"})
        resp = urllib.request.urlopen(req, timeout=timeout)
        data = json.loads(resp.read().decode("utf-8"))
        if data.get("status") != "success":
            return _result("ip_info", target, False, error=data.get("message", "查询失败"))
        raw = f"IP: {data.get('query')}\n国家: {data.get('country')}\n地区: {data.get('regionName')}\n"
        raw += f"城市: {data.get('city')}\nISP: {data.get('isp')}\n组织: {data.get('org')}\nAS: {data.get('as')}\n"
        raw += f"时区: {data.get('timezone')}\n坐标: {data.get('lat')},{data.get('lon')}"
        return _result("ip_info", target, True, data=data, raw=raw)
    except Exception as e:
        return _result("ip_info", target, False, error=str(e))

def native_subnet_calculator(cidr: str) -> Dict[str, Any]:
    """计算子网信息（网络地址、广播地址、可用主机数等）"""
    try:
        import ipaddress
        if "/" not in cidr:
            cidr += "/24"
        net = ipaddress.ip_network(cidr, strict=False)
        info = {
            "network": str(net.network_address),
            "broadcast": str(net.broadcast_address),
            "netmask": str(net.netmask),
            "prefix_length": net.prefixlen,
            "num_addresses": net.num_addresses,
            "hosts": max(0, net.num_addresses - 2),
            "version": net.version,
            "is_private": net.is_private,
            "first_host": str(net.network_address + 1) if net.num_addresses > 2 else str(net.network_address),
            "last_host": str(net.broadcast_address - 1) if net.num_addresses > 2 else str(net.broadcast_address),
        }
        raw = f"网络: {info['network']}/{info['prefix_length']}\n"
        raw += f"掩码: {info['netmask']}\n广播: {info['broadcast']}\n"
        raw += f"可用主机: {info['hosts']}\n范围: {info['first_host']} ~ {info['last_host']}\n"
        raw += f"私有网络: {'是' if info['is_private'] else '否'}"
        return _result("subnet_calculator", cidr, True, data=info, raw=raw)
    except Exception as e:
        return _result("subnet_calculator", cidr, False, error=str(e))

def native_email_harvester(url: str, timeout: float = 15, max_pages: int = 5) -> Dict[str, Any]:
    """从网页中采集邮箱地址"""
    if not url.startswith("http"):
        url = "http://" + url
    emails = set()
    visited = set()
    raw_lines = [f"目标: {url}"]
    try:
        from urllib.parse import urljoin, urlparse
        to_visit = [url]
        pages_done = 0
        while to_visit and pages_done < max_pages and not is_cancelled():
            current = to_visit.pop(0)
            if current in visited:
                continue
            visited.add(current)
            try:
                req = urllib.request.Request(current, headers={"User-Agent": "Mozilla/5.0 (MrHua Scanner)"})
                resp = urllib.request.urlopen(req, timeout=timeout)
                body = resp.read().decode("utf-8", errors="replace")
                found = re.findall(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", body)
                for e in found:
                    if not e.endswith((".png", ".jpg", ".gif", ".css", ".js")):
                        emails.add(e.lower())
                # 收集同域链接
                if pages_done < max_pages - 1:
                    domain = urlparse(url).netloc
                    links = re.findall(r'href=["\']([^"\']+)["\']', body, re.IGNORECASE)
                    for link in links:
                        abs_link = urljoin(current, link)
                        if urlparse(abs_link).netloc == domain and abs_link not in visited:
                            to_visit.append(abs_link)
                pages_done += 1
            except Exception:
                pages_done += 1
                continue
        raw_lines.append(f"扫描 {pages_done} 页，发现 {len(emails)} 个邮箱")
        for e in sorted(emails):
            raw_lines.append(f"  📧 {e}")
        return _result("email_harvester", url, True,
                       data={"url": url, "emails": sorted(emails), "pages_scanned": pages_done},
                       raw="\n".join(raw_lines))
    except Exception as e:
        return _result("email_harvester", url, False, error=str(e))
