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


def native_hash_calculator(text: str = "", file_path: str = "",
                           algorithms: str = "md5,sha1,sha256") -> Dict[str, Any]:
    """计算字符串或文件的哈希值"""
    import hashlib
    algos = [a.strip().lower() for a in algorithms.split(",")]
    results = {}
    try:
        if file_path and os.path.isfile(file_path):
            for algo_name in algos:
                try:
                    h = hashlib.new(algo_name)
                    with open(file_path, "rb") as f:
                        while True:
                            chunk = f.read(8192)
                            if not chunk:
                                break
                            h.update(chunk)
                    results[algo_name] = h.hexdigest()
                except Exception:
                    pass
            target = file_path
        else:
            data = text.encode("utf-8")
            for algo_name in algos:
                try:
                    results[algo_name] = hashlib.new(algo_name, data).hexdigest()
                except Exception:
                    pass
            target = f"文本({len(text)}字符)"
        raw = "\n".join(f"{k}: {v}" for k, v in results.items())
        return _result("hash_calculator", target, True, data={"hashes": results}, raw=raw)
    except Exception as e:
        return _result("hash_calculator", text[:20], False, error=str(e))

def native_password_strength(password: str) -> Dict[str, Any]:
    """检测密码强度"""
    score = 0
    feedback = []
    if len(password) >= 8:
        score += 1
    else:
        feedback.append("长度不足8位")
    if len(password) >= 12:
        score += 1
    if len(password) >= 16:
        score += 1
    if re.search(r"[a-z]", password):
        score += 1
    else:
        feedback.append("缺少小写字母")
    if re.search(r"[A-Z]", password):
        score += 1
    else:
        feedback.append("缺少大写字母")
    if re.search(r"\d", password):
        score += 1
    else:
        feedback.append("缺少数字")
    if re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>/?`~]", password):
        score += 1
    else:
        feedback.append("缺少特殊字符")
    # 常见密码检测
    common = ["123456", "password", "qwerty", "admin", "abc123", "letmein",
              "welcome", "monkey", "dragon", "master"]
    if password.lower() in common:
        score = 0
        feedback.append("属于常见密码！")
    # 连续字符检测
    if re.search(r"(.)\1{2,}", password):
        feedback.append("包含连续重复字符")
    # 序列检测
    lower = password.lower()
    for seq in ["abcdefghijklmnopqrstuvwxyz", "0123456789", "qwertyuiop"]:
        for i in range(len(seq) - 3):
            if seq[i:i+4] in lower:
                feedback.append("包含连续序列字符")
                break
    levels = ["极弱", "弱", "一般", "中等", "强", "很强", "极强"]
    level = levels[min(score, 6)]
    raw = f"密码强度: {level} ({score}/7)\n"
    if feedback:
        raw += "建议:\n"
        for f in feedback:
            raw += f"  - {f}\n"
    return _result("password_strength", "***", True,
                   data={"score": score, "level": level, "feedback": feedback,
                         "length": len(password)}, raw=raw)

def native_encode_decode(text: str, mode: str = "url", action: str = "encode") -> Dict[str, Any]:
    """URL/HTML/Base64/Hex 编码解码"""
    import base64
    import html as html_mod
    try:
        result = ""
        if mode == "url":
            if action == "encode":
                result = urllib.request.quote(text, safe="")
            else:
                result = urllib.request.unquote(text)
        elif mode == "html":
            if action == "encode":
                result = html_mod.escape(text)
            else:
                result = html_mod.unescape(text)
        elif mode == "base64":
            if action == "encode":
                result = base64.b64encode(text.encode()).decode()
            else:
                result = base64.b64decode(text).decode("utf-8", errors="replace")
        elif mode == "hex":
            if action == "encode":
                result = text.encode().hex()
            else:
                result = bytes.fromhex(text.replace(" ", "")).decode("utf-8", errors="replace")
        elif mode == "json":
            if action == "encode":
                result = json.dumps(text, ensure_ascii=False)
            else:
                obj = json.loads(text)
                result = json.dumps(obj, indent=2, ensure_ascii=False)
        return _result("encode_decode", f"{mode}_{action}", True,
                       data={"mode": mode, "action": action, "input": text[:100], "result": result},
                       raw=f"{mode} {action}:\n{result}")
    except Exception as e:
        return _result("encode_decode", mode, False, error=str(e))

def native_ftp_anon(host: str, port: int = 21, timeout: float = 8) -> Dict[str, Any]:
    """检测FTP匿名登录"""
    try:
        import ftplib
        ftp = ftplib.FTP()
        ftp.connect(host, int(port), timeout=timeout)
        banner = ftp.getwelcome()
        try:
            ftp.login("anonymous", "anonymous@example.com")
            files = []
            ftp.retrlines("LIST", files.append)
            ftp.quit()
            raw = f"FTP Banner: {banner}\n  [!!] 匿名登录成功!\n  文件列表:\n"
            for f in files[:20]:
                raw += f"    {f}\n"
            return _result("ftp_anon", f"{host}:{port}", True,
                           data={"host": host, "port": port, "banner": banner,
                                 "anonymous_allowed": True, "files": files[:30]}, raw=raw)
        except ftplib.error_perm:
            ftp.quit()
            return _result("ftp_anon", f"{host}:{port}", True,
                           data={"host": host, "port": port, "banner": banner,
                                 "anonymous_allowed": False},
                           raw=f"FTP Banner: {banner}\n  [OK] 匿名登录被拒绝")
    except Exception as e:
        return _result("ftp_anon", f"{host}:{port}", False, error=str(e))

def native_redis_check(host: str, port: int = 6379, timeout: float = 5) -> Dict[str, Any]:
    """检测Redis未授权访问"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, int(port)))
        sock.sendall(b"PING\r\n")
        resp = sock.recv(1024).decode("utf-8", errors="replace").strip()
        info = {}
        unauth = False
        if "+PONG" in resp:
            sock.sendall(b"INFO server\r\n")
            time.sleep(0.5)
            info_resp = sock.recv(4096).decode("utf-8", errors="replace")
            for line in info_resp.splitlines():
                if ":" in line and not line.startswith("#"):
                    k, _, v = line.partition(":")
                    if k in ("redis_version", "os", "tcp_port", "uptime_in_seconds", "config_file"):
                        info[k] = v.strip()
            sock.sendall(b"CONFIG GET requirepass\r\n")
            time.sleep(0.3)
            auth_resp = sock.recv(1024).decode("utf-8", errors="replace")
            unauth = "requirepass" not in auth_resp or "*2\r\n$13\r\nrequirepass\r\n$0\r\n\r\n" in auth_resp
        sock.close()
        raw = f"Redis {host}:{port}\n  PING: {resp}\n"
        if info:
            raw += f"  版本: {info.get('redis_version', '?')}\n  系统: {info.get('os', '?')}\n"
        raw += f"  未授权访问: {'[!!] 是!' if unauth else '否(需要密码)'}\n"
        return _result("redis_check", f"{host}:{port}", True,
                       data={"host": host, "port": port, "ping": resp, "info": info,
                             "unauthorized": unauth}, raw=raw)
    except Exception as e:
        return _result("redis_check", f"{host}:{port}", False, error=str(e))

def native_mongo_check(host: str, port: int = 27017, timeout: float = 5) -> Dict[str, Any]:
    """检测MongoDB未授权访问"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, int(port)))
        cmd = b"\x3f\x00\x00\x00" + b"\x01" * 4 + b"\x00" + b"\x00\x00\x00\x00" + \
              b"\xd4\x07\x00\x00\x00\x00\x00\x00" + b"admin.$cmd\x00" + b"\x00" * 8 + \
              b"\x10ismaster\x00\x01\x00\x00\x00\x00"
        sock.sendall(cmd)
        time.sleep(0.5)
        resp = sock.recv(4096)
        sock.close()
        text = resp.decode("utf-8", errors="replace").lower()
        unauth = "ismaster" in text or "ok" in text
        raw = f"MongoDB {host}:{port}\n  响应: {len(resp)} bytes\n  未授权: {'[!!] 是!' if unauth else '否'}\n"
        return _result("mongo_check", f"{host}:{port}", True,
                       data={"host": host, "port": port, "unauthorized": unauth,
                             "response_size": len(resp)}, raw=raw)
    except Exception as e:
        return _result("mongo_check", f"{host}:{port}", False, error=str(e))

def native_mysql_check(host: str, port: int = 3306, timeout: float = 5) -> Dict[str, Any]:
    """检测MySQL服务版本"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, int(port)))
        greeting = sock.recv(4096)
        sock.close()
        version = ""
        if len(greeting) > 5:
            try:
                version_end = greeting.index(b"\x00", 5)
                version = greeting[5:version_end].decode("utf-8", errors="replace")
            except Exception:
                pass
        raw = f"MySQL {host}:{port}\n  版本: {version or '未知'}\n  状态: 服务可达\n"
        return _result("mysql_check", f"{host}:{port}", True,
                       data={"host": host, "port": port, "version": version, "reachable": True}, raw=raw)
    except Exception as e:
        return _result("mysql_check", f"{host}:{port}", False, error=str(e))

def native_elastic_check(host: str, port: int = 9200, timeout: float = 5) -> Dict[str, Any]:
    """检测Elasticsearch未授权访问"""
    try:
        url = f"http://{host}:{port}/"
        req = urllib.request.Request(url, headers={"User-Agent": "MrHua Scanner"})
        resp = urllib.request.urlopen(req, timeout=timeout)
        data = json.loads(resp.read().decode("utf-8", errors="replace"))
        version = data.get("version", {}).get("number", "?")
        name = data.get("name", "?")
        cluster = data.get("cluster_name", "?")
        unauth = False
        indices = []
        try:
            req2 = urllib.request.Request(f"http://{host}:{port}/_cat/indices?format=json",
                                          headers={"User-Agent": "MrHua Scanner"})
            resp2 = urllib.request.urlopen(req2, timeout=timeout)
            indices = json.loads(resp2.read().decode("utf-8", errors="replace"))
            unauth = True
        except Exception:
            pass
        raw = f"Elasticsearch {host}:{port}\n  名称: {name}\n  集群: {cluster}\n  版本: {version}\n"
        raw += f"  未授权: {'[!!] 是! 可访问索引列表' if unauth else '否'}\n"
        if indices:
            raw += f"  索引数: {len(indices)}\n"
        return _result("elastic_check", f"{host}:{port}", True,
                       data={"host": host, "port": port, "version": version, "name": name,
                             "cluster": cluster, "unauthorized": unauth, "indices_count": len(indices)},
                       raw=raw)
    except Exception as e:
        return _result("elastic_check", f"{host}:{port}", False, error=str(e))

def native_docker_check(host: str, port: int = 2375, timeout: float = 5) -> Dict[str, Any]:
    """检测Docker Remote API未授权访问"""
    try:
        url = f"http://{host}:{port}/version"
        req = urllib.request.Request(url, headers={"User-Agent": "MrHua Scanner"})
        resp = urllib.request.urlopen(req, timeout=timeout)
        data = json.loads(resp.read().decode("utf-8", errors="replace"))
        version = data.get("Version", "?")
        api_version = data.get("ApiVersion", "?")
        containers = []
        try:
            req2 = urllib.request.Request(f"http://{host}:{port}/containers/json?all=1",
                                          headers={"User-Agent": "MrHua Scanner"})
            resp2 = urllib.request.urlopen(req2, timeout=timeout)
            containers = json.loads(resp2.read().decode("utf-8", errors="replace"))
        except Exception:
            pass
        raw = f"Docker API {host}:{port}\n  版本: {version}\n  API: {api_version}\n"
        raw += f"  [!!] 未授权访问! 容器数: {len(containers)}\n"
        for c in containers[:10]:
            names = ",".join(c.get("Names", []))
            raw += f"    {names} ({c.get('Image', '?')}) [{c.get('State', '?')}]\n"
        return _result("docker_check", f"{host}:{port}", True,
                       data={"host": host, "port": port, "version": version,
                             "api_version": api_version, "containers": containers[:20],
                             "unauthorized": True}, raw=raw)
    except Exception as e:
        return _result("docker_check", f"{host}:{port}", False, error=str(e))

def native_memcached_check(host: str, port: int = 11211, timeout: float = 5) -> Dict[str, Any]:
    """检测Memcached未授权访问"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, int(port)))
        sock.sendall(b"version\r\n")
        resp = sock.recv(1024).decode("utf-8", errors="replace").strip()
        sock.sendall(b"stats\r\n")
        time.sleep(0.5)
        stats_raw = sock.recv(8192).decode("utf-8", errors="replace")
        sock.close()
        stats = {}
        for line in stats_raw.splitlines():
            if line.startswith("STAT "):
                parts = line.split()
                if len(parts) >= 3:
                    stats[parts[1]] = parts[2]
        raw = f"Memcached {host}:{port}\n  {resp}\n  [!!] 未授权访问\n"
        raw += f"  当前连接: {stats.get('curr_connections', '?')}\n  存储项: {stats.get('curr_items', '?')}\n"
        return _result("memcached_check", f"{host}:{port}", True,
                       data={"host": host, "port": port, "version": resp, "stats": stats,
                             "unauthorized": True}, raw=raw)
    except Exception as e:
        return _result("memcached_check", f"{host}:{port}", False, error=str(e))

def native_uuid_generator(count: int = 5, version: int = 4) -> Dict[str, Any]:
    """生成UUID/GUID"""
    import uuid
    results = []
    for _ in range(min(int(count), 100)):
        u = uuid.uuid1() if version == 1 else uuid.uuid4()
        results.append(str(u))
    raw = f"生成 {len(results)} 个 UUIDv{version}:\n"
    for u in results:
        raw += f"  {u}\n"
    return _result("uuid_generator", f"uuidv{version}", True,
                   data={"uuids": results, "version": version, "count": len(results)}, raw=raw)

def native_regex_tester(pattern: str, text: str, flags: str = "") -> Dict[str, Any]:
    """测试正则表达式匹配"""
    try:
        flag_map = {"i": re.IGNORECASE, "m": re.MULTILINE, "s": re.DOTALL, "x": re.VERBOSE}
        re_flags = 0
        for f in flags.lower():
            re_flags |= flag_map.get(f, 0)
        compiled = re.compile(pattern, re_flags)
        matches = []
        for m in compiled.finditer(text):
            matches.append({
                "match": m.group(0), "start": m.start(), "end": m.end(),
                "groups": list(m.groups()), "named_groups": m.groupdict()
            })
        raw = f"正则: {pattern}\n标志: {flags or '无'}\n匹配数: {len(matches)}\n"
        for i, m in enumerate(matches[:20]):
            raw += f"  #{i+1} [{m['start']}:{m['end']}] {m['match'][:80]}\n"
            if m["groups"]:
                raw += f"       分组: {m['groups']}\n"
        return _result("regex_tester", pattern[:30], True,
                       data={"pattern": pattern, "matches": matches[:50], "count": len(matches)},
                       raw=raw)
    except re.error as e:
        return _result("regex_tester", pattern[:30], False, error=f"正则错误: {e}")
