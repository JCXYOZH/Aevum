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


def enhanced_fetch(url: str, max_chars: int = 5000, timeout: int = 20,
                   progress_cb: Optional[Callable] = None) -> Dict:
    """增强抓取：在常规方法失败后，使用多种安全工具策略。

    策略按速度和成功率排序，并行竞速：
    1. curl HTTP/2（不同TLS指纹）
    2. httpx HTTP/2（另一种客户端）
    3. 文本代理（r.jina.ai等）
    4. Wayback缓存
    5. 原始socket

    返回与 robust_fetch 相同格式:
        {"title": str, "url": str, "content": str, "source": str}

    整个函数受调用方 timeout 约束：内部所有策略共享同一条绝对 deadline，
    到点即返回失败结构，不会带着仍在跑的慢策略继续拖住调用方。
    """
    def _notify(step, **kw):
        if progress_cb:
            try:
                progress_cb(step, **kw)
            except Exception:
                pass

    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    _notify("enhanced_fetch_start", url=url)

    # 超时下限保护：0 或负数会让 as_completed 立即超时、子进程被瞬间杀掉
    timeout = max(1, int(timeout))
    # 本次调用所有策略共享的绝对截止时间戳（原来各策略各用自己的超时，串起来是数倍）
    deadline = time.time() + timeout

    strategies = [
        ("curl", _fetch_with_curl, timeout),
        ("httpx", _fetch_with_httpx, timeout),
        ("text_proxy", _fetch_with_text_proxy, timeout),
        ("cache", _fetch_with_cache, timeout),
        ("raw_socket", _fetch_with_raw_socket, min(timeout, 10)),
    ]

    # 第一波（3 个轻量策略并行竞速）与第二波（缓存/原始socket）共享同一条 deadline。
    # 预算充裕时为第二波留一小段，否则竞速会把预算吃光、回退策略永远轮不上；
    # 预算紧张时不再预留，整段都给竞速。
    left = _left(deadline)
    reserve = min(2.0, left * 0.25) if left > 3.0 else 0.0
    race_budget = max(0.5, left - reserve)

    # 第一波：并行竞速前3个策略
    # 注意：as_completed(timeout=...) 到点会抛 TimeoutError，必须就地兜住——
    # 抓不到页面是常态，本函数的对外契约是"永远返回结果结构体、绝不抛异常"。
    # 竞速预算取剩余预算（原来是 timeout+5，会让整体耗时远超调用方的 timeout）。
    executor = ThreadPoolExecutor(max_workers=3)
    try:
        future_map = {}
        for name, fn, to in strategies[:3]:
            future = executor.submit(fn, url, to, deadline)
            future_map[future] = name

        try:
            for future in as_completed(future_map, timeout=race_budget):
                name = future_map[future]
                try:
                    result = future.result(timeout=2)
                    if result and result.get("content"):
                        _notify("enhanced_fetch_success", url=url,
                                method=name, source=result.get("source", name))
                        if len(result["content"]) > max_chars:
                            result["content"] = result["content"][:max_chars] + "..."
                        return result
                except Exception:
                    continue
        except FuturesTimeoutError:
            # 有策略超出竞速预算：已完成的结果上面已收走，未完成的按"该策略失败"处理，
            # 继续走第二波，不让 TimeoutError 冒泡出去
            _notify("enhanced_fetch_timeout", url=url)
    finally:
        # 各策略自身已按 deadline 收敛，这里不再等待慢策略，避免把调用方一起拖住；
        # 策略内部不回调 progress_cb，因此函数返回后不会有"迟到的进度回调"。
        executor.shutdown(wait=False, cancel_futures=True)

    # 第二波：缓存和原始socket（预算已用尽则直接跳过，不再发起新的网络请求）
    for name, fn, to in strategies[3:]:
        if _left(deadline) <= 0.5:
            break
        try:
            _notify("enhanced_fetching", url=url, method=name)
            result = fn(url, to, deadline)
            if result and result.get("content"):
                _notify("enhanced_fetch_success", url=url,
                        method=name, source=result.get("source", name))
                if len(result["content"]) > max_chars:
                    result["content"] = result["content"][:max_chars] + "..."
                return result
        except Exception:
            continue

    _notify("enhanced_fetch_failed", url=url)
    return {"title": url, "url": url, "content": "",
            "error": "所有增强抓取策略均失败", "source": "none"}

def fetch_with_fallback(url: str, max_chars: int = 5000, timeout: int = 20,
                        progress_cb: Optional[Callable] = None) -> Dict:
    """完整抓取流程：常规方法 → 增强方法。

    先尝试 web_engine.robust_fetch（Playwright + requests），
    失败后使用 enhanced_fetch（curl + httpx + 代理 + 缓存 + socket）。

    两个阶段共享同一条绝对 deadline：常规抓取用掉多少，增强抓取就只拿剩下的，
    保证整体耗时不超过调用方给的 timeout。
    """
    def _notify(step, **kw):
        if progress_cb:
            try:
                progress_cb(step, **kw)
            except Exception:
                pass

    timeout = max(1, int(timeout))
    deadline = time.time() + timeout

    # 第一阶段：常规抓取（预算取剩余值）
    try:
        from .web_engine import robust_fetch
        result = robust_fetch(url, max_chars=max_chars,
                              timeout=max(1, int(_left(deadline))),
                              progress_cb=progress_cb)
        if result.get("content") and len(result["content"].strip()) >= 50:
            return result
    except Exception as e:
        logger.debug(f"常规抓取失败，进入增强抓取: {e}")

    # 第二阶段：增强抓取
    # enhanced_fetch 自身已收敛异常，这里再兜一层，保证对外契约与第一阶段一致：
    # 失败返回带 error 的结果结构，绝不向上抛异常
    left = _left(deadline)
    if left <= 0.5:
        # 预算已在第一阶段用完，不再启动增强抓取（否则必然越预算）
        _notify("enhanced_fetch_failed", url=url)
        return {"title": url, "url": url, "content": "",
                "error": f"抓取超时（时间预算 {timeout}s 已用尽）", "source": "none"}
    _notify("enhanced_fetch_start", url=url)
    try:
        return enhanced_fetch(url, max_chars=max_chars, timeout=max(1, int(left)),
                              progress_cb=progress_cb)
    except Exception as e:
        logger.warning(f"增强抓取异常: {e}")
        return {"title": url, "url": url, "content": "",
                "error": f"增强抓取失败: {e}", "source": "none"}
