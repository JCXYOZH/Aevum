"""增强内容抓取器（EnhancedContentFetcher）

解决"DNS能解析、TCP能连上、证书有效，但页面内容抓不到"的问题。
这类问题通常由以下原因导致：
1. TLS指纹识别（JA3）—— Python requests 的TLS指纹被反爬识别
2. HTTP/2 强制要求
3. 特定的Header/Cookie/Referer验证
4. JavaScript渲染（Playwright处理）
5. IP封锁或地理限制

本模块提供以下额外策略（在 requests/Playwright 失败后使用）：
- 策略A: curl 子进程（不同TLS指纹 + HTTP/2 + 压缩）
- 策略B: httpx HTTP/2 客户端（另一种TLS指纹）
- 策略C: 文本代理服务（r.jina.ai，返回干净文本）
- 策略D: CORS代理（corsproxy.io / allorigins.win）
- 策略E: 多缓存源（Wayback最新快照、Google Cache）
- 策略F: 原始socket HTTP/1.1请求（完全控制请求头）
"""

from __future__ import annotations

import re
import ssl
import json
import time
import socket
import logging
import subprocess
import urllib.parse
from typing import Dict, Optional, List, Callable, Any
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeoutError

logger = logging.getLogger(__name__)
from .constants import *


def _budget_helpers():
    """惰性取得 web_engine 的时间预算工具（避免模块级循环依赖）。"""
    global _BUDGET_HELPERS
    if _BUDGET_HELPERS is None:
        from .web_engine import _MIN_TIMEOUT, _remaining_budget, _split_timeout
        _BUDGET_HELPERS = (_MIN_TIMEOUT, _remaining_budget, _split_timeout)
    return _BUDGET_HELPERS

def _left(deadline: Optional[float]) -> float:
    """剩余预算（秒）；deadline 为 None 表示不设预算。"""
    if deadline is None:
        return float("inf")
    return deadline - time.time()

def _cap(cap: float, deadline: Optional[float]) -> float:
    """把单段等待上限收敛到剩余预算内（不设 deadline 时原样返回）。"""
    left = _left(deadline)
    if left == float("inf"):
        return cap
    min_timeout = _budget_helpers()[0]
    return max(min_timeout, min(cap, left))

def _cap_pair(connect_cap: float, read_cap: float, deadline: Optional[float]):
    """把 (连接上限, 读取上限) 收敛到剩余预算内，保证两段之和不超过剩余时间。"""
    left = _left(deadline)
    if left == float("inf"):
        return (connect_cap, read_cap)
    split_timeout = _budget_helpers()[2]
    return split_timeout(connect_cap, read_cap, left)

def _extract_text_from_html(html: str) -> str:
    """从HTML中提取正文文本"""
    if not html:
        return ""
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside",
                         "iframe", "noscript", "form", "button", "svg", "img",
                         "link", "meta"]):
            tag.decompose()
        title = soup.title.get_text(strip=True) if soup.title else ""
        text = soup.get_text(separator="\n", strip=True)
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        text = "\n".join(lines)
        text = re.sub(r'\n{3,}', '\n\n', text)
        if title and title not in text[:200]:
            text = f"{title}\n\n{text}"
        return text
    except Exception:
        # 无BeautifulSoup时简单去标签
        text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL|re.IGNORECASE)
        text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL|re.IGNORECASE)
        text = re.sub(r'<[^>]+>', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

def _fetch_with_curl(url: str, timeout: int = 15,
                     deadline: Optional[float] = None) -> Optional[Dict]:
    """策略A: 使用curl子进程抓取

    curl的TLS指纹(SecureTransport/LibreSSL)与Python requests不同，
    且支持HTTP/2、压缩、自动重定向，能绕过部分反爬。

    deadline: 绝对截止时间戳；给定后 --connect-timeout / --max-time 与子进程等待
              全部收敛到剩余预算内（原来固定 connect 5s + max-time timeout，
              预算不足时单次请求就会吃掉整个调用方的 timeout）。
    """
    if _left(deadline) <= 0:
        return None
    try:
        total = _cap(float(timeout), deadline)          # --max-time：整次请求上限
        connect = max(0.3, min(5.0, total))             # --connect-timeout ≤ 整体上限
        cmd = [
            "curl", "-sL",                    # silent + follow redirects
            "--max-time", f"{total:.2f}",
            "--connect-timeout", f"{connect:.2f}",
            "--compressed",                   # 自动处理gzip/deflate/br
            "-H", "User-Agent: " + USER_AGENTS[0],
            "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "-H", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
            "-H", "Accept-Encoding: gzip, deflate, br",
            "-H", "Cache-Control: no-cache",
            "-H", "Sec-Fetch-Dest: document",
            "-H", "Sec-Fetch-Mode: navigate",
            "-H", "Sec-Fetch-Site: none",
            "--http2",                        # 优先HTTP/2
            "-w", "\n__CURL_STATUS__%{http_code}__END__",  # 状态码
            url
        ]
        # 子进程等待只比 curl 自身的 --max-time 多留 0.5s 收尾余量
        proc = subprocess.run(cmd, capture_output=True, timeout=total + 0.5)
        output = proc.stdout.decode("utf-8", errors="replace")
        # 提取状态码
        status_match = re.search(r'__CURL_STATUS__(\d+)__END__', output)
        status_code = int(status_match.group(1)) if status_match else 0
        # 去掉状态码标记
        body = re.sub(r'\n?__CURL_STATUS__\d+__END__$', '', output)

        if status_code in (200, 301, 302) and len(body) > 200:
            text = _extract_text_from_html(body)
            if len(text.strip()) >= 50:
                title_match = re.search(r'<title[^>]*>(.*?)</title>', body, re.IGNORECASE|re.DOTALL)
                title = title_match.group(1).strip() if title_match else url
                return {"title": title, "url": url, "content": text,
                        "status": status_code, "source": "curl HTTP/2"}
    except FileNotFoundError:
        logger.debug("curl 不可用")
    except subprocess.TimeoutExpired:
        logger.debug(f"curl 超时: {url}")
    except Exception as e:
        logger.debug(f"curl 抓取失败: {e}")
    return None

def _fetch_with_httpx(url: str, timeout: int = 15,
                      deadline: Optional[float] = None) -> Optional[Dict]:
    """策略B: 使用httpx HTTP/2客户端

    httpx的HTTP/2实现有不同的TLS指纹和连接行为。

    deadline: 给定后总超时与 connect 超时都收敛到剩余预算内。
    """
    if _left(deadline) <= 0:
        return None
    try:
        import httpx
        headers = {
            "User-Agent": USER_AGENTS[1],  # Firefox UA
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "no-cache",
        }
        with httpx.Client(http2=True, follow_redirects=True, verify=False,
                         timeout=httpx.Timeout(_cap(float(timeout), deadline),
                                               connect=_cap(5.0, deadline))) as client:
            resp = client.get(url, headers=headers)
            if resp.status_code == 200 and len(resp.text) > 200:
                text = _extract_text_from_html(resp.text)
                if len(text.strip()) >= 50:
                    title_match = re.search(r'<title[^>]*>(.*?)</title>', resp.text, re.IGNORECASE|re.DOTALL)
                    title = title_match.group(1).strip() if title_match else url
                    return {"title": title, "url": url, "content": text,
                            "status": 200, "source": "httpx HTTP/2"}
    except ImportError:
        logger.debug("httpx 不可用")
    except Exception as e:
        logger.debug(f"httpx 抓取失败: {e}")
    return None

def _fetch_with_text_proxy(url: str, timeout: int = 15,
                           deadline: Optional[float] = None) -> Optional[Dict]:
    """策略C: 通过文本代理服务抓取

    r.jina.ai 返回干净的Markdown文本，能绕过大多数反爬。

    deadline: 给定后每个代理的请求超时取剩余预算，预算用尽即不再尝试下一个
              代理（原来 3 个代理各用一整个 timeout，最坏叠加 3 倍）。
    """
    try:
        import requests
        for proxy_template in TEXT_PROXIES:
            if _left(deadline) <= 0:
                break
            proxy_url = proxy_template.format(url=urllib.parse.quote(url, safe=''))
            try:
                resp = requests.get(
                    proxy_url, timeout=_cap(float(timeout), deadline),
                    headers={"User-Agent": USER_AGENTS[0]},
                    proxies={"http": None, "https": None}
                )
                if resp.status_code == 200 and len(resp.text) > 100:
                    text = resp.text
                    # Jina返回Markdown，直接用
                    if "jina.ai" in proxy_template or "r.jina" in proxy_url:
                        # 提取标题
                        title_match = re.search(r'^Title:\s*(.+)$', text, re.MULTILINE)
                        title = title_match.group(1).strip() if title_match else url
                        # 去掉Jina的元信息头
                        text = re.sub(r'^Title:.*$', '', text, flags=re.MULTILINE)
                        text = re.sub(r'^URL Source:.*$', '', text, flags=re.MULTILINE)
                        text = re.sub(r'^Markdown Content:.*$', '', text, flags=re.MULTILINE)
                        text = text.strip()
                    else:
                        title = url
                        text = _extract_text_from_html(text)
                    if len(text.strip()) >= 50:
                        return {"title": title, "url": url, "content": text[:8000],
                                "status": 200, "source": f"文本代理"}
            except Exception:
                continue
    except Exception as e:
        logger.debug(f"文本代理失败: {e}")
    return None

def _fetch_with_cache(url: str, timeout: int = 15,
                      deadline: Optional[float] = None) -> Optional[Dict]:
    """策略D: 通过缓存服务抓取（Wayback Machine最新快照）

    deadline: 给定后可用性查询（原来硬编码 8s）与快照下载共享同一剩余预算。
    """
    if _left(deadline) <= 0:
        return None
    try:
        import requests
        # Wayback Machine Availability API
        avail_url = "https://archive.org/wayback/available?url=" + urllib.parse.quote(url, safe='')
        resp = requests.get(avail_url, timeout=_cap(8.0, deadline),
                           headers={"User-Agent": USER_AGENTS[0]},
                           proxies={"http": None, "https": None})
        if resp.status_code == 200:
            data = resp.json()
            snap = data.get("archived_snapshots", {}).get("closest", {})
            if snap.get("available") and snap.get("url"):
                if _left(deadline) <= 0:
                    return None
                snap_url = snap["url"]
                resp2 = requests.get(snap_url, timeout=_cap(float(timeout), deadline),
                                    headers={"User-Agent": USER_AGENTS[0]},
                                    proxies={"http": None, "https": None})
                if resp2.status_code == 200 and len(resp2.text) > 200:
                    text = _extract_text_from_html(resp2.text)
                    # 移除Wayback工具栏注入
                    text = re.sub(r'^.*?Saved \d+ times.*?$', '', text, flags=re.MULTILINE)
                    if len(text.strip()) >= 50:
                        title_match = re.search(r'<title[^>]*>(.*?)</title>', resp2.text, re.IGNORECASE|re.DOTALL)
                        title = title_match.group(1).strip() if title_match else url
                        title = re.sub(r'^Web Archive.*?-\s*', '', title) or title
                        return {"title": title, "url": url, "content": text[:8000],
                                "status": 200, "source": "Wayback缓存"}
    except Exception as e:
        logger.debug(f"缓存抓取失败: {e}")
    return None

def _fetch_with_raw_socket(url: str, timeout: int = 10,
                           deadline: Optional[float] = None) -> Optional[Dict]:
    """策略E: 原始socket HTTP/1.1请求

    完全控制请求，不使用任何HTTP库，绕过库级别的指纹。
    只适用于HTTP（HTTPS需要SSL握手，但也支持）。

    deadline: 给定后 socket 超时取剩余预算，读取循环也会按剩余预算提前收敛
              （原来单个 recv 超时不会累加判断，对"慢速滴data"的站点可能一直读）。
    """
    if _left(deadline) <= 0:
        return None
    try:
        parsed = urllib.parse.urlparse(url)
        host = parsed.hostname
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query

        # 构建原始HTTP请求
        request_lines = [
            f"GET {path} HTTP/1.1",
            f"Host: {host}",
            f"User-Agent: {USER_AGENTS[0]}",
            "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding: identity",
            "Connection: close",
            "Cache-Control: no-cache",
            "", ""
        ]
        request_data = "\r\n".join(request_lines).encode("utf-8")

        # 建立连接
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(_cap(float(timeout), deadline))
        if parsed.scheme == "https":
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            sock = ctx.wrap_socket(sock, server_hostname=host)
        sock.connect((host, port))
        sock.sendall(request_data)

        # 读取响应
        chunks = []
        while True:
            if _left(deadline) <= 0:
                break
            try:
                data = sock.recv(65536)
                if not data:
                    break
                chunks.append(data)
            except socket.timeout:
                break
        sock.close()

        raw = b"".join(chunks)
        # 分离header和body
        header_end = raw.find(b"\r\n\r\n")
        if header_end == -1:
            return None
        header_raw = raw[:header_end].decode("utf-8", errors="replace")
        body = raw[header_end+4:]

        # 处理chunked transfer encoding
        if "transfer-encoding: chunked" in header_raw.lower():
            body = _decode_chunked(body)

        # 处理gzip
        if "content-encoding: gzip" in header_raw.lower():
            import gzip
            try:
                body = gzip.decompress(body)
            except Exception:
                pass
        elif "content-encoding: deflate" in header_raw.lower():
            import zlib
            try:
                body = zlib.decompress(body)
            except Exception:
                pass

        text = body.decode("utf-8", errors="replace")
        if len(text) > 200:
            content = _extract_text_from_html(text)
            if len(content.strip()) >= 50:
                title_match = re.search(r'<title[^>]*>(.*?)</title>', text, re.IGNORECASE|re.DOTALL)
                title = title_match.group(1).strip() if title_match else url
                return {"title": title, "url": url, "content": content[:8000],
                        "status": 200, "source": "原始socket"}
    except Exception as e:
        logger.debug(f"原始socket抓取失败: {e}")
    return None

def _decode_chunked(data: bytes) -> bytes:
    """解码chunked transfer encoding"""
    result = []
    pos = 0
    while pos < len(data):
        line_end = data.find(b"\r\n", pos)
        if line_end == -1:
            break
        size_str = data[pos:line_end].decode("utf-8", errors="replace").strip()
        try:
            chunk_size = int(size_str.split(";")[0], 16)
        except ValueError:
            break
        if chunk_size == 0:
            break
        chunk_start = line_end + 2
        chunk_end = chunk_start + chunk_size
        if chunk_end > len(data):
            break
        result.append(data[chunk_start:chunk_end])
        pos = chunk_end + 2
    return b"".join(result)
