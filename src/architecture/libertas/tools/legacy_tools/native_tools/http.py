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


def native_http_fingerprint(url: str, timeout: float = 10) -> Dict[str, Any]:
    if not url.startswith("http"):
        url = "http://" + url

    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (MrHua Security Scanner)",
            "Accept": "*/*",
        })
        start = time.time()
        resp = urllib.request.urlopen(req, timeout=timeout)
        elapsed = time.time() - start
        body = resp.read(8192).decode("utf-8", errors="replace")
        headers = dict(resp.headers)

        techs = []
        server = headers.get("Server", "")
        if server:
            techs.append(server)
        powered = headers.get("X-Powered-By", "")
        if powered:
            techs.append(powered)
        if "x-powered-by" in {k.lower(): v for k, v in headers.items()}:
            for k, v in headers.items():
                if k.lower() == "x-powered-by":
                    techs.append(v)

        title_match = re.search(r"<title>(.*?)</title>", body, re.IGNORECASE | re.DOTALL)
        title = title_match.group(1).strip() if title_match else ""

        generator_match = re.search(r'<meta[^>]+name=["\']generator["\'][^>]+content=["\']([^"\']+)', body, re.IGNORECASE)
        if generator_match:
            techs.append(generator_match.group(1))

        # 框架指纹：每个签名带置信度权重
        # 权重：header专属=3, 专属路径/cookie=2, body关键词=1
        # body_signs: 在页面HTML中搜索（可能误报，权重低）
        # header_signs: 在HTTP头中搜索（高置信度）
        frameworks = {
            "wordpress": {
                "body": [("wp-content", 2), ("wp-includes", 2), ("wp-json", 1), ("wordpress", 1)],
                "header": [("x-powered-by: wordpress", 3)],
            },
            "drupal": {
                "body": [("drupal.js", 2), ("drupal.settings", 3), ("drupal", 1)],
                "header": [("x-generator: drupal", 3), ("x-drupal-cache", 3)],
            },
            "joomla": {
                "body": [("/media/jui/", 3), ("joomla!", 2), ("joomla", 1)],
                "header": [("x-powered-by: joomla", 3)],
            },
            "react": {
                "body": [("__next_data__", 3), ("data-reactroot", 3), ("react-dom", 2), ("_next/static", 2)],
                "header": [],
            },
            "vue": {
                "body": [("data-v-", 3), ("__nuxt", 3), ("vue.runtime", 2), ("vue.min.js", 1)],
                "header": [],
            },
            "angular": {
                "body": [("ng-app", 3), ("ng-version", 3), ("angular.min.js", 2), ("ng-controller", 2)],
                "header": [("x-angular-version", 3)],
            },
            "jquery": {
                "body": [("jquery.min.js", 2), ("jquery.js", 1), ("jquery-", 1)],
                "header": [],
            },
            "bootstrap": {
                "body": [("bootstrap.min.css", 2), ("bootstrap.bundle", 2), ("bootstrap.css", 1)],
                "header": [],
            },
            "thinkphp": {
                "body": [("thinkphp", 2)],
                "header": [("x-powered-by: thinkphp", 3)],
            },
            "spring": {
                "body": [("jsessionid", 2)],
                "header": [("x-application-context", 3), ("set-cookie: jsessionid", 3)],
            },
            "php": {
                "body": [("phpsessid", 2), ("php/", 1)],
                "header": [("x-powered-by: php", 3), ("set-cookie: phpsessid", 3)],
            },
            "aspnet": {
                "body": [("__viewstate", 3), ("aspnet_sessionid", 2)],
                "header": [("x-aspnet-version", 3), ("x-powered-by: asp.net", 3), ("set-cookie: asp.net_sessionid", 3)],
            },
            "django": {
                "body": [("csrfmiddlewaretoken", 3), ("csrftoken", 2)],
                "header": [("set-cookie: csrftoken", 3)],
            },
            "flask": {
                "body": [("werkzeug", 2)],
                "header": [("server: werkzeug", 3)],
            },
            "express": {
                "body": [],
                "header": [("x-powered-by: express", 3)],
            },
            "openresty": {
                "body": [],
                "header": [("server: openresty", 3)],
            },
            "nginx": {
                "body": [],
                "header": [("server: nginx", 3)],
            },
            "apache": {
                "body": [],
                "header": [("server: apache", 3)],
            },
            "iis": {
                "body": [],
                "header": [("server: microsoft-iis", 3)],
            },
            "flask": {
                "body": [("werkzeug", 2)],
                "header": [("server: werkzeug", 3)],
            },
            "django": {
                "body": [("csrftoken", 2), ("django", 1)],
                "header": [("server: wsgi", 2)],
            },
            "express": {
                "body": [("express", 1)],
                "header": [("x-powered-by: express", 3)],
            },
            "spring": {
                "body": [],
                "header": [("server: apache-coyote", 3)],
            },
            "laravel": {
                "body": [("laravel_session", 2), ("laravel", 1)],
                "header": [],
            },
            "next.js": {
                "body": [("__next_data__", 3), ("_next/static", 2)],
                "header": [],
            },
            "nuxt.js": {
                "body": [("__nuxt", 3), ("nuxt", 1)],
                "header": [],
            },
            "php": {
                "body": [(".php", 1), ("phpmyadmin", 2)],
                "header": [("x-powered-by: php", 3)],
            },
            "aspnet": {
                "body": [(".aspx", 1), ("__viewstate", 2)],
                "header": [("x-powered-by: asp.net", 3)],
            },
        }
        body_lower = body.lower()
        headers_lower = str(headers).lower()
        tech_scores = {}
        for fw, signs in frameworks.items():
            score = 0
            for sign, weight in signs.get("body", []):
                if sign in body_lower:
                    score += weight
            for sign, weight in signs.get("header", []):
                if sign in headers_lower:
                    score += weight
            if score > 0:
                tech_scores[fw] = score

        # Server头和X-Powered-By直接作为高置信度
        if server:
            server_lower = server.lower()
            for known in ["openresty", "nginx", "apache", "iis", "cloudflare", "tomcat"]:
                if known in server_lower:
                    tech_scores[known] = max(tech_scores.get(known, 0), 3)
        if powered:
            tech_scores[powered.lower()] = max(tech_scores.get(powered.lower(), 0), 3)

        # 矛盾检测：PHP和ASP.NET不太可能共存；多个CMS只取最高分
        cms_list = ["wordpress", "drupal", "joomla"]
        # 多个CMS只保留置信度最高的
        cms_found = [(c, tech_scores[c]) for c in cms_list if c in tech_scores]
        if len(cms_found) > 1:
            cms_found.sort(key=lambda x: -x[1])
            for c, _ in cms_found[1:]:
                del tech_scores[c]
        # PHP和ASP.NET互斥（保留高分）
        if "php" in tech_scores and "aspnet" in tech_scores:
            if tech_scores["php"] >= tech_scores["aspnet"]:
                del tech_scores["aspnet"]
            else:
                del tech_scores["php"]

        # 只保留置信度≥2的技术（过滤body中偶然提到的关键词）
        techs = [t for t, s in tech_scores.items() if s >= 2]
        # 按置信度排序
        techs.sort(key=lambda t: -tech_scores[t])

        tech_detail = [{"name": t, "confidence": tech_scores[t]} for t in techs]

        # WAF指纹检测
        wafs = []
        try:
            from mrhua.security.waf_fingerprint import detect_waf
            wafs = detect_waf(resp.status, headers, body=body)
        except Exception:
            pass

        # 版本识别：从Server头、X-Powered-By头、meta generator提取版本号
        versions = {}
        import re as _re
        for _hdr_val in [server, powered]:
            if _hdr_val:
                _m = _re.search(r'([a-zA-Z][a-zA-Z0-9]*)[/\s]+([\d.]+)', str(_hdr_val))
                if _m:
                    versions[_m.group(1).lower()] = _m.group(2)
        # 从generator meta提取版本
        if generator_match:
            _gen = generator_match.group(1)
            _m = _re.search(r'([a-zA-Z][a-zA-Z0-9]*)[/\s]+([\d.]+)', _gen)
            if _m:
                versions[_m.group(1).lower()] = _m.group(2)

        return _result("native_http_fingerprint", url, True,
                       data={"url": url, "status_code": resp.status, "headers": headers,
                             "title": title, "technologies": techs,
                             "tech_detail": tech_detail,
                             "versions": versions,
                             "wafs": wafs,
                             "response_time": round(elapsed, 3)},
                       raw=f"HTTP {resp.status}\nServer: {server}\nTitle: {title}\nTech: {', '.join(techs) if techs else '未检测到'}\nVersions: {', '.join(f'{k} {v}' for k, v in versions.items()) if versions else '未检测到'}\nWAF: {', '.join(w['name'] for w in wafs) if wafs else '未检测到'}")
    except urllib.error.HTTPError as e:
        return _result("native_http_fingerprint", url, True,
                       data={"url": url, "status_code": e.code, "headers": dict(e.headers)},
                       raw=f"HTTP {e.code}\n{dict(e.headers)}")
    except Exception as e:
        return _result("native_http_fingerprint", url, False, error=str(e))

def native_http_headers(url: str, timeout: float = 10) -> Dict[str, Any]:
    """检测HTTP安全响应头配置（增强版：15+安全头、信息泄露头、配置质量评估）"""
    if not url.startswith("http"):
        url = "http://" + url
    security_headers = {
        "strict-transport-security": {"desc": "HSTS强制HTTPS", "recommended": "max-age>=31536000", "weight": 15},
        "content-security-policy": {"desc": "内容安全策略", "recommended": "配置合理的CSP", "weight": 15},
        "x-frame-options": {"desc": "防点击劫持", "recommended": "DENY或SAMEORIGIN", "weight": 10},
        "x-content-type-options": {"desc": "MIME类型嗅探防护", "recommended": "nosniff", "weight": 10},
        "referrer-policy": {"desc": "Referrer策略", "recommended": "strict-origin-when-cross-origin", "weight": 5},
        "permissions-policy": {"desc": "权限策略", "recommended": "限制camera/microphone等", "weight": 10},
        "cross-origin-opener-policy": {"desc": "跨域打开者策略", "recommended": "same-origin", "weight": 5},
        "cross-origin-embedder-policy": {"desc": "跨域嵌入策略", "recommended": "require-corp", "weight": 5},
        "cross-origin-resource-policy": {"desc": "跨域资源策略", "recommended": "same-origin", "weight": 5},
        "x-xss-protection": {"desc": "XSS过滤（旧）", "recommended": "1; mode=block", "weight": 3},
        "expect-ct": {"desc": "证书透明度强制", "recommended": "max-age, enforce", "weight": 3},
        "x-download-options": {"desc": "IE下载选项", "recommended": "noopen", "weight": 2},
        "x-dns-prefetch-control": {"desc": "DNS预取控制", "recommended": "off", "weight": 2},
        "access-control-allow-origin": {"desc": "CORS跨域配置", "recommended": "严格限制Origin", "weight": 8},
        "access-control-allow-credentials": {"desc": "CORS凭证配置", "recommended": "谨慎使用true", "weight": 5},
    }
    # 信息泄露头
    info_leak_headers = [
        "server", "x-powered-by", "x-aspnet-version", "x-aspnetmvc-version",
        "x-drupal-cache", "x-generator", "x-note", "x-server", "x-host",
        "x-node", "x-backend-server", "x-served-by", "x-cache", "x-cache-hits",
        "x-amz-cf-id", "x-amz-request-id", "x-amz-id-2", "x-served-from",
        "x-varnish", "x-fastly-request-id", "x-cdn", "x-edge-location",
    ]
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (MrHua Scanner/2.0)"})
        resp = urllib.request.urlopen(req, timeout=timeout)
        headers = {k.lower(): v for k, v in resp.headers.items()}
        results = []
        missing = []
        total_weight = 0
        earned_weight = 0
        config_issues = []
        for hdr, info in security_headers.items():
            present = hdr in headers
            val = headers.get(hdr, "")
            total_weight += info["weight"]
            if present:
                earned_weight += info["weight"]
            # 配置质量评估
            if present and val:
                val_lower = val.lower()
                if hdr == "strict-transport-security":
                    if "max-age" not in val_lower:
                        config_issues.append("HSTS缺少max-age指令")
                    else:
                        match = re.search(r"max-age=(\d+)", val_lower)
                        if match and int(match.group(1)) < 31536000:
                            config_issues.append(f"HSTS max-age={match.group(1)}秒，建议至少31536000秒(1年)")
                    if "includesubdomains" not in val_lower:
                        config_issues.append("HSTS缺少includeSubDomains指令")
                elif hdr == "content-security-policy":
                    if "unsafe-inline" in val_lower:
                        config_issues.append("CSP包含unsafe-inline，降低XSS防护")
                    if "unsafe-eval" in val_lower:
                        config_issues.append("CSP包含unsafe-eval，允许eval执行")
                    if "default-src" not in val_lower:
                        config_issues.append("CSP缺少default-src回退策略")
                elif hdr == "x-frame-options":
                    if val_lower not in ("deny", "sameorigin"):
                        config_issues.append(f"X-Frame-Options值为'{val}'，建议DENY或SAMEORIGIN")
                elif hdr == "x-content-type-options":
                    if val_lower != "nosniff":
                        config_issues.append(f"X-Content-Type-Options值为'{val}'，建议nosniff")
                elif hdr == "access-control-allow-origin":
                    if val == "*":
                        config_issues.append("ACAO设为*，允许任意域跨域访问")
                    elif "null" in val_lower:
                        config_issues.append("ACAO允许null Origin，可被iframe沙箱利用")
            status = "✅" if present else "❌"
            results.append({"header": hdr, "present": present, "value": val,
                            "description": info["desc"], "recommended": info["recommended"],
                            "status_icon": status, "weight": info["weight"]})
            if not present:
                missing.append(hdr)
        # 信息泄露头检测
        info_leaks = []
        for h in info_leak_headers:
            if h in headers:
                info_leaks.append({"header": h, "value": headers[h][:100]})
        # 计算评分
        score = int((earned_weight / total_weight) * 100) if total_weight > 0 else 0
        if score >= 80:
            grade = "A (优秀)"
        elif score >= 60:
            grade = "B (良好)"
        elif score >= 40:
            grade = "C (一般)"
        elif score >= 20:
            grade = "D (较差)"
        else:
            grade = "F (危险)"
        high_risk_missing = [m for m in missing if security_headers.get(m, {}).get("weight", 0) >= 10]
        raw_lines = [f"安全头评分: {score}/100 ({grade})", f"已配置: {len(results)-len(missing)}/{len(security_headers)}", ""]
        for r in results:
            raw_lines.append(f"{r['status_icon']} {r['header']}: {r['value'] or '(缺失)'}")
        if config_issues:
            raw_lines.append("\n配置问题:")
            for issue in config_issues:
                raw_lines.append(f"  ⚠️ {issue}")
        if info_leaks:
            raw_lines.append(f"\n信息泄露头: {len(info_leaks)}个")
            for leak in info_leaks[:10]:
                raw_lines.append(f"  ℹ️ {leak['header']}: {leak['value']}")
        return _result("http_headers", url, True,
                       data={"url": url, "status_code": resp.status, "headers": dict(resp.headers),
                             "security_checks": results, "missing": missing, "score": score,
                             "grade": grade, "config_issues": config_issues,
                             "info_leak_headers": info_leaks, "high_risk_missing": high_risk_missing},
                       raw="\n".join(raw_lines))
    except Exception as e:
        return _result("http_headers", url, False, error=str(e))

def native_robots_scanner(url: str, timeout: float = 10) -> Dict[str, Any]:
    """扫描robots.txt和sitemap.xml，提取隐藏路径"""
    if not url.startswith("http"):
        url = "http://" + url
    from urllib.parse import urlparse
    parsed = urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}"
    findings = {"robots_txt": None, "sitemap": [], "disallowed": [], "interesting": []}
    raw_lines = []
    try:
        # robots.txt —— 目标没有 robots.txt（404/403）是常态，不应算作扫描失败
        try:
            req = urllib.request.Request(base + "/robots.txt",
                                         headers={"User-Agent": "Mozilla/5.0 (MrHua Scanner)"})
            resp = urllib.request.urlopen(req, timeout=timeout)
            robots_content = resp.read().decode("utf-8", errors="replace")
            findings["robots_txt"] = robots_content
            raw_lines.append("=== robots.txt ===")
            for line in robots_content.splitlines():
                line = line.strip()
                raw_lines.append(line)
                low = line.lower()
                if low.startswith("disallow:"):
                    path = line.split(":", 1)[1].strip()
                    if path and path != "/":
                        findings["disallowed"].append(path)
                elif low.startswith("sitemap:"):
                    findings["sitemap"].append(line.split(":", 1)[1].strip())
        except urllib.error.HTTPError as _rho:
            findings["robots_txt"] = None
            raw_lines.append(f"=== robots.txt: HTTP {_rho.code}（该站没有 robots.txt）===")
        # sitemap.xml
        try:
            req2 = urllib.request.Request(base + "/sitemap.xml",
                                          headers={"User-Agent": "Mozilla/5.0 (MrHua Scanner)"})
            resp2 = urllib.request.urlopen(req2, timeout=timeout)
            sm_content = resp2.read().decode("utf-8", errors="replace")
            urls = re.findall(r"<loc>(.*?)</loc>", sm_content, re.IGNORECASE)
            findings["sitemap"].extend(urls)
            raw_lines.append(f"\n=== sitemap.xml ({len(urls)} URLs) ===")
            for u in urls[:50]:
                raw_lines.append(u)
            if len(urls) > 50:
                raw_lines.append(f"... 还有 {len(urls)-50} 条")
        except Exception:
            pass
        # 标记有趣的路径
        interesting_kw = ["admin", "backup", "config", "secret", "private", "test",
                          "debug", "internal", "api", "upload", "tmp", "old"]
        for path in findings["disallowed"]:
            if any(kw in path.lower() for kw in interesting_kw):
                findings["interesting"].append(path)
        return _result("robots_scanner", url, True, data=findings, raw="\n".join(raw_lines))
    except Exception as e:
        return _result("robots_scanner", url, False, error=str(e))
