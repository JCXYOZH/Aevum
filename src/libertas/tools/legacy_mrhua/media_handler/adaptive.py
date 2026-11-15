"""媒体处理模块（MediaHandler）

解决三个问题：
1. 网页抓取超时 —— 自适应超时、连接池复用、流式提前终止
2. 无法直接播放视频 —— 视频源检测、ffprobe元信息、Range流式代理
3. 链接可能失效 —— 链接健康检查、自动修复、Wayback兜底

视频支持：
- 直接视频文件（mp4/webm/ogg/mov/avi/mkv）
- HLS流（m3u8）
- HTML页面中的<video>标签提取
- DASH流（mpd）
- 通过Range请求支持拖动进度条
"""

from __future__ import annotations

import re
import os
import ssl
import json
import time
import socket
import logging
import subprocess
import urllib.parse
from typing import Dict, Optional, List, Tuple, Any
from functools import lru_cache
from .constants import *


class AdaptiveFetcher:
    """自适应抓取器

    - 连接池复用（避免每次握手）
    - 自适应超时（根据响应速度动态调整）
    - 流式提前终止（拿到足够内容就断开）
    - 并行竞速
    """

    def __init__(self, pool_connections: int = 10, pool_maxsize: int = 20):
        self._session = None
        self._pool_connections = pool_connections
        self._pool_maxsize = pool_maxsize
        self._timing_history: Dict[str, List[float]] = {}  # host → 响应时间历史

    def _get_session(self):
        if self._session is None:
            import requests
            from requests.adapters import HTTPAdapter
            from urllib3.util.retry import Retry

            self._session = requests.Session()
            retry = Retry(total=2, backoff_factor=0.3,
                         status_forcelist=[500, 502, 503, 504])
            adapter = HTTPAdapter(
                pool_connections=self._pool_connections,
                pool_maxsize=self._pool_maxsize,
                max_retries=retry
            )
            self._session.mount("http://", adapter)
            self._session.mount("https://", adapter)
            self._session.headers.update({"User-Agent": _UA})
        return self._session

    def _adaptive_timeout(self, url: str, base_connect: float = 4.0,
                          base_read: float = 8.0) -> Tuple[float, float]:
        """根据历史响应时间自适应调整超时"""
        host = urllib.parse.urlparse(url).hostname or ""
        history = self._timing_history.get(host, [])
        if len(history) >= 3:
            avg = sum(history) / len(history)
            # 平均响应时间的2倍作为读超时，最小5秒最大20秒
            read_timeout = max(5.0, min(20.0, avg * 2))
            return (base_connect, read_timeout)
        return (base_connect, base_read)

    def _record_timing(self, url: str, elapsed: float):
        host = urllib.parse.urlparse(url).hostname or ""
        if host not in self._timing_history:
            self._timing_history[host] = []
        self._timing_history[host].append(elapsed)
        if len(self._timing_history[host]) > 10:
            self._timing_history[host] = self._timing_history[host][-10:]

    def fetch_text(self, url: str, max_chars: int = 5000,
                   timeout: Optional[float] = None,
                   early_terminate: bool = True) -> Dict:
        """抓取文本内容，支持流式提前终止

        early_terminate: 拿到max_chars字符后立即断开连接，不等待完整响应
        """
        import requests

        session = self._get_session()
        connect_timeout, read_timeout = (4.0, timeout or 10.0)
        if timeout is None:
            connect_timeout, read_timeout = self._adaptive_timeout(url)

        start = time.time()
        try:
            resp = self._session.get(url, timeout=(connect_timeout, read_timeout),
                              stream=early_terminate, allow_redirects=True, verify=False)
            resp.raise_for_status()

            if not early_terminate:
                content = resp.text
                self._record_timing(url, time.time() - start)
                if len(content) > max_chars:
                    content = content[:max_chars] + "..."
                return {"url": resp.url, "status": resp.status_code,
                        "content": content, "elapsed": time.time() - start}

            # 流式读取，提前终止
            chunks = []
            total = 0
            content_type = resp.headers.get("Content-Type", "")
            encoding = resp.encoding or "utf-8"

            for chunk in resp.iter_content(chunk_size=4096, decode_unicode=True):
                if chunk:
                    chunks.append(chunk)
                    total += len(chunk)
                    if total >= max_chars * 2:  # 多拿一些以应对HTML标签
                        break

            resp.close()
            elapsed = time.time() - start
            self._record_timing(url, elapsed)

            content = "".join(chunks)
            if len(content) > max_chars:
                content = content[:max_chars] + "..."

            return {"url": resp.url, "status": resp.status_code,
                    "content": content, "content_type": content_type,
                    "elapsed": elapsed, "early_terminated": total >= max_chars * 2}

        except requests.exceptions.Timeout:
            return {"url": url, "status": 0, "content": "", "error": "超时",
                    "elapsed": time.time() - start}
        except Exception as e:
            return {"url": url, "status": 0, "content": "", "error": str(e)[:200],
                    "elapsed": time.time() - start}

    def fetch_headers(self, url: str, timeout: float = 6.0) -> Dict:
        """只获取响应头（轻量级探测）"""
        import requests

        start = time.time()
        try:
            resp = self._session.head(url, timeout=(3.0, timeout), allow_redirects=True, verify=False)
            elapsed = time.time() - start
            self._record_timing(url, elapsed)
            return {"url": resp.url, "status": resp.status_code,
                    "headers": dict(resp.headers), "elapsed": elapsed,
                    "alive": resp.status_code < 400}
        except Exception as e:
            return {"url": url, "status": 0, "error": str(e)[:200],
                    "elapsed": time.time() - start, "alive": False}

    def close(self):
        if self._session:
            self._session.close()
            self._session = None


def get_adaptive_fetcher() -> AdaptiveFetcher:
    global _adaptive_fetcher
    if _adaptive_fetcher is None:
        _adaptive_fetcher = AdaptiveFetcher()
    return _adaptive_fetcher
