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


def native_port_scan(target: str, ports: str = "1-1024", timeout: float = 2.0,
                     max_workers: int = 100, overall_timeout: float = 120,
                     progress_cb: Callable = None, speed: str = "") -> Dict[str, Any]:
    # 支持速度预设
    if speed and speed.lower() in _SPEED_PRESETS:
        _sp = _SPEED_PRESETS[speed.lower()]
        timeout = _sp["timeout"]
        max_workers = _sp["max_workers"]
        overall_timeout = _sp["overall_timeout"]
    try:
        port_list = _parse_ports(ports)
    except Exception as e:
        return _result("native_port_scan", target, False, error=f"端口格式错误: {e}")

    if len(port_list) > 5000:
        max_workers = max(max_workers, 500)
        timeout = min(timeout, 1.0)

    open_ports: List[Dict] = []
    filtered_ports: List[int] = []
    start = time.time()
    completed = 0
    total = len(port_list)

    def check_port(port: int) -> Optional[Dict]:
        if cancel_event.is_set():
            return None
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            result = sock.connect_ex((target, port))
            if result == 0:
                service = _get_service_name(port)
                banner = _grab_banner(sock, port)
                sock.close()
                return {"port": port, "state": "open", "protocol": "tcp",
                        "service": service, "banner": banner}
            sock.close()
        except socket.timeout:
            return {"port": port, "state": "filtered", "protocol": "tcp"}
        except Exception:
            pass
        return None

    try:
        executor = ThreadPoolExecutor(max_workers=max_workers)
        futures = {executor.submit(check_port, p): p for p in port_list}
        try:
            for future in as_completed(futures, timeout=overall_timeout):
                completed += 1
                if progress_cb and completed % 500 == 0:
                    try:
                        progress_cb(completed, total)
                    except Exception:
                        pass
                r = future.result()
                if r:
                    if r["state"] == "open":
                        open_ports.append(r)
                    elif r["state"] == "filtered":
                        filtered_ports.append(r["port"])
                if cancel_event.is_set():
                    break
        except FuturesTimeout:
            pass
        finally:
            for f in futures:
                f.cancel()
            executor.shutdown(wait=False, cancel_futures=True)
    except Exception as e:
        return _result("native_port_scan", target, False, error=f"扫描异常: {e}")

    elapsed = time.time() - start
    open_ports.sort(key=lambda x: x["port"])
    cancelled = cancel_event.is_set()

    lines = [f"Starting Nmap-like scan at {_now()}"]
    lines.append(f"scan report for {target}")
    status = " (已中止)" if cancelled else ""
    lines.append(f"Host is up, scanned {completed}/{total} ports in {elapsed:.2f}s{status}")
    lines.append("PORT       STATE  SERVICE  BANNER")
    for p in open_ports:
        lines.append(f"{p['port']:<10} {p['state']:<6} {p['service']:<8} {p.get('banner','')}")
    raw = "\n".join(lines)

    return _result("native_port_scan", target, True,
                   data={"open_ports": open_ports, "filtered_count": len(filtered_ports),
                         "scanned": completed, "total": total,
                         "elapsed": round(elapsed, 2), "cancelled": cancelled},
                   raw=raw)

def _get_service_name(port: int) -> str:
    try:
        return socket.getservbyport(port, "tcp")
    except Exception:
        common = {21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "domain",
                  80: "http", 110: "pop3", 111: "rpcbind", 135: "msrpc",
                  139: "netbios-ssn", 143: "imap", 443: "https", 445: "microsoft-ds",
                  993: "imaps", 995: "pop3s", 1433: "ms-sql-s", 1521: "oracle",
                  3306: "mysql", 3389: "ms-wbt-server", 5432: "postgresql",
                  5900: "vnc", 6379: "redis", 8080: "http-proxy", 8443: "https-alt",
                  27017: "mongodb"}
        return common.get(port, "unknown")

def _grab_banner(sock: socket.socket, port: int) -> str:
    try:
        sock.settimeout(2)
        if port in (80, 8080, 8443):
            sock.sendall(b"HEAD / HTTP/1.0\r\nHost: " + sock.getpeername()[0].encode() + b"\r\n\r\n")
        elif port == 443:
            return ""
        else:
            sock.sendall(b"\r\n")
        banner = sock.recv(256).decode("utf-8", errors="replace").strip()
        return banner.split("\r\n")[0][:100] if banner else ""
    except Exception:
        return ""

def native_ping(target: str, count: int = 4, timeout: int = 10) -> Dict[str, Any]:
    os_name = platform.system().lower()
    try:
        if os_name == "windows":
            cmd = ["ping", "-n", str(count), "-w", str(timeout * 1000), target]
        else:
            cmd = ["ping", "-c", str(count), "-W", str(timeout), target]
        # 字节模式 + 级联解码（Windows 中文环境 ping 输出含 cp936 中文，text=True
        # 会按区域编码解码并可能抛 UnicodeDecodeError）
        r = subprocess.run(cmd, capture_output=True, timeout=timeout + 5)
        output = decode_output(r.stdout) + decode_output(r.stderr)

        sent = received = 0
        loss = 100.0
        avg_time = 0.0

        if os_name == "windows":
            m = re.search(r"(\d+).*?(\d+).*?(\d+)\s*%", output)
            if m:
                sent = int(m.group(1))
                received = int(m.group(2))
                loss = float(m.group(3))
            m2 = re.search(r"平均\s*=\s*(\d+)ms", output)
            if m2:
                avg_time = float(m2.group(1))
        else:
            m = re.search(r"(\d+) packets transmitted, (\d+) received, ([\d.]+)% packet loss", output)
            if m:
                sent = int(m.group(1))
                received = int(m.group(2))
                loss = float(m.group(3))
            m2 = re.search(r"=\s*[\d.]+/([\d.]+)/", output)
            if m2:
                avg_time = float(m2.group(1))

        alive = received > 0
        return _result("native_ping", target, alive,
                       data={"target": target, "alive": alive, "sent": sent,
                             "received": received, "loss_percent": loss, "avg_ms": avg_time},
                       raw=output)
    except Exception as e:
        return _result("native_ping", target, False, error=str(e))

def native_traceroute(target: str, max_hops: int = 20, timeout: int = 60) -> Dict[str, Any]:
    os_name = platform.system().lower()
    try:
        if os_name == "windows":
            cmd = ["tracert", "-d", "-h", str(max_hops), "-w", "1000", target]
        else:
            cmd = ["traceroute", "-m", str(max_hops), "-w", "2", target]
        # 字节模式 + 级联解码（同上，tracert 输出在中文 Windows 是 cp936）
        r = subprocess.run(cmd, capture_output=True, timeout=timeout)
        output = decode_output(r.stdout) + decode_output(r.stderr)

        hops = []
        for line in output.splitlines():
            m = re.match(r"\s*(\d+)\s+(.+)", line)
            if m:
                hop_num = int(m.group(1))
                rest = m.group(2).strip()
                ips = re.findall(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})", rest)
                hops.append({"hop": hop_num, "ips": ips, "raw": rest})

        return _result("native_traceroute", target, True,
                       data={"target": target, "hops": hops, "max_hops": max_hops},
                       raw=output)
    except FileNotFoundError:
        return _result("native_traceroute", target, False,
                       error="traceroute/tracert 未安装")
    except Exception as e:
        return _result("native_traceroute", target, False, error=str(e))

def native_dir_bruteforce(url: str, paths: List[str] = None, timeout: float = 5,
                          max_workers: int = 20, overall_timeout: float = 120,
                          wordlist_name: str = "",
                          progress_cb: Callable = None) -> Dict[str, Any]:
    if not url.startswith("http"):
        url = "http://" + url
    url = url.rstrip("/")

    if paths is None and wordlist_name:
        try:
            from .wordlist_manager import get_wordlist_manager
            wl = get_wordlist_manager()
            paths = wl.get_wordlist(wordlist_name)
        except Exception:
            paths = None
    if paths is None:
        paths = COMMON_PATHS

    wordlist = paths
    found: List[Dict] = []
    start = time.time()
    completed = 0
    total = len(wordlist)

    def check_path(path: str) -> Optional[Dict]:
        if cancel_event.is_set():
            return None
        target_url = f"{url}/{path.lstrip('/')}"
        try:
            req = urllib.request.Request(target_url, headers={
                "User-Agent": "Mozilla/5.0 (MrHua Security Scanner)"
            })
            resp = urllib.request.urlopen(req, timeout=timeout)
            return {"path": "/" + path.lstrip("/"), "url": target_url,
                    "status": resp.status, "length": len(resp.read())}
        except urllib.error.HTTPError as e:
            if e.code not in (404, 502, 503):
                return {"path": "/" + path.lstrip("/"), "url": target_url,
                        "status": e.code, "length": 0}
        except Exception:
            return None
        return None

    try:
        executor = ThreadPoolExecutor(max_workers=max_workers)
        futures = {executor.submit(check_path, p): p for p in wordlist}
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
    except Exception as e:
        return _result("native_dir_bruteforce", url, False, error=str(e))

    elapsed = time.time() - start
    found.sort(key=lambda x: x["path"])
    cancelled = cancel_event.is_set()
    lines = [f"Directory scan for {url}"]
    lines.append(f"Tested {completed}/{total} paths in {elapsed:.2f}s{' (已中止)' if cancelled else ''}")
    lines.append(f"Found {len(found)} paths:")
    for f in found:
        lines.append(f"  [{f['status']}] {f['path']} ({f['length']} bytes)")

    return _result("native_dir_bruteforce", url, True,
                   data={"base_url": url, "paths": found,
                         "tested": completed, "total": total,
                         "elapsed": round(elapsed, 2), "cancelled": cancelled},
                   raw="\n".join(lines))

def native_banner_grab(target: str, port: int = 80, timeout: float = 5,
                       payload: str = "") -> Dict[str, Any]:
    """连接目标端口并读取服务Banner"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        start = time.time()
        sock.connect((target, int(port)))
        if payload:
            sock.sendall(payload.encode())
        else:
            # 对HTTP发送HEAD请求触发响应
            if port in (80, 8080, 8000, 8888):
                sock.sendall(b"HEAD / HTTP/1.0\r\nHost: " + target.encode() + b"\r\n\r\n")
            elif port in (21, 22, 25, 110, 143, 993, 995):
                pass  # 这些服务主动发送banner
            else:
                sock.sendall(b"\r\n")
        banner = b""
        while True:
            try:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                banner += chunk
                if len(banner) > 8192:
                    break
            except socket.timeout:
                break
        elapsed = time.time() - start
        sock.close()
        text = banner.decode("utf-8", errors="replace").strip()
        return _result("banner_grab", f"{target}:{port}", True,
                       data={"target": target, "port": port, "banner": text,
                             "response_time": round(elapsed, 3)},
                       raw=f"[{target}:{port}]\n{text}")
    except Exception as e:
        return _result("banner_grab", f"{target}:{port}", False, error=str(e))

def native_host_discovery(target_range: str, timeout: float = 2, max_workers: int = 50,
                          overall_timeout: int = 60) -> Dict[str, Any]:
    """Ping扫描IP范围内的存活主机"""
    import ipaddress
    try:
        net = ipaddress.ip_network(target_range, strict=False)
        hosts = [str(h) for h in net.hosts()]
        if len(hosts) > 65536:
            return _result("host_discovery", target_range, False, error="范围过大，最多支持/16(65534主机)")
    except Exception:
        # 可能是单个IP
        hosts = [target_range]
    alive = []
    start = time.time()
    lock = threading.Lock()

    def ping_host(ip):
        if is_cancelled() or time.time() - start > overall_timeout:
            return
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            # 尝试连接常见端口判断存活
            for port in (80, 443, 22, 445):
                try:
                    result = sock.connect_ex((ip, port))
                    if result == 0:
                        with lock:
                            if ip not in [a["ip"] for a in alive]:
                                alive.append({"ip": ip, "alive_via": f"port {port}"})
                        break
                except Exception:
                    pass
            sock.close()
        except Exception:
            pass

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(ping_host, ip) for ip in hosts]
        for f in as_completed(futures, timeout=overall_timeout + 5):
            try:
                f.result()
            except Exception:
                pass
    elapsed = time.time() - start
    alive.sort(key=lambda x: socket.inet_aton(x["ip"]))
    raw = f"扫描 {len(hosts)} 个IP，发现 {len(alive)} 个存活 ({round(elapsed,1)}s)\n"
    for a in alive:
        raw += f"  🟢 {a['ip']} (via {a['alive_via']})\n"
    return _result("host_discovery", target_range, True,
                   data={"range": target_range, "total_scanned": len(hosts),
                         "alive_hosts": alive, "alive_count": len(alive),
                         "elapsed": round(elapsed, 2)}, raw=raw)

def native_tcp_ping(target: str, port: int = 80, count: int = 4,
                    timeout: float = 3) -> Dict[str, Any]:
    """TCP Ping测试（连接指定端口测量延迟）"""
    results = []
    success = 0
    total_time = 0
    for i in range(count):
        if is_cancelled():
            break
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            start = time.time()
            sock.connect((target, int(port)))
            elapsed = (time.time() - start) * 1000
            sock.close()
            results.append({"seq": i + 1, "success": True, "time_ms": round(elapsed, 2)})
            success += 1
            total_time += elapsed
        except Exception as e:
            results.append({"seq": i + 1, "success": False, "error": str(e)})
        time.sleep(0.5)
    avg = round(total_time / success, 2) if success else 0
    raw = f"TCP Ping {target}:{port} ({count}次)\n"
    for r in results:
        if r["success"]:
            raw += f"  #{r['seq']} 连接成功 延迟={r['time_ms']}ms\n"
        else:
            raw += f"  #{r['seq']} 连接失败\n"
    raw += f"成功率: {success}/{count}, 平均延迟: {avg}ms"
    return _result("tcp_ping", f"{target}:{port}", True,
                   data={"target": target, "port": port, "results": results,
                         "success_rate": f"{success}/{count}", "avg_ms": avg}, raw=raw)
