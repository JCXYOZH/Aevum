"""搜索编排器（SearchOrchestrator）

统一管理多引擎并行搜索、结果合并、容错重试。
解决单引擎失败/超时导致搜索不可用的问题。

策略：
1. 并行发起多个搜索引擎请求（线程池）
2. 谁先成功且结果足够就用谁，其他引擎结果作为补充
3. 结果去重（按URL标准化）
4. 全部失败时尝试 Wikipedia API + DuckDuckGo Instant Answer
5. 硬超时保护，不卡住主流程
"""

from __future__ import annotations

import re
import time
import logging

ENGINE_PRIORITY = [
    "bing",            # 综合质量最好，中文+dork语法支持最全
    "ddg_html",        # DuckDuckGo HTML版，反爬最弱，中文也不错
    "mojeek",          # 独立引擎，无反爬
    "duckduckgo",
    "google",
    "brave",
    "yahoo",
    "qwant",
    "ecosia",
    "startpage",
    "yandex",
    "wikipedia",
    "baidu",           # 百度放最后：中文拆词问题严重（"菜鸟教程"→"菜"→菜谱）
]

FAST_ENGINES = ["bing", "ddg_html", "mojeek"]

ENGINE_TIMEOUT = 3.0

TOTAL_TIMEOUT = 8.0

MIN_RESULTS = 5
