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
from .constants import *


def _clean_url(url: str) -> str:
    """清理URL中的空格、换行、异常字符。"""
    if not url:
        return ""
    # 去除空白
    url = url.strip()
    # URL内部不应该有空格（显示时可能被插入换行空格）
    url = re.sub(r'\s+', '', url)
    # 修复被拆分的域名： baidu/ .com → baidu.com
    url = re.sub(r'/\.([a-z]{2,})', r'.\1', url)
    return url

def _is_valid_url(url: str) -> bool:
    """基本URL有效性检查。"""
    if not url or not isinstance(url, str):
        return False
    if not url.startswith(("http://", "https://")):
        return False
    # 域名中不应该有空格
    if ' ' in url:
        return False
    # 域名至少包含一个点
    from urllib.parse import urlparse
    try:
        parsed = urlparse(url)
        if '.' not in parsed.netloc:
            return False
        return True
    except Exception:
        return False

def _clean_results_urls(results: List[Dict]) -> List[Dict]:
    """清理所有结果中的URL，移除无效结果。"""
    cleaned = []
    for r in results:
        if r.get("error"):
            cleaned.append(r)
            continue
        url = _clean_url(r.get("url", ""))
        if _is_valid_url(url):
            r["url"] = url
            cleaned.append(r)
    return cleaned
