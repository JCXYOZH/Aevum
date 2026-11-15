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


def native_udp_scan(target: str, ports: str = "53,67,68,69,123,161,162,500,514,520,1900,4500,5353",
                    timeout: float = 3, max_workers: int = 20, overall_timeout: int = 60) -> Dict[str, Any]:
    """UDP端口扫描（发送空UDP包检测ICMP不可达）"""
    port_list = _parse_ports(ports)
    open_ports = []
    filtered = []
    start = time.time()
    lock = threading.Lock()

    def check_udp(port):
        if is_cancelled() or time.time() - start > overall_timeout:
            return
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(timeout)
            sock.sendto(b"\x00", (target, port))
            try:
                data, _ = sock.recvfrom(1024)
                with lock:
                    open_ports.append({"port": port, "response": data[:50].hex()})
            except socket.timeout:
                with lock:
                    filtered.append(port)
            except ConnectionRefusedError:
                pass
            sock.close()
        except Exception:
            pass

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(check_udp, p) for p in port_list]
        for f in as_completed(futures, timeout=overall_timeout + 5):
            try:
                f.result()
            except Exception:
                pass
    elapsed = time.time() - start
    raw = f"UDP扫描 {target} ({len(port_list)}端口, {round(elapsed,1)}s)\n"
    raw += f"  开放: {len(open_ports)} | 过滤: {len(filtered)}\n"
    for p in open_ports:
        raw += f"  🟢 {p['port']}/udp open\n"
    return _result("udp_scan", target, True,
                   data={"target": target, "open": open_ports, "filtered_count": len(filtered),
                         "elapsed": round(elapsed, 2)}, raw=raw)

def native_ssh_audit(host: str, port: int = 22, timeout: float = 8) -> Dict[str, Any]:
    """SSH服务版本和安全配置检测"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, int(port)))
        banner = sock.recv(256).decode("utf-8", errors="replace").strip()
        sock.close()
        issues = []
        parts = banner.split("-")
        if len(parts) >= 3:
            ssh_proto = parts[0]
            software = parts[1]
            version = parts[2].split(" ")[0] if len(parts) > 2 else ""
            if "SSH-1" in ssh_proto:
                issues.append("支持SSHv1协议（不安全）")
            if "OpenSSH" in software:
                ver_parts = version.replace("p", ".").split(".")
                try:
                    major = int(ver_parts[0])
                    minor = int(ver_parts[1]) if len(ver_parts) > 1 else 0
                    if major < 7 or (major == 7 and minor < 2):
                        issues.append(f"OpenSSH {version} 版本过旧")
                except Exception:
                    pass
        raw = f"SSH Banner: {banner}\n"
        for i in issues:
            raw += f"  [!!] {i}\n"
        if not issues:
            raw += "  [OK] 未发现明显问题\n"
        return _result("ssh_audit", f"{host}:{port}", True,
                       data={"host": host, "port": port, "banner": banner, "issues": issues}, raw=raw)
    except Exception as e:
        return _result("ssh_audit", f"{host}:{port}", False, error=str(e))

def native_smb_enum(host: str, port: int = 445, timeout: float = 8) -> Dict[str, Any]:
    """SMB/NetBIOS信息枚举"""
    nb_info = {}
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(timeout)
        trans_id = b"\x80\xf0"
        header = trans_id + b"\x00\x10\x00\x01\x00\x00\x00\x00\x00\x00"
        question = b"\x20CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\x00\x00\x21\x00\x01"
        sock.sendto(header + question, (host, 137))
        data, _ = sock.recv(4096)
        sock.close()
        if len(data) > 57:
            names = []
            pos = 57
            while pos + 18 <= len(data):
                name = data[pos:pos+15].decode("ascii", errors="replace").strip()
                if name:
                    names.append(name)
                pos += 18
            nb_info["netbios_names"] = names
    except Exception:
        pass
    smb_info = {}
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, int(port)))
        smb_neg = b"\x00\x00\x00\x2f" + b"\xff\x53\x4d\x42\x72" + b"\x00\x00\x00\x00" + \
                  b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00" + \
                  b"\x00\x00\x00\x00\x00\x00\x00\x00" + b"\x00\x00" + b"\x00\x00" + \
                  b"\x00\x00\x00\x00" + b"\x00\x00" + b"\x00\x00" + b"\x00\x00" + \
                  b"\x00\x00\x00\x00" + b"\x02\x50\x43\x20\x4e\x45\x54\x57\x4f\x52\x4b\x20\x50\x52\x4f\x47\x52\x41\x4d\x20\x31\x2e\x30\x00" + \
                  b"\x02\x4c\x41\x4e\x4d\x41\x4e\x31\x2e\x30\x00" + b"\x02\x57\x69\x6e\x64\x6f\x77\x73\x20\x66\x6f\x72\x20\x57\x6f\x72\x6b\x67\x72\x6f\x75\x70\x73\x20\x33\x2e\x31\x61\x00"
        sock.sendall(smb_neg)
        time.sleep(1)
        resp = sock.recv(4096)
        sock.close()
        if len(resp) > 40:
            smb_info["smb1_supported"] = resp[4] == 0xff and resp[5] == 0x53
    except Exception:
        pass
    raw = f"SMB/NetBIOS枚举: {host}\n"
    if nb_info.get("netbios_names"):
        raw += f"  NetBIOS名称: {', '.join(nb_info['netbios_names'])}\n"
    if smb_info:
        raw += f"  SMB1: {'支持' if smb_info.get('smb1_supported') else '不支持'}\n"
    if not nb_info and not smb_info:
        raw += "  未获取到SMB信息(可能被防火墙过滤)\n"
    return _result("smb_enum", host, True,
                   data={"host": host, "netbios": nb_info, "smb": smb_info}, raw=raw)

def native_snmp_check(host: str, port: int = 161, timeout: float = 5,
                      communities: str = "public,private,community,admin,monitor,default,snmp,read,write") -> Dict[str, Any]:
    """SNMP团体字检测"""
    comm_list = [c.strip() for c in communities.split(",")]
    found = []
    for comm in comm_list:
        if is_cancelled():
            break
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(timeout)
            oid = b"\x06\x08\x2b\x06\x01\x02\x01\x01\x01\x00"
            pdu = b"\xa0\x1b" + b"\x02\x01\x01" + b"\x02\x01\x00" + b"\x02\x01\x00" + b"\x30\x13" + b"\x30\x11" + oid + b"\x05\x00"
            community_bytes = comm.encode()
            snmp_msg = b"\x30" + bytes([len(b"\x02\x01\x00" + b"\x04" + bytes([len(community_bytes)]) + community_bytes + pdu)]) + \
                       b"\x02\x01\x00" + b"\x04" + bytes([len(community_bytes)]) + community_bytes + pdu
            sock.sendto(snmp_msg, (host, int(port)))
            data, _ = sock.recv(4096)
            sock.close()
            if data and data[0] == 0x30:
                found.append({"community": comm, "response_size": len(data)})
        except socket.timeout:
            continue
        except Exception:
            continue
    raw = f"SNMP检测: {host}:{port}\n  测试 {len(comm_list)} 个团体字\n"
    if found:
        raw += "  [!!] 发现有效团体字:\n"
        for f in found:
            raw += f"    {f['community']} (响应 {f['response_size']} bytes)\n"
    else:
        raw += "  [OK] 未发现弱团体字\n"
    return _result("snmp_check", f"{host}:{port}", True,
                   data={"host": host, "port": port, "communities_found": found,
                         "tested": len(comm_list)}, raw=raw)

def native_mac_lookup(mac: str) -> Dict[str, Any]:
    """MAC地址OUI厂商查询"""
    oui_db = {
        "00:00:0C": "Cisco Systems", "00:1A:2B": "Cisco Systems",
        "00:50:56": "VMware", "00:0C:29": "VMware", "00:1C:14": "VMware",
        "00:0D:3A": "Microsoft", "00:15:5D": "Microsoft Hyper-V",
        "DC:A6:32": "Raspberry Pi", "B8:27:EB": "Raspberry Pi",
        "00:1B:21": "Intel", "00:13:02": "Intel", "00:1E:52": "Intel",
        "00:22:FA": "Apple", "A4:83:E7": "Apple", "AC:DE:48": "Apple",
        "08:00:27": "VirtualBox", "52:54:00": "QEMU/KVM",
        "00:16:3E": "Xen", "00:1C:42": "Parallels",
        "00:E0:4C": "Realtek", "00:13:72": "Foxconn",
        "00:00:5E": "ICANN/IANA (VRRP)", "33:33": "IPv6 Multicast",
    }
    mac_clean = mac.upper().replace("-", ":").replace(".", ":")
    prefix = mac_clean[:8] if len(mac_clean) >= 8 else ""
    vendor = oui_db.get(prefix, "未知厂商(本地OUI库未收录)")
    raw = f"MAC: {mac}\n  厂商: {vendor}\n  OUI: {prefix}\n"
    return _result("mac_lookup", mac, True,
                   data={"mac": mac_clean, "vendor": vendor, "oui": prefix}, raw=raw)

def native_service_scan(target: str, ports: str = "21,22,23,25,53,80,110,111,135,139,143,443,445,465,587,631,993,995,1080,1433,1521,1723,2049,2181,3306,3389,5432,5601,5900,5984,6379,7001,8000,8080,8443,8888,9000,9042,9090,9200,9300,11211,15672,27017,50070",
                        timeout: float = 3, max_workers: int = 30) -> Dict[str, Any]:
    """批量端口扫描+服务Banner识别（增强版：服务版本识别、50+端口、详细banner分析）"""
    # 端口服务映射表
    PORT_SERVICES = {
        21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
        80: "HTTP", 110: "POP3", 111: "RPC", 135: "MS-RPC", 139: "NetBIOS",
        143: "IMAP", 443: "HTTPS", 445: "SMB", 465: "SMTPS", 587: "SMTP-Submission",
        631: "IPP", 993: "IMAPS", 995: "POP3S", 1080: "SOCKS", 1433: "MSSQL",
        1521: "Oracle", 1723: "PPTP", 2049: "NFS", 2181: "ZooKeeper", 3306: "MySQL",
        3389: "RDP", 5432: "PostgreSQL", 5601: "Kibana", 5900: "VNC", 5984: "CouchDB",
        6379: "Redis", 7001: "WebLogic", 8000: "HTTP-Alt", 8080: "HTTP-Proxy",
        8443: "HTTPS-Alt", 8888: "HTTP-Alt2", 9000: "SonarQube", 9042: "Cassandra",
        9090: "Prometheus", 9200: "Elasticsearch", 9300: "Elasticsearch-Transport",
        11211: "Memcached", 15672: "RabbitMQ-Management", 27017: "MongoDB", 50070: "Hadoop-NameNode",
    }
    port_list = _parse_ports(ports)
    results = []
    start = time.time()
    lock = threading.Lock()
    def identify_service(port, banner):
        """根据端口和banner识别服务和版本"""
        service = PORT_SERVICES.get(port, "Unknown")
        version = ""
        banner_lower = banner.lower() if banner else ""
        # HTTP服务版本识别
        if port in (80, 8080, 8000, 8888, 443, 8443):
            server_match = re.search(r'Server:\s*([^\r\n]+)', banner, re.I)
            if server_match:
                version = server_match.group(1).strip()
            elif "apache" in banner_lower:
                version = "Apache"
            elif "nginx" in banner_lower:
                version = "Nginx"
            elif "iis" in banner_lower:
                version = "IIS"
        # SSH版本识别
        elif port == 22:
            ssh_match = re.match(r'SSH-([\d.]+)-(.*)', banner)
            if ssh_match:
                version = f"SSH {ssh_match.group(1)} - {ssh_match.group(2)[:50]}"
        # FTP版本识别
        elif port == 21:
            ftp_match = re.search(r'([\w\s]+)\s*server', banner, re.I)
            if ftp_match:
                version = ftp_match.group(1).strip()
        # SMTP版本识别
        elif port in (25, 465, 587):
            if "postfix" in banner_lower:
                version = "Postfix"
            elif "sendmail" in banner_lower:
                version = "Sendmail"
            elif "exim" in banner_lower:
                version = "Exim"
        # MySQL版本识别
        elif port == 3306:
            mysql_match = re.search(r'([\d.]+)-.*mysql', banner, re.I)
            if mysql_match:
                version = f"MySQL {mysql_match.group(1)}"
            elif "mariadb" in banner_lower:
                version = "MariaDB"
        # Redis识别
        elif port == 6379:
            if "redis" in banner_lower or "pong" in banner_lower:
                version = "Redis"
        # MongoDB识别
        elif port == 27017:
            if "mongodb" in banner_lower or "mongo" in banner_lower:
                version = "MongoDB"
        # Elasticsearch识别
        elif port == 9200:
            if "elasticsearch" in banner_lower:
                version = "Elasticsearch"
        return service, version
    def scan_port(port):
        if is_cancelled():
            return
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            t0 = time.time()
            if sock.connect_ex((target, port)) == 0:
                elapsed = round((time.time() - t0) * 1000, 1)
                banner = ""
                try:
                    if port in (80, 8080, 8000, 8888, 443, 8443):
                        sock.sendall(b"HEAD / HTTP/1.0\r\nHost: " + target.encode() + b"\r\n\r\n")
                    elif port in (21, 22, 25, 110, 143, 993, 995):
                        pass  # 等待服务主动发送banner
                    else:
                        sock.sendall(b"\r\n")
                    banner = sock.recv(1024).decode("utf-8", errors="replace").strip()[:300]
                except Exception:
                    pass
                service, version = identify_service(port, banner)
                with lock:
                    results.append({"port": port, "state": "open", "banner": banner,
                                    "service": service, "version": version,
                                    "latency_ms": elapsed})
            sock.close()
        except Exception:
            pass
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(scan_port, p) for p in port_list]
        for f in as_completed(futures, timeout=120):
            try:
                f.result()
            except Exception:
                pass
    elapsed = time.time() - start
    results.sort(key=lambda x: x["port"])
    # 服务统计
    service_stats = {}
    for r in results:
        svc = r.get("service", "Unknown")
        service_stats[svc] = service_stats.get(svc, 0) + 1
    raw = f"服务扫描 {target} ({len(port_list)}端口, {round(elapsed,1)}s)\n开放: {len(results)}\n"
    raw += f"服务分布: {', '.join(f'{k}({v})' for k, v in sorted(service_stats.items(), key=lambda x: -x[1]))}\n\n"
    for r in results:
        version_info = f" [{r['version']}]" if r.get("version") else ""
        raw += f"  [+] {r['port']:>6d}  {r['service']:<20s}{version_info}  {r['banner'][:50] or '(无banner)'}\n"
    return _result("service_scan", target, True,
                   data={"target": target, "results": results, "open_count": len(results),
                         "total_ports": len(port_list), "elapsed": round(elapsed, 2),
                         "service_stats": service_stats}, raw=raw)

def _parse_ports(ports_str: str) -> List[int]:
    """解析端口字符串，支持 80,443,1-1024 格式"""
    result = set()
    for part in str(ports_str).split(","):
        part = part.strip()
        if "-" in part:
            try:
                start, end = part.split("-", 1)
                result.update(range(int(start), int(end) + 1))
            except Exception:
                pass
        elif part.isdigit():
            result.add(int(part))
    return sorted(p for p in result if 1 <= p <= 65535)
