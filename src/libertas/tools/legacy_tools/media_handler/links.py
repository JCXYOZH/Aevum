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


def check_link_health(url: str, timeout: int = 8, method: str = "HEAD") -> Dict:
    """检查链接健康状态

    返回：alive, status, final_url, redirect_chain, content_type, response_time
    """
    import requests

    result = {
        "url": url, "alive": False, "status": 0,
        "final_url": url, "redirect_chain": [],
        "content_type": "", "response_time": 0, "error": ""
    }

    start = time.time()
    try:
        if method == "HEAD":
            resp = requests.head(url, timeout=(4, timeout), allow_redirects=True,
                                headers={"User-Agent": _UA}, verify=False)
        else:
            resp = requests.get(url, timeout=(4, timeout), allow_redirects=True,
                               headers={"User-Agent": _UA}, verify=False, stream=True)

        result["response_time"] = round(time.time() - start, 3)
        result["status"] = resp.status_code
        result["final_url"] = resp.url
        result["content_type"] = resp.headers.get("Content-Type", "")
        result["alive"] = resp.status_code < 400

        # 记录重定向链
        if resp.history:
            result["redirect_chain"] = [
                {"url": r.url, "status": r.status_code}
                for r in resp.history
            ]

        if method != "HEAD":
            resp.close()

    except requests.exceptions.SSLError:
        result["error"] = "SSL证书错误"
        result["response_time"] = round(time.time() - start, 3)
    except requests.exceptions.ConnectionError:
        result["error"] = "无法连接"
        result["response_time"] = round(time.time() - start, 3)
    except requests.exceptions.Timeout:
        result["error"] = "连接超时"
        result["response_time"] = round(time.time() - start, 3)
    except Exception as e:
        result["error"] = str(e)[:200]
        result["response_time"] = round(time.time() - start, 3)

    return result

def repair_link(url: str, timeout: int = 8) -> Dict:
    """尝试修复失效链接

    修复策略：
    1. http → https 升级
    2. 添加/移除 www
    3. 移除/添加尾部斜杠
    4. 移除fragment
    5. Wayback Machine 查找快照
    """
    import requests

    result = {"original_url": url, "fixed": False, "fixed_url": "",
              "method": "", "alternatives": [], "archive_url": ""}

    parsed = urllib.parse.urlparse(url)
    candidates = []

    # 1. http → https
    if parsed.scheme == "http":
        candidates.append(("https升级", url.replace("http://", "https://", 1)))

    # 2. www 变体
    host = parsed.hostname or ""
    if host.startswith("www."):
        candidates.append(("移除www",
            url.replace(f"://www.{host[4:]}", f"://{host[4:]}", 1)))
    else:
        candidates.append(("添加www",
            url.replace(f"://{host}", f"://www.{host}", 1)))

    # 3. 尾部斜杠
    if not parsed.path.endswith("/") and "." not in parsed.path.split("/")[-1]:
        candidates.append(("添加斜杠", url + "/"))
    elif parsed.path.endswith("/") and parsed.path != "/":
        candidates.append(("移除斜杠", url.rstrip("/")))

    # 4. 移除fragment
    if parsed.fragment:
        candidates.append(("移除锚点", url.split("#")[0]))

    # 5. 移除常见跟踪参数
    if parsed.query:
        params = urllib.parse.parse_qs(parsed.query)
        clean_params = {k: v for k, v in params.items()
                       if not k.lower().startswith(("utm_", "ref", "fbclid", "gclid", "spm"))}
        if clean_params != params:
            clean_query = urllib.parse.urlencode(clean_params, doseq=True)
            candidates.append(("清理跟踪参数",
                urllib.parse.urlunparse(parsed._replace(query=clean_query))))

    # 尝试每个候选
    for method, candidate in candidates:
        if candidate == url:
            continue
        health = check_link_health(candidate, timeout=timeout)
        result["alternatives"].append({
            "url": candidate, "method": method,
            "alive": health["alive"], "status": health["status"]
        })
        if health["alive"]:
            result["fixed"] = True
            result["fixed_url"] = candidate
            result["method"] = method
            return result

    # 6. Wayback Machine 查找
    try:
        avail_url = "https://archive.org/wayback/available?url=" + urllib.parse.quote(url, safe='')
        resp = requests.get(avail_url, timeout=6,
                           headers={"User-Agent": _UA},
                           proxies={"http": None, "https": None})
        if resp.status_code == 200:
            data = resp.json()
            snap = data.get("archived_snapshots", {}).get("closest", {})
            if snap.get("available") and snap.get("url"):
                result["archive_url"] = snap["url"]
                result["alternatives"].append({
                    "url": snap["url"], "method": "Wayback Machine存档",
                    "alive": True, "status": 200
                })
    except Exception:
        pass

    return result

def batch_check_links(urls: List[str], timeout: int = 6, max_workers: int = 10) -> List[Dict]:
    """批量检查链接健康状态（并行）"""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    results = [None] * len(urls)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(check_link_health, url, timeout): i
            for i, url in enumerate(urls)
        }
        for future in as_completed(future_map):
            idx = future_map[future]
            try:
                results[idx] = future.result()
            except Exception as e:
                results[idx] = {"url": urls[idx], "alive": False, "error": str(e)[:200]}

    return results
