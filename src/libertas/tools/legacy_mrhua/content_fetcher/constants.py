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


# 浏览器UA列表
USER_AGENTS = [
    # Chrome on macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    # Firefox on macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
    # Safari on macOS
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    # Edge on Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    # Chrome on Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
]

# 文本代理服务（将网页转为干净文本）
TEXT_PROXIES = [
    "https://r.jina.ai/{url}",          # Jina AI Reader，返回Markdown文本
    "https://api.allorigins.win/raw?url={url}",  # CORS代理
    "https://corsproxy.io/?{url}",       # CORS代理
]

# 缓存服务
CACHE_SERVICES = [
    "https://web.archive.org/web/2025/{url}",
    "https://web.archive.org/web/2024/{url}",
    "https://webcache.googleusercontent.com/search?q=cache:{url}",
]


# ==================== 抓取时间预算 ====================
# 抓不到的页面往往表现为"卡住"：curl/httpx 的 connect 超时、Wayback/Cache 的硬编码
# 超时、socket 的空闲等待各自独立，串行叠加后会远超调用方给的 timeout（实测可达
# 3~7 倍）。这里给 enhanced_fetch / fetch_with_fallback 建立同一条绝对 deadline，
# 把每一步网络等待都收敛到剩余预算内；helper 与 web_engine 的
# _split_timeout / _remaining_budget 同源，下限复用其 _MIN_TIMEOUT，避免两套口径。
_BUDGET_HELPERS = None
