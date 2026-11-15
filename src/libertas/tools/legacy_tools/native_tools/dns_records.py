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


def native_subdomain_takeover(domain: str, timeout: float = 8) -> Dict[str, Any]:
    """检测子域名是否可被接管（CNAME指向已删除的服务）"""
    # 常见可接管服务指纹
    takeover_signatures = {
        "GitHub Pages": ["There isn't a GitHub Pages site here.", "For root URLs (like http://example.com/) you must provide an index.html file."],
        "Heroku": ["No such app", "herokucdn.com", "herokuapp.com"],
        "AWS S3": ["NoSuchBucket", "The specified bucket does not exist", "s3.amazonaws.com"],
        "Shopify": ["Sorry, this shop is currently unavailable.", "myshopify.com"],
        "Tumblr": ["There's nothing here.", "tumblr.com"],
        "WordPress": ["Do you want to register", "wordpress.com"],
        "Ghost": ["The thing you were looking for is no longer here, or never was", "ghost.io"],
        "Surge": ["project not found", "surge.sh"],
        "Netlify": ["Not Found - Request ID", "netlify.com"],
        "Vercel": ["DEPLOYMENT_NOT_FOUND", "vercel.app"],
        "Firebase": ["Couldn't find this Firebase App", "firebaseapp.com"],
        "Azure": ["Error 404 - Web app not found", "azurewebsites.net"],
        "CloudFront": ["The request could not be satisfied", "cloudfront.net"],
        "Fastly": ["Fastly error: unknown domain", "fastly.net"],
    }
    
    results = []
    # 先获取子域名列表（通过证书透明度）
    subdomains = []
    try:
        crt_url = f"https://crt.sh/?q=%25.{domain}&output=json"
        req = urllib.request.Request(crt_url, headers={"User-Agent": "Mozilla/5.0"})
        resp = urllib.request.urlopen(req, timeout=10)
        certs = json.loads(resp.read().decode("utf-8"))
        for cert in certs:
            name = cert.get("name_value", "")
            for n in name.split("\n"):
                n = n.strip().lower()
                if n.endswith(domain) and n != domain and not n.startswith("*"):
                    if n not in subdomains:
                        subdomains.append(n)
    except Exception:
        pass
    
    # 检测每个子域名
    for sub in subdomains[:20]:  # 限制检测数量
        try:
            # 获取CNAME
            cname = ""
            try:
                r = subprocess.run(["nslookup", "-type=cname", sub],
                                  capture_output=True, timeout=5)
                for line in decode_output(r.stdout).split("\n"):
                    if "canonical name" in line.lower():
                        cname = line.split("=")[-1].strip().rstrip(".")
                        break
            except Exception:
                pass
            
            # HTTP请求检测指纹
            http_content = ""
            http_status = 0
            try:
                url = f"http://{sub}"
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                resp = urllib.request.urlopen(req, timeout=timeout)
                http_status = resp.status
                http_content = resp.read(5000).decode("utf-8", errors="replace")
            except urllib.error.HTTPError as e:
                http_status = e.code
                try:
                    http_content = e.read(5000).decode("utf-8", errors="replace")
                except Exception:
                    pass
            except Exception:
                pass
            
            # 匹配接管指纹
            vulnerable = []
            for service, signatures in takeover_signatures.items():
                for sig in signatures:
                    if sig.lower() in http_content.lower() or sig.lower() in cname.lower():
                        vulnerable.append(service)
                        break
            
            risk = "安全"
            if vulnerable:
                risk = "可能可接管"
            
            results.append({
                "subdomain": sub,
                "cname": cname,
                "http_status": http_status,
                "vulnerable_services": vulnerable,
                "risk": risk,
            })
        except Exception:
            continue
    
    vulnerable_count = sum(1 for r in results if r["vulnerable_services"])
    
    raw = f"子域名接管检测: {domain}\n检测了 {len(results)} 个子域名\n可能可接管: {vulnerable_count}\n\n"
    for r in results:
        flag = "⚠️ " if r["vulnerable_services"] else "✅"
        raw += f"{flag} {r['subdomain']}\n"
        if r["cname"]:
            raw += f"    CNAME: {r['cname']}\n"
        raw += f"    HTTP状态: {r['http_status']}\n"
        if r["vulnerable_services"]:
            raw += f"    可疑服务: {', '.join(r['vulnerable_services'])}\n"
    
    return _result("subdomain_takeover", domain, True,
                   data={"domain": domain, "results": results, "total": len(results),
                         "vulnerable": vulnerable_count}, raw=raw)
