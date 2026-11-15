"""
net_recon.py — 三层搜索架构 · 第一层：原生网络侦察（并行+超时容错）

即时（<2秒）获取目标的技术信息：
- DNS 解析（A/AAAA）
- HTTP 响应头和页面标题
- SSL/TLS 证书信息

三个任务并行执行，每个有独立超时，整体硬超时3秒。
任何步骤失败都不影响其他步骤，返回部分结果。
"""

import socket
import ssl
import time
import logging
import threading
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

# 整体硬超时（秒）
RECON_HARD_TIMEOUT = 3.0
# 单个任务超时
SINGLE_TIMEOUT = 2.5


def _safe_get(url, timeout=SINGLE_TIMEOUT, **kwargs):
    """禁用代理的安全GET"""
    proxies = {"http": None, "https": None}
    kwargs["proxies"] = proxies
    return requests.get(url, timeout=timeout, **kwargs)


def quick_dns(domain: str) -> Dict[str, Any]:
    """快速DNS解析：A/AAAA记录"""
    result = {"domain": domain, "ips": [], "error": None}
    try:
        infos = socket.getaddrinfo(domain, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
        seen = set()
        for info in infos:
            ip = info[4][0]
            if ip not in seen:
                seen.add(ip)
                result["ips"].append({"type": "AAAA" if ":" in ip else "A", "value": ip})
    except socket.gaierror as e:
        result["error"] = f"DNS解析失败"
    except Exception:
        result["error"] = "DNS查询异常"
    return result


def quick_http(url: str, timeout: float = SINGLE_TIMEOUT) -> Dict[str, Any]:
    """快速HTTP探测：状态码、响应头、页面标题"""
    result = {"url": url, "status": None, "title": "", "server": "", "content_type": "", "error": None}
    if not HAS_REQUESTS:
        result["error"] = "requests未安装"
        return result
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }
        resp = _safe_get(url, timeout=timeout, headers=headers, allow_redirects=True)
        result["status"] = resp.status_code
        result["url"] = resp.url
        result["server"] = resp.headers.get("Server", "")[:100]
        result["content_type"] = resp.headers.get("Content-Type", "")[:100]
        if "text/html" in result["content_type"] and HAS_BS4:
            if resp.encoding and resp.encoding.lower() in ("iso-8859-1", "ascii"):
                resp.encoding = resp.apparent_encoding or "utf-8"
            soup = BeautifulSoup(resp.text[:30000], "html.parser")
            if soup.title:
                result["title"] = soup.title.get_text(strip=True)[:200]
    except requests.exceptions.SSLError:
        if url.startswith("https://"):
            try:
                return quick_http("http://" + url[8:], timeout=timeout)
            except Exception:
                pass
        result["error"] = "SSL错误"
    except requests.exceptions.Timeout:
        result["error"] = "连接超时"
    except requests.exceptions.ConnectionError:
        result["error"] = "无法连接"
    except Exception:
        result["error"] = "请求失败"
    return result


def quick_ssl(domain: str, port: int = 443, timeout: float = SINGLE_TIMEOUT) -> Dict[str, Any]:
    """快速SSL证书信息"""
    result = {"domain": domain, "port": port, "issuer": "", "subject": "", "expires": "", "error": None}
    try:
        context = ssl.create_default_context()
        with socket.create_connection((domain, port), timeout=timeout) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                if cert:
                    issuer = dict(x[0] for x in cert.get("issuer", []))
                    subject = dict(x[0] for x in cert.get("subject", []))
                    result["issuer"] = (issuer.get("organizationName", "") or issuer.get("commonName", ""))[:100]
                    result["subject"] = subject.get("commonName", "")[:100]
                    result["expires"] = cert.get("notAfter", "")[:50]
    except ssl.SSLError:
        result["error"] = "SSL握手失败"
    except socket.timeout:
        result["error"] = "连接超时"
    except ConnectionRefusedError:
        result["error"] = "连接被拒绝"
    except OSError:
        result["error"] = "网络不可达"
    except Exception:
        result["error"] = "SSL查询失败"
    return result


def recon_url(url: str, include_whois: bool = False) -> Dict[str, Any]:
    """对URL执行快速侦察（Layer 1）。
    DNS、HTTP、SSL并行执行，整体硬超时3秒。
    任何步骤失败都返回部分结果，不抛异常。
    """
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    parsed = urllib.parse.urlparse(url)
    domain = parsed.netloc.split(":")[0]

    recon = {"url": url, "domain": domain, "dns": None, "http": None, "ssl": None, "whois": None}

    def _do_dns():
        recon["dns"] = quick_dns(domain)

    def _do_http():
        recon["http"] = quick_http(url)

    def _do_ssl():
        if url.startswith("https://"):
            recon["ssl"] = quick_ssl(domain, parsed.port or 443)

    # 并行执行DNS/HTTP/SSL
    threads = [
        threading.Thread(target=_do_dns, daemon=True),
        threading.Thread(target=_do_http, daemon=True),
    ]
    if url.startswith("https://"):
        threads.append(threading.Thread(target=_do_ssl, daemon=True))

    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=RECON_HARD_TIMEOUT)

    # 确保没有None（线程超时的情况）
    if recon["dns"] is None:
        recon["dns"] = {"domain": domain, "ips": [], "error": "超时"}
    if recon["http"] is None:
        recon["http"] = {"url": url, "status": None, "title": "", "server": "", "content_type": "", "error": "超时"}
    if recon["ssl"] is None and url.startswith("https://"):
        recon["ssl"] = {"domain": domain, "port": 443, "issuer": "", "subject": "", "expires": "", "error": "超时"}

    return recon


def format_recon(recon_data: Dict[str, Any]) -> str:
    """将侦察结果格式化为模型可读文本"""
    lines = []
    domain = recon_data.get("domain", "")
    url = recon_data.get("url", "")

    lines.append(f"【网络侦察: {url}】")

    dns = recon_data.get("dns") or {}
    if dns.get("ips"):
        ips = ", ".join(f"{r['value']}({r['type']})" for r in dns["ips"][:4])
        lines.append(f"DNS: {domain} → {ips}")
    elif dns.get("error"):
        lines.append(f"DNS: {dns['error']}")

    http_data = recon_data.get("http") or {}
    if http_data.get("status"):
        status = http_data["status"]
        title = http_data.get("title", "")
        server = http_data.get("server", "")
        parts = [f"HTTP {status}"]
        if title:
            parts.append(f"标题: {title}")
        if server:
            parts.append(f"服务器: {server}")
        lines.append(" | ".join(parts))
    elif http_data.get("error"):
        lines.append(f"HTTP: {http_data['error']}")

    ssl_data = recon_data.get("ssl")
    if ssl_data and not ssl_data.get("error"):
        issuer = ssl_data.get("issuer", "")
        expires = ssl_data.get("expires", "")
        if issuer:
            lines.append(f"SSL证书: {issuer}" + (f" (到期: {expires})" if expires else ""))
    elif ssl_data and ssl_data.get("error"):
        if ssl_data["error"] not in ("超时", "连接被拒绝"):
            lines.append(f"SSL: {ssl_data['error']}")

    return "\n".join(lines)
