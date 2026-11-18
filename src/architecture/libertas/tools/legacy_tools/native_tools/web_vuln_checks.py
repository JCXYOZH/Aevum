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


def native_open_redirect(url: str, timeout: float = 10) -> Dict[str, Any]:
    """检测URL是否存在开放重定向漏洞"""
    if not url.startswith("http"):
        url = "http://" + url
    from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    redirect_params = ["url", "redirect", "next", "return", "returnUrl", "return_to",
                       "goto", "target", "rurl", "dest", "destination", "redir",
                       "redirect_uri", "redirect_url", "out", "view", "to", "jump"]
    evil = "https://evil.example.com/"
    findings = []
    try:
        for param in redirect_params:
            if param in params:
                new_query = urlencode({k: evil if k == param else v[0] for k, v in params.items()})
                test_url = urlunparse(parsed._replace(query=new_query))
                try:
                    req = urllib.request.Request(test_url, headers={"User-Agent": "Mozilla/5.0"})
                    resp = urllib.request.urlopen(req, timeout=timeout)
                    final_url = resp.geturl()
                    if "evil.example.com" in final_url:
                        findings.append({"param": param, "vulnerable": True,
                                         "payload": test_url, "redirects_to": final_url})
                except urllib.error.HTTPError as e:
                    if "evil.example.com" in e.headers.get("Location", ""):
                        findings.append({"param": param, "vulnerable": True, "payload": test_url})
                except Exception:
                    pass
        # 也测试直接在URL末尾加redirect参数
        raw = f"目标: {url}\n发现 {len(findings)} 个可能的开放重定向:\n"
        for f in findings:
            raw += f"  ⚠️ 参数 {f['param']} 存在开放重定向\n"
        if not findings:
            raw += "  未发现开放重定向\n"
        return _result("open_redirect", url, True,
                       data={"url": url, "findings": findings, "vulnerable": len(findings) > 0},
                       raw=raw)
    except Exception as e:
        return _result("open_redirect", url, False, error=str(e))

def native_swagger_finder(url: str, timeout: float = 10) -> Dict[str, Any]:
    """发现Swagger/OpenAPI/GraphQL等API文档端点"""
    if not url.startswith("http"):
        url = "http://" + url
    paths = ["/swagger-ui.html", "/swagger-ui/", "/api-docs", "/v2/api-docs",
             "/v3/api-docs", "/openapi.json", "/swagger.json", "/api/swagger.json",
             "/graphql", "/graphiql", "/playground", "/altair",
             "/redoc", "/api/docs", "/docs", "/rapidoc", "/scalar"]
    found = []
    for path in paths:
        try:
            target = url.rstrip("/") + path
            req = urllib.request.Request(target, headers={"User-Agent": "Mozilla/5.0"})
            resp = urllib.request.urlopen(req, timeout=timeout)
            body = resp.read(2048).decode("utf-8", errors="replace")
            ct = resp.headers.get("Content-Type", "")
            is_api_doc = any(kw in body.lower() for kw in ["swagger", "openapi", "graphql",
                                                           "api-docs", "redoc", "paths"])
            found.append({"path": path, "status": resp.status, "content_type": ct,
                          "is_api_doc": is_api_doc, "url": target})
        except urllib.error.HTTPError:
            pass
        except Exception:
            pass
    api_docs = [f for f in found if f["is_api_doc"]]
    raw = f"扫描 {len(paths)} 个API文档路径，发现 {len(api_docs)} 个:\n"
    for f in api_docs:
        raw += f"  [DOC] {f['url']} ({f['content_type']})\n"
    return _result("swagger_finder", url, True,
                   data={"url": url, "found": found, "api_docs": api_docs}, raw=raw)

def native_graphql_check(url: str, timeout: float = 10) -> Dict[str, Any]:
    """检测GraphQL端点和内省查询"""
    if not url.startswith("http"):
        url = "http://" + url
    if "/graphql" not in url:
        url = url.rstrip("/") + "/graphql"
    introspection_query = json.dumps({
        "query": "{__schema{queryType{name}mutationType{name}types{name kind}}}"
    }).encode()
    try:
        req = urllib.request.Request(url, data=introspection_query,
                                     headers={"User-Agent": "Mozilla/5.0",
                                              "Content-Type": "application/json"})
        resp = urllib.request.urlopen(req, timeout=timeout)
        data = json.loads(resp.read().decode("utf-8", errors="replace"))
        schema = data.get("data", {}).get("__schema")
        if schema:
            types = [t["name"] for t in schema.get("types", []) if not t["name"].startswith("__")]
            raw = f"GraphQL端点: {url}\n  [!!] 内省查询已开启!\n"
            raw += f"  Query类型: {schema.get('queryType', {}).get('name', '?')}\n"
            raw += f"  Mutation类型: {schema.get('mutationType', {}).get('name', '无')}\n"
            raw += f"  类型数: {len(types)}\n"
            return _result("graphql_check", url, True,
                           data={"url": url, "introspection_enabled": True,
                                 "query_type": schema.get("queryType", {}).get("name"),
                                 "mutation_type": schema.get("mutationType", {}).get("name"),
                                 "types": types[:50], "type_count": len(types)}, raw=raw)
        return _result("graphql_check", url, True,
                       data={"url": url, "introspection_enabled": False},
                       raw=f"GraphQL端点: {url}\n  内省已关闭或无schema")
    except Exception as e:
        return _result("graphql_check", url, False, error=str(e))

def native_crlf_injection(url: str, timeout: float = 10) -> Dict[str, Any]:
    """检测CRLF注入（HTTP响应拆分）"""
    if not url.startswith("http"):
        url = "http://" + url
    payloads = ["%0d%0aSet-Cookie:crlf=injected", "%0aSet-Cookie:crlf=injected",
                "%0d%0a%0d%0a<script>alert(1)</script>", "%0dSet-Cookie:crlf=injected"]
    findings = []
    for payload in payloads:
        try:
            test_url = url + payload
            req = urllib.request.Request(test_url, headers={"User-Agent": "Mozilla/5.0"})
            resp = urllib.request.urlopen(req, timeout=timeout)
            headers = {k.lower(): v for k, v in resp.headers.items()}
            if "crlf" in headers.get("set-cookie", "").lower():
                findings.append({"payload": payload, "vulnerable": True,
                                 "set_cookie": headers["set-cookie"]})
        except Exception:
            pass
    raw = f"CRLF注入检测: {url}\n"
    if findings:
        raw += "  [!!] 发现CRLF注入漏洞!\n"
        for f in findings:
            raw += f"    Payload: {f['payload']}\n"
    else:
        raw += "  [OK] 未发现CRLF注入\n"
    return _result("crlf_injection", url, True,
                   data={"url": url, "findings": findings, "vulnerable": len(findings) > 0}, raw=raw)

def native_host_header_injection(url: str, timeout: float = 10) -> Dict[str, Any]:
    """检测Host头注入"""
    if not url.startswith("http"):
        url = "http://" + url
    evil_host = "evil.example.com"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Host": evil_host})
        resp = urllib.request.urlopen(req, timeout=timeout)
        body = resp.read(8192).decode("utf-8", errors="replace")
        reflected = evil_host in body
        reset_links = re.findall(r'https?://[^\s"\'<>]+', body)
        poisoned = [l for l in reset_links if evil_host in l]
        raw = f"Host头注入检测: {url}\n  测试Host: {evil_host}\n"
        raw += f"  Host反射: {'[!!] 是' if reflected else '否'}\n"
        if poisoned:
            raw += f"  [!!] 发现投毒链接:\n"
            for l in poisoned[:5]:
                raw += f"    {l}\n"
        return _result("host_header_injection", url, True,
                       data={"url": url, "reflected": reflected, "poisoned_links": poisoned,
                             "vulnerable": reflected or len(poisoned) > 0}, raw=raw)
    except Exception as e:
        return _result("host_header_injection", url, False, error=str(e))

def native_csp_evaluator(url: str, timeout: float = 10) -> Dict[str, Any]:
    """评估Content-Security-Policy的强度"""
    if not url.startswith("http"):
        url = "https://" + url
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        resp = urllib.request.urlopen(req, timeout=timeout, context=ctx)
        csp = resp.headers.get("Content-Security-Policy", "")
        if not csp:
            csp = resp.headers.get("Content-Security-Policy-Report-Only", "")
        if not csp:
            return _result("csp_evaluator", url, True,
                           data={"url": url, "has_csp": False, "score": 0},
                           raw=f"目标: {url}\n  [X] 未设置CSP头")
        issues = []
        score = 100
        directives = {}
        for part in csp.split(";"):
            part = part.strip()
            if part:
                k, _, v = part.partition(" ")
                directives[k.strip().lower()] = v.strip()
        if "default-src" not in directives:
            issues.append("缺少default-src(回退策略)")
            score -= 20
        if "'unsafe-inline'" in csp:
            issues.append("包含'unsafe-inline'(允许内联脚本)")
            score -= 25
        if "'unsafe-eval'" in csp:
            issues.append("包含'unsafe-eval'(允许eval)")
            score -= 15
        if "default-src *" in csp:
            issues.append("default-src使用通配符*")
            score -= 20
        if "data:" in csp:
            issues.append("允许data: URI(可用于XSS)")
            score -= 10
        score = max(0, score)
        raw = f"CSP评估: {url}\n  CSP: {csp[:100]}...\n  评分: {score}/100\n"
        for i in issues:
            raw += f"  [!!] {i}\n"
        if not issues:
            raw += "  [OK] CSP配置良好\n"
        return _result("csp_evaluator", url, True,
                       data={"url": url, "has_csp": True, "csp": csp, "score": score,
                             "directives": directives, "issues": issues}, raw=raw)
    except Exception as e:
        return _result("csp_evaluator", url, False, error=str(e))

def native_ssl_vuln_check(host: str, port: int = 443, timeout: float = 8) -> Dict[str, Any]:
    """检测SSL/TLS版本和弱加密套件"""
    vulns = []
    details = {}
    versions = []
    if hasattr(ssl, "TLSVersion"):
        versions = [
            ("SSLv3", ssl.TLSVersion.SSLv3, "POODLE"),
            ("TLSv1", ssl.TLSVersion.TLSv1, "BEAST/Deprecated"),
            ("TLSv1.1", ssl.TLSVersion.TLSv1_1, "Deprecated"),
            ("TLSv1.2", ssl.TLSVersion.TLSv1_2, None),
            ("TLSv1.3", ssl.TLSVersion.TLSv1_3, None),
        ]
    for name, ver, vuln_name in versions:
        try:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            ctx.minimum_version = ver
            ctx.maximum_version = ver
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            ssock = ctx.wrap_socket(sock, server_hostname=host)
            cipher = ssock.cipher()
            ssock.close()
            details[name] = {"supported": True, "cipher": cipher[0] if cipher else "?"}
            if vuln_name:
                vulns.append(f"{name} 受支持({vuln_name})")
        except Exception:
            details[name] = {"supported": False}
    cert_info = {}
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        ssock = ctx.wrap_socket(sock, server_hostname=host)
        cert = ssock.getpeercert()
        ssock.close()
        if cert:
            cert_info["not_after"] = cert.get("notAfter", "")
            cert_info["issuer"] = dict(x[0] for x in cert.get("issuer", []))
            cert_info["subject"] = dict(x[0] for x in cert.get("subject", []))
    except Exception:
        pass
    raw = f"SSL/TLS检测: {host}:{port}\n"
    for name, info in details.items():
        icon = "[+]" if info["supported"] else "[-]"
        cipher_info = f" ({info.get('cipher', '')})" if info["supported"] else ""
        raw += f"  {icon} {name}{cipher_info}\n"
    if vulns:
        raw += "\n[!!] 漏洞:\n"
        for v in vulns:
            raw += f"  - {v}\n"
    return _result("ssl_vuln_check", f"{host}:{port}", True,
                   data={"host": host, "port": port, "versions": details,
                         "vulnerabilities": vulns, "cert": cert_info}, raw=raw)
