"""
web_engine.py — 本地 Web 访问引擎（控制平面）

职责：
- 在模型调用之前完成所有网络访问（搜索、抓取）
- 模型只拿到结果，不参与"是否搜索"的决策
- 多层抓取策略：Playwright 真实浏览器 → requests 多引擎轮换 → Wayback Machine → 本地代理
- 永不返回空：即使所有页面抓取失败，也返回标题+摘要
- 进度回调：每个步骤都通知前端
- 结果缓存：避免重复搜索
"""

import os
import re
import json
import time
import hashlib
import logging
import urllib.parse
from typing import List, Dict, Optional, Callable

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

# Playwright 可选
try:
    from playwright.sync_api import sync_playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

from ..web_search import (
    web_search, fetch_page_content, search_and_summarize,
    get_browser_headers, set_browser_engine, set_search_engine,
    BROWSER_PRESETS, SEARCH_ENGINES, SEARCH_BACKENDS
)
from .constants import *
from .budget import *
from .cache import *


def _remaining_budget(deadline: Optional[float]) -> float:
    """剩余时间预算（秒）。deadline 为 None 表示不设预算，返回正无穷。"""
    if deadline is None:
        return float("inf")
    return deadline - time.time()

def _within_sleep(seconds: float, deadline: Optional[float]) -> None:
    """固定等待也收敛到剩余预算内；不设 deadline 时保持原行为。"""
    if deadline is None:
        time.sleep(seconds)
        return
    pause = min(seconds, deadline - time.time())
    if pause > 0:
        time.sleep(pause)

def _within_timeout_ms(ms: int, deadline: Optional[float]) -> int:
    """毫秒级超时收敛到剩余预算内；不设 deadline 时原样返回。"""
    if deadline is None:
        return ms
    left = deadline - time.time()
    if left <= 0:
        return 1
    return max(1, int(min(ms / 1000.0, left) * 1000))

def _split_timeout(connect_cap: float, read_cap: float, remaining: float):
    """把 (连接上限, 读取上限) 收敛到剩余预算内，保证两段之和不超过剩余时间。

    预算充裕时原样返回；不足时按比例缩放，避免"连接 8s + 读取 20s"这类
    单次请求就吃掉整个预算的情况。
    """
    if remaining >= connect_cap + read_cap:
        return (connect_cap, read_cap)
    if remaining <= 0:
        return (_MIN_TIMEOUT, _MIN_TIMEOUT)
    scale = remaining / (connect_cap + read_cap)
    return (max(_MIN_TIMEOUT, connect_cap * scale),
            max(_MIN_TIMEOUT, read_cap * scale))

def _within_timeout(cap: float, remaining: float):
    """单次请求超时收敛到剩余预算内（保持 requests 的标量语义）。"""
    return _split_timeout(cap, cap, remaining)

def _call_within_budget(func, budget: float, *args, **kwargs):
    """在守护线程里调用 func，最多等待 budget 秒，超时即放弃等待并返回 None。

    通用兜底：用于约束"自身耗时不接受调用方预算"的下游。注意它超时后会放弃等待，
    而被放弃的调用仍在后台线程里继续运行——若该下游会回调 progress_cb，回调就可能
    晚于调用方返回（进度乱序）。因此应优先让下游自己遵守 deadline，本 helper 只
    作为最后手段。robust_fetch 现已不再使用它（enhanced_fetch 自身按 deadline 收敛）。
    """
    box = {}

    def _run():
        try:
            box["value"] = func(*args, **kwargs)
        except BaseException as exc:  # 下游异常不应冒泡到抓取主流程
            logger.debug(f"预算内调用下游失败 {getattr(func, '__name__', func)}: {exc}")

    worker = _threading_mod.Thread(target=_run, daemon=True)
    worker.start()
    worker.join(timeout=max(0.1, budget))
    if worker.is_alive():
        logger.debug(f"下游调用超出预算 {budget:.1f}s，放弃等待: {getattr(func, '__name__', func)}")
        return None
    return box.get("value")
