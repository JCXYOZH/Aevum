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


def native_subdomain_enum(domain: str, wordlist: List[str] = None,
                          timeout: float = 2.0, max_workers: int = 50,
                          overall_timeout: float = 60,
                          wordlist_name: str = "",
                          progress_cb: Callable = None) -> Dict[str, Any]:
    if re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$', domain):
        return _result("native_subdomain_enum", domain, False,
                       error="IP地址不支持子域名枚举（仅支持域名）")
    if wordlist is None and wordlist_name:
        try:
            from .wordlist_manager import get_wordlist_manager
            wl = get_wordlist_manager()
            wordlist = wl.get_wordlist(wordlist_name)
        except Exception:
            wordlist = None
    if wordlist is None:
        wordlist = COMMON_SUBDOMAINS

    if not wordlist:
        wordlist = COMMON_SUBDOMAINS

    found: List[Dict] = []
    start = time.time()
    completed = 0
    total = len(wordlist)

    def check_sub(sub: str) -> Optional[Dict]:
        if cancel_event.is_set():
            return None
        fqdn = f"{sub}.{domain}"
        try:
            ip = socket.gethostbyname(fqdn)
            return {"subdomain": fqdn, "ip": ip}
        except Exception:
            return None

    try:
        # 在线程池启动前设置一次全局超时，不在每个线程里重复设置（避免竞态）
        old_timeout = socket.getdefaulttimeout()
        socket.setdefaulttimeout(timeout)
        executor = ThreadPoolExecutor(max_workers=max_workers)
        futures = {executor.submit(check_sub, s): s for s in wordlist}
        try:
            for future in as_completed(futures, timeout=overall_timeout):
                completed += 1
                if progress_cb and completed % 100 == 0:
                    try:
                        progress_cb(completed, total)
                    except Exception:
                        pass
                r = future.result()
                if r:
                    found.append(r)
                if cancel_event.is_set():
                    break
        except FuturesTimeout:
            pass
        finally:
            for f in futures:
                f.cancel()
            executor.shutdown(wait=False, cancel_futures=True)
            socket.setdefaulttimeout(old_timeout)
    except Exception as e:
        return _result("native_subdomain_enum", domain, False, error=str(e))

    elapsed = time.time() - start
    found.sort(key=lambda x: x["subdomain"])
    cancelled = cancel_event.is_set()
    lines = [f"Subdomain enumeration for {domain}"]
    lines.append(f"Tested {completed}/{total} names in {elapsed:.2f}s{' (已中止)' if cancelled else ''}")
    lines.append(f"Found {len(found)} subdomains:")
    for f in found:
        lines.append(f"  {f['subdomain']:40} {f['ip']}")

    return _result("native_subdomain_enum", domain, True,
                   data={"domain": domain, "subdomains": found,
                         "tested": completed, "total": total,
                         "elapsed": round(elapsed, 2), "cancelled": cancelled},
                   raw="\n".join(lines))

def native_cert_transparency(domain: str, timeout: float = 15) -> Dict[str, Any]:
    """通过crt.sh查询证书透明度日志发现子域名"""
    try:
        url = f"https://crt.sh/?q=%.{domain}&output=json"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (MrHua Scanner)"})
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        resp = urllib.request.urlopen(req, timeout=timeout, context=ctx)
        data = json.loads(resp.read().decode("utf-8"))
        subdomains = set()
        for entry in data:
            name = entry.get("name_value", "")
            for n in name.split("\n"):
                n = n.strip().lower()
                if n and domain in n and "*" not in n:
                    subdomains.add(n)
        sub_list = sorted(subdomains)
        raw = f"通过CT日志发现 {len(sub_list)} 个子域名:\n"
        for s in sub_list:
            raw += f"  {s}\n"
        return _result("cert_transparency", domain, True,
                       data={"domain": domain, "subdomains": sub_list, "count": len(sub_list)},
                       raw=raw)
    except Exception as e:
        return _result("cert_transparency", domain, False, error=str(e))

def native_reverse_dns(ip: str) -> Dict[str, Any]:
    """反向DNS查询"""
    try:
        with _dns_socket_lock:
            old_to = socket.getdefaulttimeout()
            socket.setdefaulttimeout(10)
            try:
                hostname, aliases, ips = socket.gethostbyaddr(ip)
            finally:
                socket.setdefaulttimeout(old_to)
        raw = f"IP: {ip}\n主机名: {hostname}\n"
        if aliases:
            raw += f"别名: {', '.join(aliases)}\n"
        raw += f"关联IP: {', '.join(ips)}"
        return _result("reverse_dns", ip, True,
                       data={"ip": ip, "hostname": hostname, "aliases": aliases, "ips": ips},
                       raw=raw)
    except Exception as e:
        return _result("reverse_dns", ip, False, error=str(e))

def native_whois_ip(ip: str, timeout: float = 10) -> Dict[str, Any]:
    """通过WHOIS查询IP的ASN和网络信息"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect(("whois.arin.net", 43))
        sock.sendall((ip + "\r\n").encode())
        response = b""
        while True:
            try:
                data = sock.recv(4096)
                if not data:
                    break
                response += data
            except socket.timeout:
                break
        sock.close()
        text = response.decode("utf-8", errors="replace")
        info = {}
        for line in text.splitlines():
            if ":" in line and not line.startswith("%"):
                key, _, val = line.partition(":")
                key = key.strip().lower()
                val = val.strip()
                if key in ("netname", "orgname", "org-name", "country", "origin",
                           "asname", "netrange", "cidr", "descr"):
                    info[key] = val
        raw = f"IP WHOIS: {ip}\n"
        for k, v in info.items():
            raw += f"  {k}: {v}\n"
        return _result("whois_ip", ip, True, data={"ip": ip, "info": info}, raw=raw)
    except Exception as e:
        return _result("whois_ip", ip, False, error=str(e))

def native_dns_zonetransfer(domain: str, timeout: float = 10) -> Dict[str, Any]:
    """尝试DNS区域传送（AXFR）"""
    ns_records = []
    # 查询 NS 阶段失败的原因（此前被 `except Exception: pass` 静默吞掉）
    ns_lookup_error = ""
    ns_error_kind = "ns_lookup_failed"
    try:
        import struct as st
        def build_dns_query(name, qtype=2):
            tid = b"\x12\x34"
            header = tid + b"\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00"
            question = b""
            for label in name.split("."):
                question += bytes([len(label)]) + label.encode()
            question += b"\x00" + st.pack(">HH", qtype, 1)
            return header + question
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(timeout)
        sock.sendto(build_dns_query(domain, 2), ("8.8.8.8", 53))
        # 这里必须是 recvfrom：UDP 的 recv() 只返回 bytes，`data, _ =` 解包会
        # 直接抛 ValueError（此前被下面的 except 静默吞掉，于是 NS 永远查不到、
        # 工具永远回"[OK] 区域传送被拒绝"）。
        data, _ = sock.recvfrom(4096)
        sock.close()
        pos = 12
        while data[pos] != 0:
            pos += data[pos] + 1
        pos += 5
        ancount = st.unpack(">H", data[6:8])[0]
        for _ in range(ancount):
            if pos + 12 > len(data):
                break
            pos += 2
            rtype = st.unpack(">H", data[pos:pos+2])[0]
            rdlen = st.unpack(">H", data[pos+8:pos+10])[0]
            pos += 10
            if rtype == 2 and pos + rdlen <= len(data):
                rdata = data[pos:pos+rdlen]
                ns_name = ""
                p = 0
                while p < len(rdata):
                    l = rdata[p]
                    if l == 0:
                        break
                    # 无参 .decode() 固定按 UTF-8 解：NS 名含非 UTF-8 字节时会抛
                    # UnicodeDecodeError。统一走级联解码（永不抛），避免"查不到 NS"
                    # 被静默吞掉（用户看到的是"回 OK 区域传送被拒绝"这种假阴性）。
                    ns_name += decode_output(rdata[p+1:p+1+l]) + "."
                    p += l + 1
                ns_records.append(ns_name.rstrip("."))
            pos += rdlen
    except Exception as e:
        # 此前是 `except Exception: pass`：查询/解析 NS 失败被完全吞掉，
        # 用户只能看到"[OK] 区域传送被拒绝"，把"没查到"误当成"不存在漏洞"。
        _friendly, ns_error_kind, _detail = _error_kind_and_text(str(e), e)
        ns_lookup_error = _friendly or str(e)

    axfr_results = []
    axfr_errors = []
    for ns in ns_records[:3]:
        try:
            import struct as st
            tid = b"\xab\xcd"
            header = tid + b"\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00"
            question = b""
            for label in domain.split("."):
                question += bytes([len(label)]) + label.encode()
            question += b"\x00" + st.pack(">HH", 252, 1)
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            sock.connect((ns, 53))
            msg = header + question
            sock.sendall(st.pack(">H", len(msg)) + msg)
            time.sleep(2)
            resp = sock.recv(65535)
            sock.close()
            if len(resp) > 5:
                axfr_results.append({"ns": ns, "records": len(resp), "vulnerable": True})
        except Exception as e:
            # 逐台 NS 记录失败原因（此前直接 continue，失败无痕）
            axfr_errors.append({"ns": ns, "error": humanize_error_text(str(e), e)})
            continue
    vulnerable = len(axfr_results) > 0
    raw = f"DNS区域传送检测: {domain}\n  NS服务器: {', '.join(ns_records) or '未获取'}\n"
    if ns_lookup_error:
        raw += f"  [!!] 查询 NS 记录时部分失败: {ns_lookup_error}\n"
    if vulnerable:
        raw += "  [!!] 存在区域传送漏洞!\n"
        for r in axfr_results:
            raw += f"    {r['ns']}: 返回 {r['records']} 字节\n"
    else:
        raw += "  [OK] 区域传送被拒绝\n"
        for item in axfr_errors:
            raw += f"    {item['ns']}: 尝试失败 - {item['error']}\n"
    # 连 NS 都查不到（网络不通 / 响应畸形 / 解析失败）时不能报成功：
    # 那会让"扫描失败"看起来像"目标不存在区域传送漏洞"。
    if ns_lookup_error and not ns_records:
        raw = (f"DNS区域传送检测: {domain}\n"
               f"  [!!] 查询 NS 记录失败: {ns_lookup_error}\n"
               f"  （未执行 AXFR：没有可用的 NS 服务器）\n")
        return _result("dns_zonetransfer", domain, False,
                       data={"domain": domain, "ns_servers": [], "vulnerable": False,
                             "axfr_results": [], "axfr_errors": [],
                             "error_kind": ns_error_kind,
                             "error_detail": ns_lookup_error},
                       raw=raw,
                       error=f"查询 NS 记录失败：{ns_lookup_error}")
    return _result("dns_zonetransfer", domain, True,
                   data={"domain": domain, "ns_servers": ns_records,
                         "vulnerable": vulnerable, "axfr_results": axfr_results,
                         "axfr_errors": axfr_errors}, raw=raw)

def native_dns_dumpster(domain: str, timeout: float = 15) -> Dict[str, Any]:
    """聚合查询DNS记录（A/AAAA/MX/TXT/NS/子域名）"""
    result = {"domain": domain, "A": [], "AAAA": [], "MX": [], "TXT": [], "NS": [], "subdomains": []}
    
    # A记录
    try:
        infos = socket.getaddrinfo(domain, None, socket.AF_INET, socket.SOCK_STREAM)
        seen = set()
        for info in infos:
            ip = info[4][0]
            if ip not in seen:
                seen.add(ip)
                result["A"].append(ip)
    except Exception:
        pass
    
    # AAAA记录
    try:
        infos = socket.getaddrinfo(domain, None, socket.AF_INET6, socket.SOCK_STREAM)
        seen = set()
        for info in infos:
            ip = info[4][0]
            if ip not in seen:
                seen.add(ip)
                result["AAAA"].append(ip)
    except Exception:
        pass
    
    # MX记录（通过nslookup）
    try:
        r = subprocess.run(["nslookup", "-type=mx", domain],
                          capture_output=True, timeout=8)
        for line in decode_output(r.stdout).split("\n"):
            if "mail exchanger" in line.lower() or "MX preference" in line:
                parts = line.split()
                if parts:
                    result["MX"].append(parts[-1].rstrip("."))
    except Exception:
        pass
    
    # TXT记录
    try:
        r = subprocess.run(["nslookup", "-type=txt", domain],
                          capture_output=True, timeout=8)
        txt_lines = []
        for line in decode_output(r.stdout).split("\n"):
            if '"' in line and "text" in line.lower():
                match = re.search(r'"([^"]*)"', line)
                if match:
                    txt_lines.append(match.group(1))
        result["TXT"] = txt_lines
    except Exception:
        pass
    
    # NS记录
    try:
        r = subprocess.run(["nslookup", "-type=ns", domain],
                          capture_output=True, timeout=8)
        for line in decode_output(r.stdout).split("\n"):
            if "nameserver" in line.lower():
                parts = line.split("=")
                if len(parts) > 1:
                    result["NS"].append(parts[1].strip().rstrip("."))
    except Exception:
        pass
    
    # 子域名枚举（通过crt.sh证书透明度）
    try:
        crt_url = f"https://crt.sh/?q=%25.{domain}&output=json"
        req = urllib.request.Request(crt_url, headers={"User-Agent": "Mozilla/5.0"})
        resp = urllib.request.urlopen(req, timeout=timeout)
        certs = json.loads(resp.read().decode("utf-8"))
        subdomains = set()
        for cert in certs:
            name = cert.get("name_value", "")
            for n in name.split("\n"):
                n = n.strip().lower()
                if n.endswith(domain) and n != domain and not n.startswith("*"):
                    subdomains.add(n)
        result["subdomains"] = sorted(subdomains)
    except Exception:
        pass
    
    # TXT记录分析
    txt_analysis = []
    for txt in result["TXT"]:
        if "v=spf1" in txt:
            txt_analysis.append("SPF记录（发件人策略框架）")
        if "google-site-verification" in txt:
            txt_analysis.append("Google站点验证")
        if "include:" in txt:
            txt_analysis.append("包含第三方邮件服务")
        if "_domainkey" in txt:
            txt_analysis.append("DKIM记录")
    
    raw = f"DNS聚合查询: {domain}\n\n"
    raw += f"【A记录】({len(result['A'])})\n"
    for ip in result["A"]:
        raw += f"  {ip}\n"
    if result["AAAA"]:
        raw += f"\n【AAAA记录】({len(result['AAAA'])})\n"
        for ip in result["AAAA"]:
            raw += f"  {ip}\n"
    raw += f"\n【MX记录】({len(result['MX'])})\n"
    for mx in result["MX"]:
        raw += f"  {mx}\n"
    raw += f"\n【NS记录】({len(result['NS'])})\n"
    for ns in result["NS"]:
        raw += f"  {ns}\n"
    raw += f"\n【TXT记录】({len(result['TXT'])})\n"
    for txt in result["TXT"]:
        raw += f"  {txt[:100]}\n"
    if txt_analysis:
        raw += f"\n【TXT分析】\n"
        for a in txt_analysis:
            raw += f"  - {a}\n"
    raw += f"\n【子域名】({len(result['subdomains'])})\n"
    for sub in result["subdomains"][:30]:
        raw += f"  {sub}\n"
    if len(result["subdomains"]) > 30:
        raw += f"  ... 共{len(result['subdomains'])}个\n"
    
    return _result("dns_dumpster", domain, True, data=result, raw=raw)
