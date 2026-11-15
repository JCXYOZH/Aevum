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


def native_wappalyzer(url: str, timeout: float = 8) -> Dict[str, Any]:
    """识别网站使用的技术栈（CMS、框架、服务器、JS库、分析工具等）"""
    if not url.startswith("http"):
        url = "http://" + url
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        })
        resp = urllib.request.urlopen(req, timeout=timeout)
        headers = dict(resp.headers)
        body = resp.read(200000).decode("utf-8", errors="replace")
        status = resp.status
    except Exception as e:
        return _result("wappalyzer", url, False, error=str(e))
    
    technologies = []
    # 服务器识别
    server = headers.get("Server", "")
    if server:
        if "nginx" in server.lower():
            technologies.append({"name": "Nginx", "version": server, "category": "Web服务器"})
        elif "apache" in server.lower():
            technologies.append({"name": "Apache", "version": server, "category": "Web服务器"})
        elif "iis" in server.lower():
            technologies.append({"name": "IIS", "version": server, "category": "Web服务器"})
        elif "lighttpd" in server.lower():
            technologies.append({"name": "Lighttpd", "version": server, "category": "Web服务器"})
        else:
            technologies.append({"name": server, "version": "", "category": "Web服务器"})
    
    # X-Powered-By
    powered = headers.get("X-Powered-By", "")
    if powered:
        if "php" in powered.lower():
            technologies.append({"name": "PHP", "version": powered, "category": "编程语言"})
        elif "asp.net" in powered.lower():
            technologies.append({"name": "ASP.NET", "version": powered, "category": "编程语言"})
        elif "express" in powered.lower():
            technologies.append({"name": "Express.js", "version": powered, "category": "Web框架"})
        else:
            technologies.append({"name": powered, "version": "", "category": "后端技术"})
    
    # CMS识别（通过meta标签和HTML特征）
    cms_patterns = [
        ("WordPress", [r'wp-content', r'wp-includes', r'name="generator" content="WordPress', r'/wp-json/']),
        ("Joomla", [r'/components/com_', r'/media/system/js', r'name="generator" content="Joomla']),
        ("Drupal", [r'/sites/default/files', r'Drupal.settings', r'name="Generator" content="Drupal']),
        ("Magento", [r'/skin/frontend', r'/js/mage', r'name="generator" content="Magento']),
        ("Shopify", [r'cdn.shopify.com', r'Shopify.theme', r'window.Shopify']),
        ("Discuz", [r'/data/cache', r'discuz_uid', r'name="generator" content="Discuz']),
        ("DedeCMS", [r'/templets/default', r'dede_', r'name="generator" content="DedeCMS']),
        ("ThinkPHP", [r' thinkphp', r'ThinkPHP', r'name="generator" content="ThinkPHP']),
        ("Laravel", [r'laravel_session', r'XSRF-TOKEN', r'/_debugbar']),
        ("Django", [r'django csrf', r'csrftoken', r'Django']),
        ("Spring Boot", [r'/actuator', r'Whitelabel Error Page', r'spring-boot']),
    ]
    for cms_name, patterns in cms_patterns:
        for pattern in patterns:
            if re.search(pattern, body, re.IGNORECASE):
                technologies.append({"name": cms_name, "version": "", "category": "CMS/框架"})
                break
    
    # JS库识别
    js_patterns = [
        ("jQuery", [r'jquery[.-]([\d.]+)', r'jQuery v([\d.]+)']),
        ("React", [r'react[.-]dom', r'window.React', r'data-reactroot']),
        ("Vue.js", [r'vue[.-]([\d.]+)', r'window.Vue', r'__vue__']),
        ("Angular", [r'ng-version', r'angular[.-]([\d.]+)', r'ng-app']),
        ("Bootstrap", [r'bootstrap[.-]([\d.]+)', r'class="container', r'bootstrap.min.css']),
        ("Tailwind CSS", [r'tailwindcss', r'tailwind[.-]']),
        ("Font Awesome", [r'font-awesome', r'fa[.-]([\d.]+)', r'class="fa fa-']),
        ("Google Analytics", [r'google-analytics.com/ga.js', r'gtag(', r'UA-\d+-\d+']),
        ("百度统计", [r'hm.baidu.com/hm.js', r'_hmt.push']),
        ("CNZZ统计", [r'cnzz.com', r'stat.cnzz.com']),
    ]
    for lib_name, patterns in js_patterns:
        for pattern in patterns:
            match = re.search(pattern, body, re.IGNORECASE)
            if match:
                version = match.group(1) if match.lastindex and match.group(1) else ""
                technologies.append({"name": lib_name, "version": version, "category": "前端库/工具"})
                break
    
    # CDN识别
    cdn_patterns = [
        ("Cloudflare", [r'cloudflare', r'cf-ray', r'__cfduid']),
        ("Akamai", [r'akamai', r'akam', r'X-Akamai-Transformed']),
        ("阿里云CDN", [r'aliyun', r'alicdn', r'X-Cache']),
        ("腾讯云CDN", [r'qcloud', r'cdn.dnsv1.com']),
        ("七牛云", [r'qiniu', r'qbox.me', r'clouddn.com']),
        ("又拍云", [r'upai', r'upyun']),
    ]
    for cdn_name, patterns in cdn_patterns:
        for pattern in patterns:
            if re.search(pattern, body, re.IGNORECASE) or re.search(pattern, str(headers), re.IGNORECASE):
                technologies.append({"name": cdn_name, "version": "", "category": "CDN"})
                break
    
    # 安全头检测
    security_headers = {
        "Strict-Transport-Security": "HSTS",
        "Content-Security-Policy": "CSP",
        "X-Frame-Options": "X-Frame-Options",
        "X-Content-Type-Options": "X-Content-Type-Options",
        "X-XSS-Protection": "X-XSS-Protection",
        "Referrer-Policy": "Referrer-Policy",
        "Permissions-Policy": "Permissions-Policy",
    }
    security_info = {}
    for header, name in security_headers.items():
        if header in headers:
            security_info[name] = headers[header][:100]
    
    # 去重
    seen = set()
    unique_tech = []
    for tech in technologies:
        key = tech["name"] + tech["category"]
        if key not in seen:
            seen.add(key)
            unique_tech.append(tech)
    
    # 按类别分组
    categories = {}
    for tech in unique_tech:
        cat = tech["category"]
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(tech["name"] + (f" {tech['version']}" if tech["version"] else ""))
    
    raw = f"技术栈识别: {url}\n状态码: {status}\n识别到 {len(unique_tech)} 项技术\n\n"
    for cat, items in categories.items():
        raw += f"【{cat}】\n"
        for item in items:
            raw += f"  - {item}\n"
        raw += "\n"
    if security_info:
        raw += "【安全头】\n"
        for name, value in security_info.items():
            raw += f"  - {name}: {value}\n"
    
    return _result("wappalyzer", url, True,
                   data={"url": url, "status": status, "technologies": unique_tech,
                         "categories": categories, "security_headers": security_info,
                         "count": len(unique_tech)}, raw=raw)

def native_wayback_urls(domain: str, limit: int = 100, timeout: float = 15) -> Dict[str, Any]:
    """从Wayback Machine查询网站历史URL（CDX API）"""
    try:
        # 使用CDX API查询
        cdx_url = f"http://web.archive.org/cdx/search/cdx?url={domain}/*&output=json&limit={limit}&fl=original,timestamp,statuscode,mimetype&collapse=urlkey"
        req = urllib.request.Request(cdx_url, headers={"User-Agent": "Mozilla/5.0"})
        resp = urllib.request.urlopen(req, timeout=timeout)
        data = json.loads(resp.read().decode("utf-8"))
        
        if len(data) <= 1:
            return _result("wayback_urls", domain, True,
                           data={"domain": domain, "urls": [], "count": 0},
                           raw=f"Wayback Machine: {domain}\n未找到历史URL")
        
        # 跳过表头
        urls = []
        status_counts = {}
        mime_counts = {}
        for row in data[1:]:
            original, timestamp, statuscode, mimetype = row[0], row[1], row[2], row[3]
            urls.append({
                "url": original,
                "timestamp": timestamp,
                "date": f"{timestamp[:4]}-{timestamp[4:6]}-{timestamp[6:8]} {timestamp[8:10]}:{timestamp[10:12]}",
                "status": statuscode,
                "mimetype": mimetype,
            })
            status_counts[statuscode] = status_counts.get(statuscode, 0) + 1
            mime_counts[mimetype] = mime_counts.get(mimetype, 0) + 1
        
        raw = f"Wayback Machine: {domain}\n找到 {len(urls)} 个历史URL\n\n"
        raw += "【状态码分布】\n"
        for status, count in sorted(status_counts.items(), key=lambda x: -x[1]):
            raw += f"  {status}: {count}\n"
        raw += "\n【内容类型分布】\n"
        for mime, count in sorted(mime_counts.items(), key=lambda x: -x[1])[:10]:
            raw += f"  {mime}: {count}\n"
        raw += "\n【URL列表】\n"
        for u in urls[:50]:
            raw += f"  [{u['status']}] {u['date']} {u['url'][:80]}\n"
        if len(urls) > 50:
            raw += f"  ... 共{len(urls)}个，仅显示前50个\n"
        
        return _result("wayback_urls", domain, True,
                       data={"domain": domain, "urls": urls, "count": len(urls),
                             "status_counts": status_counts, "mime_counts": mime_counts},
                       raw=raw)
    except Exception as e:
        return _result("wayback_urls", domain, False, error=str(e))

def native_error_extractor(url: str, timeout: float = 8) -> Dict[str, Any]:
    """从网站错误信息中提取敏感信息（路径、版本、堆栈跟踪、数据库信息等）"""
    if not url.startswith("http"):
        url = "http://" + url
    
    # 触发错误的Payload
    error_payloads = [
        "",  # 正常请求
        "/'",
        '/"',
        "/%00",
        "/..%2f..%2f..%2fetc%2fpasswd",
        "/.env",
        "/config.php",
        "/admin' OR '1'='1",
        "/<script>alert(1)</script>",
        "/../../../../etc/passwd",
        "/phpinfo.php",
        "/test.php",
        "/debug",
        "/_profiler",
        "/_debugbar",
    ]
    
    findings = []
    errors_found = set()
    
    for payload in error_payloads:
        try:
            target = url.rstrip("/") + payload
            req = urllib.request.Request(target, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            })
            resp = urllib.request.urlopen(req, timeout=timeout)
            status = resp.status
            body = resp.read(50000).decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            status = e.code
            try:
                body = e.read(50000).decode("utf-8", errors="replace")
            except Exception:
                body = ""
        except Exception:
            continue
        
        if status >= 400 or status == 500:
            # 提取错误信息
            error_patterns = [
                (r"Fatal error:[^<]+", "PHP致命错误"),
                (r"Warning:[^<]+", "PHP警告"),
                (r"Notice:[^<]+", "PHP通知"),
                (r"Parse error:[^<]+", "PHP解析错误"),
                (r"SQLException:[^<]+", "SQL异常"),
                (r"MySQL syntax error[^<]+", "MySQL语法错误"),
                (r"ORA-\d+:[^<]+", "Oracle错误"),
                (r"PG::[^:]+:[^<]+", "PostgreSQL错误"),
                (r"Traceback \(most recent call last\):[\s\S]+?\n\n", "Python堆栈跟踪"),
                (r"Exception:[^<]+", "通用异常"),
                (r"Stack trace:[\s\S]+?\n\n", "堆栈跟踪"),
                (r"at [\w.$]+\([\w.$]+\.java:\d+\)", "Java堆栈帧"),
                (r"in [\w./_-]+\.php on line \d+", "PHP文件路径"),
                (r"[A-Z]:\\[\w\\.-]+\.\w+", "Windows文件路径"),
                (r"/[\w./_-]+\.\w+", "Unix文件路径"),
                (r"database[^<]{0,100}", "数据库信息"),
                (r"version[^<]{0,50}", "版本信息"),
                (r"Apache/[\d.]+", "Apache版本"),
                (r"nginx/[\d.]+", "Nginx版本"),
                (r"PHP/[\d.]+", "PHP版本"),
                (r"OpenSSL/[\d.]+", "OpenSSL版本"),
            ]
            
            for pattern, error_type in error_patterns:
                matches = re.findall(pattern, body, re.IGNORECASE)
                for match in matches[:3]:
                    match_text = match.strip()[:200]
                    if match_text and match_text not in errors_found:
                        errors_found.add(match_text)
                        findings.append({
                            "type": error_type,
                            "payload": payload,
                            "status": status,
                            "content": match_text,
                        })
    
    # 按类型分组
    by_type = {}
    for f in findings:
        t = f["type"]
        if t not in by_type:
            by_type[t] = []
        by_type[t].append(f)
    
    raw = f"错误信息提取: {url}\n发现 {len(findings)} 条敏感信息\n\n"
    for error_type, items in by_type.items():
        raw += f"【{error_type}】({len(items)})\n"
        for item in items[:5]:
            raw += f"  [{item['status']}] {item['content'][:100]}\n"
        raw += "\n"
    
    risk = "低风险"
    if any(t in by_type for t in ["SQL异常", "MySQL语法错误", "Oracle错误", "PostgreSQL错误"]):
        risk = "高风险（SQL错误泄露）"
    elif any(t in by_type for t in ["PHP致命错误", "Python堆栈跟踪", "Java堆栈帧"]):
        risk = "中风险（堆栈跟踪泄露）"
    
    return _result("error_extractor", url, True,
                   data={"url": url, "findings": findings, "count": len(findings),
                         "by_type": by_type, "risk": risk}, raw=raw)
