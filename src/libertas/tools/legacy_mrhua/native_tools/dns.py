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


def _dig_query(domain: str, record_type: str, timeout: int = 5) -> List[str]:
    """用 dig 命令查询 DNS 记录，返回原始行列表（线程安全，不依赖全局 socket 状态）"""
    try:
        import subprocess
        r = subprocess.run(
            ["dig", "+short", "+time=3", "+tries=1", record_type, domain],
            capture_output=True, timeout=timeout
        )
        # 字节模式 + 级联解码：Windows 中文环境下 text=True 会按 cp936 解码
        # UTF-8 输出并抛 UnicodeDecodeError，被下面的 except 吞成"无 DNS 记录"。
        return [line.strip() for line in decode_output(r.stdout).splitlines() if line.strip()]
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        # 只吞"预期内"的失败；其它异常向上抛，避免解码/内部错误被伪装成"没有记录"
        return []

def _nslookup_query(domain: str, record_type: str, timeout: int = 10) -> List[str]:
    """Windows 下用 nslookup 查询"""
    try:
        import subprocess
        r = subprocess.run(
            ["nslookup", f"-type={record_type}", domain],
            capture_output=True, timeout=timeout
        )
        # 字节模式 + 级联解码（nslookup 在 Windows 中文环境输出 cp936）
        return [line.strip() for line in decode_output(r.stdout).splitlines() if line.strip()]
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        # 只吞"预期内"的失败；其它异常向上抛，避免被伪装成"没有记录"
        return []

def native_dns_lookup(domain: str, record_type: str = "ALL", **_extra) -> Dict[str, Any]:
    """DNS查询（增强版：A/AAAA/CNAME/MX/NS/TXT/SOA/SRV/PTR/ALL）"""
    try:
        rt = str(_extra.get("type") or _extra.get("rtype") or _extra.get("qtype") or record_type or "A").upper()
        records: List[Dict] = []
        os_name = platform.system().lower()
        use_dig = os_name != "windows" and shutil.which("dig")

        # ALL: 并行查询 A/AAAA/CNAME/MX/NS/TXT/SOA，一次返回所有常用记录
        if rt in ("ALL", "ANY", "*"):
            from concurrent.futures import ThreadPoolExecutor, as_completed
            types_to_query = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA"]
            def _query_one(rtype):
                return rtype, _dig_query(domain, rtype) if use_dig else _nslookup_query(domain, rtype)
            with ThreadPoolExecutor(max_workers=7) as pool:
                futures = {pool.submit(_query_one, rtype): rtype for rtype in types_to_query}
                for future in as_completed(futures, timeout=10):
                    try:
                        rtype, lines_out = future.result(timeout=8)
                        for line in lines_out:
                            if rtype == "A" and re.match(r"^\d+\.\d+\.\d+\.\d+$", line):
                                records.append({"type": "A", "value": line})
                            elif rtype == "AAAA" and ":" in line and not line.startswith(";;"):
                                records.append({"type": "AAAA", "value": line.rstrip(".")})
                            elif rtype == "CNAME" and line and not line.startswith(";;"):
                                records.append({"type": "CNAME", "value": line.rstrip(".")})
                            elif rtype == "MX" and len(line.split()) >= 2:
                                parts = line.split()
                                records.append({"type": "MX", "value": parts[-1].rstrip("."), "priority": parts[0]})
                            elif rtype == "NS" and line and not line.startswith(";;"):
                                records.append({"type": "NS", "value": line.rstrip(".")})
                            elif rtype == "TXT" and line and not line.startswith(";;"):
                                records.append({"type": "TXT", "value": line.strip('"')})
                            elif rtype == "SOA" and line and not line.startswith(";;"):
                                records.append({"type": "SOA", "value": line})
                    except Exception:
                        pass
            # 统计各类型数量
            type_counts = {}
            for r in records:
                type_counts[r["type"]] = type_counts.get(r["type"], 0) + 1
            lines_out = [f"DNS lookup for {domain} (ALL)"]
            lines_out.append(f"记录统计: {', '.join(f'{k}:{v}' for k, v in sorted(type_counts.items()))}")
            for r in records:
                extra = f" (优先级:{r['priority']})" if r["type"] == "MX" else ""
                lines_out.append(f"  {r['type']:6} {r['value']}{extra}")
            return _result("native_dns_lookup", domain, bool(records),
                           data={"records": records, "domain": domain, "record_type": "ALL",
                                 "type_counts": type_counts},
                           raw="\n".join(lines_out))

        if rt in ("A", "AAAA"):
            if use_dig:
                lines_out = _dig_query(domain, rt)
                for line in lines_out:
                    if rt == "AAAA" and ":" in line and not line.startswith(";;"):
                        records.append({"type": "AAAA", "value": line.rstrip(".")})
                    elif rt == "A" and re.match(r"^\d+\.\d+\.\d+\.\d+$", line):
                        records.append({"type": "A", "value": line})
            else:
                with _dns_socket_lock:
                    old_timeout = socket.getdefaulttimeout()
                    socket.setdefaulttimeout(10)
                    try:
                        infos = socket.getaddrinfo(domain, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
                    finally:
                        socket.setdefaulttimeout(old_timeout)
                seen = set()
                for info in infos:
                    ip = info[4][0]
                    if ip not in seen:
                        seen.add(ip)
                        records.append({"type": "AAAA" if ":" in ip else "A", "value": ip})
        elif rt == "CNAME":
            if use_dig:
                for line in _dig_query(domain, "CNAME"):
                    if line and not line.startswith(";;"):
                        records.append({"type": "CNAME", "value": line.rstrip(".")})
            elif os_name == "windows":
                for line in _nslookup_query(domain, "CNAME"):
                    if "canonical name" in line.lower() or "alias" in line.lower():
                        parts = line.split()
                        if parts:
                            records.append({"type": "CNAME", "value": parts[-1].rstrip(".")})
        elif rt == "MX":
            if use_dig:
                for line in _dig_query(domain, "MX"):
                    parts = line.split()
                    if len(parts) >= 2:
                        records.append({"type": "MX", "value": parts[-1].rstrip("."), "priority": parts[0]})
            elif os_name == "windows":
                for line in _nslookup_query(domain, "MX"):
                    if "mail exchanger" in line.lower():
                        parts = line.split()
                        if len(parts) >= 2:
                            records.append({"type": "MX", "value": parts[-1].rstrip("."), "priority": parts[0]})
        elif rt == "NS":
            if use_dig:
                for line in _dig_query(domain, "NS"):
                    if line and not line.startswith(";;"):
                        records.append({"type": "NS", "value": line.rstrip(".")})
            elif os_name == "windows":
                for line in _nslookup_query(domain, "NS"):
                    if "nameserver" in line.lower() or "name server" in line.lower():
                        parts = line.split()
                        if parts:
                            records.append({"type": "NS", "value": parts[-1].rstrip(".")})
        elif rt == "TXT":
            if use_dig:
                for line in _dig_query(domain, "TXT"):
                    if line and not line.startswith(";;"):
                        records.append({"type": "TXT", "value": line.strip('"')})
            elif os_name == "windows":
                for line in _nslookup_query(domain, "TXT"):
                    if line and not line.startswith(";;"):
                        records.append({"type": "TXT", "value": line.strip('"')})
        elif rt == "SOA":
            if use_dig:
                for line in _dig_query(domain, "SOA"):
                    if line and not line.startswith(";;"):
                        records.append({"type": "SOA", "value": line})
            elif os_name == "windows":
                for line in _nslookup_query(domain, "SOA"):
                    if "primary name server" in line.lower() or "responsible mail addr" in line.lower():
                        records.append({"type": "SOA", "value": line.strip()})
        elif rt == "SRV":
            if use_dig:
                for line in _dig_query(domain, "SRV"):
                    parts = line.split()
                    if len(parts) >= 4:
                        records.append({"type": "SRV", "value": parts[-1].rstrip("."),
                                        "priority": parts[0], "weight": parts[1], "port": parts[2]})
            elif os_name == "windows":
                for line in _nslookup_query(domain, "SRV"):
                    if "svr hostname" in line.lower() or "priority" in line.lower():
                        records.append({"type": "SRV", "value": line.strip()})
        elif rt == "PTR":
            # 反向DNS查询
            try:
                with _dns_socket_lock:
                    old_to = socket.getdefaulttimeout()
                    socket.setdefaulttimeout(10)
                    try:
                        hostname, aliases, ips = socket.gethostbyaddr(domain)
                    finally:
                        socket.setdefaulttimeout(old_to)
                records.append({"type": "PTR", "value": hostname})
                for alias in aliases:
                    records.append({"type": "PTR", "value": alias})
            except Exception as e:
                return _result("native_dns_lookup", domain, False, error=f"PTR查询失败: {e}")
        else:
            with _dns_socket_lock:
                old_timeout = socket.getdefaulttimeout()
                socket.setdefaulttimeout(10)
                try:
                    infos = socket.getaddrinfo(domain, None)
                finally:
                    socket.setdefaulttimeout(old_timeout)
            seen = set()
            for info in infos:
                ip = info[4][0]
                if ip not in seen:
                    seen.add(ip)
                    records.append({"type": "A", "value": ip})

        lines_out = [f"DNS lookup for {domain} ({rt})"]
        for r in records:
            extra = ""
            if r["type"] == "MX":
                extra = f" (优先级:{r.get('priority', '?')})"
            elif r["type"] == "SRV":
                extra = f" (优先级:{r.get('priority','?')} 权重:{r.get('weight','?')} 端口:{r.get('port','?')})"
            lines_out.append(f"  {r['type']:6} {r['value']}{extra}")
        return _result("native_dns_lookup", domain, bool(records),
                       data={"records": records, "domain": domain, "record_type": rt},
                       raw="\n".join(lines_out))
    except socket.gaierror as e:
        return _result("native_dns_lookup", domain, False, error=f"DNS解析失败: {e}")
    except Exception as e:
        return _result("native_dns_lookup", domain, False, error=str(e))

def native_whois(domain: str) -> Dict[str, Any]:
    """WHOIS域名信息查询（增强版：注册人/管理员/技术联系人/DNSSEC/域名年龄/状态码）"""
    if re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$', domain):
        return _result("native_whois", domain, False,
                       error="IP地址不支持WHOIS查询（仅支持域名）")

    whois_server = None
    for suffix, server in WHOIS_SERVERS.items():
        if domain.endswith(suffix):
            whois_server = server
            break
    if not whois_server:
        whois_server = "whois.iana.org"

    def _query_whois(server, query_domain):
        """查询WHOIS服务器，返回原始文本"""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(10)
            sock.connect((server, 43))
            sock.sendall((query_domain + "\r\n").encode())
            response = b""
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                response += chunk
            sock.close()
            return response.decode("utf-8", errors="replace")
        except Exception:
            return ""

    try:
        text = _query_whois(whois_server, domain)

        # 检查WHOIS重定向（Refer字段）
        refer_match = re.search(r"Refer:\s*(.+)", text, re.IGNORECASE)
        if refer_match and whois_server != "whois.iana.org":
            refer_server = refer_match.group(1).strip()
            # 从URL中提取主机名
            if "://" in refer_server:
                refer_server = refer_server.split("://")[1].split("/")[0]
            text2 = _query_whois(refer_server, domain)
            if text2 and len(text2) > len(text):
                text = text2
                whois_server = refer_server

        info = {}
        # 基础字段
        patterns = {
            "registrar": r"Registrar:\s*(.+)",
            "registrar_url": r"Registrar URL:\s*(.+)",
            "registrar_iana_id": r"Registrar IANA ID:\s*(.+)",
            "creation_date": r"Creation Date:\s*(.+)",
            "expiration_date": r"Expir\w+ Date:\s*(.+)",
            "updated_date": r"Updated Date:\s*(.+)",
            "name_servers": r"Name Server:\s*(.+)",
            "status": r"Domain Status:\s*(.+)",
            "dnssec": r"DNSSEC:\s*(.+)",
        }
        for key, pattern in patterns.items():
            matches = re.findall(pattern, text, re.IGNORECASE)
            if matches:
                if key == "name_servers":
                    info[key] = list(set(m.strip().lower() for m in matches))
                elif key == "status":
                    info[key] = [m.strip() for m in matches]
                else:
                    info[key] = matches[0].strip()

        # 注册人信息
        registrant = {}
        reg_patterns = {
            "name": r"Registrant Name:\s*(.+)",
            "organization": r"Registrant Organization:\s*(.+)",
            "email": r"Registrant Email:\s*(.+)",
            "phone": r"Registrant Phone:\s*(.+)",
            "country": r"Registrant Country:\s*(.+)",
            "state": r"Registrant State/Province:\s*(.+)",
            "city": r"Registrant City:\s*(.+)",
            "address": r"Registrant Street:\s*(.+)",
            "postal_code": r"Registrant Postal Code:\s*(.+)",
        }
        for key, pattern in reg_patterns.items():
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                registrant[key] = match.group(1).strip()
        if registrant:
            info["registrant"] = registrant

        # 管理员信息
        admin = {}
        admin_patterns = {
            "name": r"Admin Name:\s*(.+)",
            "organization": r"Admin Organization:\s*(.+)",
            "email": r"Admin Email:\s*(.+)",
            "phone": r"Admin Phone:\s*(.+)",
            "country": r"Admin Country:\s*(.+)",
        }
        for key, pattern in admin_patterns.items():
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                admin[key] = match.group(1).strip()
        if admin:
            info["admin"] = admin

        # 技术联系人信息
        tech = {}
        tech_patterns = {
            "name": r"Tech Name:\s*(.+)",
            "organization": r"Tech Organization:\s*(.+)",
            "email": r"Tech Email:\s*(.+)",
            "phone": r"Tech Phone:\s*(.+)",
            "country": r"Tech Country:\s*(.+)",
        }
        for key, pattern in tech_patterns.items():
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                tech[key] = match.group(1).strip()
        if tech:
            info["tech"] = tech

        # 域名年龄计算
        try:
            from datetime import datetime as dt
            if info.get("creation_date"):
                creation_str = info["creation_date"].split("T")[0].replace("Z", "")
                creation_date = dt.strptime(creation_str, "%Y-%m-%d")
                now = dt.utcnow()
                age_days = (now - creation_date).days
                info["domain_age_days"] = age_days
                info["domain_age_years"] = round(age_days / 365.25, 1)
        except Exception:
            pass

        # 域名状态分析
        status_list = info.get("status", [])
        status_analysis = []
        for s in status_list:
            if "clientTransferProhibited" in s:
                status_analysis.append("注册商锁定（禁止转移）")
            elif "serverTransferProhibited" in s:
                status_analysis.append("注册局锁定（禁止转移）")
            elif "clientDeleteProhibited" in s:
                status_analysis.append("禁止删除")
            elif "clientUpdateProhibited" in s:
                status_analysis.append("禁止修改")
            elif "ok" in s.lower():
                status_analysis.append("正常状态")
            elif "pending" in s.lower():
                status_analysis.append("待处理状态")
            elif "redemption" in s.lower():
                status_analysis.append("赎回期（域名已过期）")
        if status_analysis:
            info["status_analysis"] = status_analysis

        # DNSSEC分析
        if info.get("dnssec"):
            dnssec_val = info["dnssec"].lower()
            if "signed" in dnssec_val or "yes" in dnssec_val:
                info["dnssec_enabled"] = True
            else:
                info["dnssec_enabled"] = False

        # 生成可读输出
        lines_out = [f"WHOIS for {domain} (服务器: {whois_server})"]
        if info.get("registrar"):
            lines_out.append(f"注册商: {info['registrar']}")
        if info.get("creation_date"):
            lines_out.append(f"创建日期: {info['creation_date']}")
        if info.get("expiration_date"):
            lines_out.append(f"过期日期: {info['expiration_date']}")
        if info.get("domain_age_years"):
            lines_out.append(f"域名年龄: {info['domain_age_years']}年 ({info.get('domain_age_days', '?')}天)")
        if info.get("name_servers"):
            lines_out.append(f"DNS服务器: {', '.join(info['name_servers'])}")
        if info.get("status_analysis"):
            lines_out.append(f"状态: {', '.join(info['status_analysis'])}")
        if info.get("dnssec_enabled") is not None:
            lines_out.append(f"DNSSEC: {'已启用' if info['dnssec_enabled'] else '未启用'}")
        if info.get("registrant"):
            reg = info["registrant"]
            lines_out.append(f"注册人: {reg.get('name', '?')} ({reg.get('organization', '?')})")
            if reg.get("email"):
                lines_out.append(f"  邮箱: {reg['email']}")
            if reg.get("country"):
                lines_out.append(f"  国家: {reg['country']}")

        return _result("native_whois", domain, True,
                       data={"domain": domain, "whois_server": whois_server, "info": info},
                       raw="\n".join(lines_out) + "\n\n--- 原始数据 --\n" + text[:3000])
    except Exception as e:
        return _result("native_whois", domain, False, error=str(e))
