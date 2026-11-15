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


def is_video_url(url: str) -> bool:
    """判断URL是否直接指向视频文件"""
    path = urllib.parse.urlparse(url).path.lower()
    return any(path.endswith(ext) for ext in VIDEO_EXTENSIONS | HLS_EXTENSIONS | DASH_EXTENSIONS)

def is_media_url(url: str) -> bool:
    """判断URL是否指向媒体文件（视频或音频）"""
    path = urllib.parse.urlparse(url).path.lower()
    return any(path.endswith(ext) for ext in VIDEO_EXTENSIONS | AUDIO_EXTENSIONS | HLS_EXTENSIONS | DASH_EXTENSIONS)

def detect_media_type(url: str, content_type: str = "") -> str:
    """检测媒体类型：video / audio / hls / dash / none"""
    ct = (content_type or "").lower()
    path = urllib.parse.urlparse(url).path.lower()

    if any(path.endswith(ext) for ext in HLS_EXTENSIONS) or 'mpegurl' in ct:
        return "hls"
    if any(path.endswith(ext) for ext in DASH_EXTENSIONS) or 'dash+xml' in ct:
        return "dash"
    if any(path.endswith(ext) for ext in VIDEO_EXTENSIONS) or ct.startswith('video/'):
        return "video"
    if any(path.endswith(ext) for ext in AUDIO_EXTENSIONS) or ct.startswith('audio/'):
        return "audio"
    return "none"

def extract_video_sources(html: str, base_url: str = "") -> List[Dict]:
    """从HTML页面中提取视频源

    提取：
    - <video src="...">
    - <video><source src="..."></video>
    - <a href="...mp4">
    - m3u8链接
    - 常见视频平台嵌入（iframe）
    """
    sources = []
    seen = set()

    if not html:
        return sources

    # <video src="..."> 和 <source src="...">
    for pattern in [
        r'<video[^>]+src=["\']([^"\']+)["\']',
        r'<source[^>]+src=["\']([^"\']+)["\']',
        r'<video[^>]+data-src=["\']([^"\']+)["\']',
        r'<source[^>]+data-src=["\']([^"\']+)["\']',
    ]:
        for m in re.finditer(pattern, html, re.IGNORECASE):
            src = m.group(1).strip()
            if src and not src.startswith(('data:', 'blob:')):
                abs_url = urllib.parse.urljoin(base_url, src)
                if abs_url not in seen:
                    seen.add(abs_url)
                    sources.append({"url": abs_url, "type": "html5", "referer": base_url})

    # 直接链接到视频文件
    for m in re.finditer(r'href=["\']([^"\']+\.(?:mp4|webm|ogg|mov|m3u8|flv|mkv)(?:\?[^"\']*)?)["\']',
                         html, re.IGNORECASE):
        src = m.group(1).strip()
        abs_url = urllib.parse.urljoin(base_url, src)
        if abs_url not in seen:
            seen.add(abs_url)
            sources.append({"url": abs_url, "type": "direct", "referer": base_url})

    # m3u8 流地址（在JS中）
    for m in re.finditer(r'["\']([^"\']*\.m3u8(?:\?[^"\']*)?)["\']', html, re.IGNORECASE):
        src = m.group(1).strip()
        if src.startswith('//'):
            src = 'https:' + src
        abs_url = urllib.parse.urljoin(base_url, src)
        if abs_url not in seen:
            seen.add(abs_url)
            sources.append({"url": abs_url, "type": "hls", "referer": base_url})

    # 视频平台嵌入
    for pattern in [
        r'<iframe[^>]+src=["\']([^"\']*(?:youtube\.com|youtu\.be|bilibili\.com|youku\.com|vimeo\.com)[^"\']*)["\']',
    ]:
        for m in re.finditer(pattern, html, re.IGNORECASE):
            src = m.group(1).strip()
            abs_url = urllib.parse.urljoin(base_url, src)
            if abs_url not in seen:
                seen.add(abs_url)
                sources.append({"url": abs_url, "type": "embed", "referer": base_url})

    return sources

def probe_media(url: str, timeout: int = 10) -> Dict:
    """使用ffprobe获取媒体元信息

    返回：duration, width, height, codec, bitrate, format, size
    """
    try:
        cmd = [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_format", "-show_streams",
            "-user_agent", _UA,
            url
        ]
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
        if proc.returncode != 0:
            return {"error": proc.stderr.decode('utf-8', errors='replace')[:200]}

        data = json.loads(proc.stdout.decode('utf-8', errors='replace'))
        fmt = data.get("format", {})
        streams = data.get("streams", [])

        video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
        audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

        result = {
            "duration": float(fmt.get("duration", 0)) if fmt.get("duration") else None,
            "size": int(fmt.get("size", 0)) if fmt.get("size") else None,
            "bitrate": int(fmt.get("bit_rate", 0)) if fmt.get("bit_rate") else None,
            "format_name": fmt.get("format_name", ""),
            "has_video": video_stream is not None,
            "has_audio": audio_stream is not None,
        }
        if video_stream:
            result.update({
                "width": video_stream.get("width"),
                "height": video_stream.get("height"),
                "video_codec": video_stream.get("codec_name"),
                "fps": eval(video_stream.get("r_frame_rate", "0/1")) if video_stream.get("r_frame_rate") else None,
            })
        if audio_stream:
            result.update({
                "audio_codec": audio_stream.get("codec_name"),
                "sample_rate": audio_stream.get("sample_rate"),
                "channels": audio_stream.get("channels"),
            })
        return result
    except FileNotFoundError:
        return {"error": "ffprobe 不可用"}
    except subprocess.TimeoutExpired:
        return {"error": "ffprobe 超时"}
    except Exception as e:
        return {"error": str(e)[:200]}

def check_media_headers(url: str, timeout: int = 8) -> Dict:
    """检查媒体URL的响应头，获取Content-Type、Content-Length、Range支持等

    不下载内容，只发HEAD请求（或带Range: bytes=0-0的GET）。
    """
    import requests

    result = {"url": url, "alive": False, "status": 0, "supports_range": False,
              "content_type": "", "content_length": 0, "final_url": url}

    try:
        # 先尝试HEAD
        resp = requests.head(url, timeout=(4, timeout), allow_redirects=True,
                            headers={"User-Agent": _UA}, verify=False)
        result["status"] = resp.status_code
        result["final_url"] = resp.url
        result["content_type"] = resp.headers.get("Content-Type", "")
        result["content_length"] = int(resp.headers.get("Content-Length", 0) or 0)
        result["supports_range"] = resp.headers.get("Accept-Ranges", "").lower() == "bytes"

        if resp.status_code == 200:
            result["alive"] = True
            return result

        # HEAD失败，用Range GET探测
        resp = requests.get(url, timeout=(4, timeout), allow_redirects=True,
                           headers={"User-Agent": _UA, "Range": "bytes=0-0"},
                           verify=False, stream=True)
        result["status"] = resp.status_code
        result["final_url"] = resp.url
        result["content_type"] = resp.headers.get("Content-Type", result["content_type"])
        result["content_length"] = int(resp.headers.get("Content-Length", 0) or 0)
        cr = resp.headers.get("Content-Range", "")
        if cr:
            result["supports_range"] = True
            total = cr.split("/")[-1]
            if total.isdigit():
                result["content_length"] = int(total)
        result["alive"] = resp.status_code in (200, 206)
        resp.close()
    except Exception as e:
        result["error"] = str(e)[:200]

    return result

def analyze_page_media(url: str, html: str = "", timeout: int = 15) -> Dict:
    """分析页面中的媒体内容

    返回：
    - direct_video: 页面本身是视频
    - video_sources: 提取到的视频源列表
    - media_info: 每个视频源的元信息
    - playable_url: 可直接播放的代理URL
    """
    import requests

    result = {
        "page_url": url,
        "is_direct_media": False,
        "media_type": "none",
        "sources": [],
        "recommendations": [],
    }

    # 检查URL本身是否是媒体
    media_type = detect_media_type(url)
    if media_type != "none":
        result["is_direct_media"] = True
        result["media_type"] = media_type
        headers_info = check_media_headers(url, timeout=timeout)
        result["source_info"] = headers_info
        if media_type in ("video", "audio"):
            probe = probe_media(url, timeout=timeout)
            result["probe"] = probe
        result["playable_url"] = f"/api/media/stream?url={urllib.parse.quote(url, safe='')}"
        return result

    # 如果没有HTML，尝试获取
    if not html:
        try:
            resp = requests.get(url, timeout=(4, timeout),
                               headers={"User-Agent": _UA, "Accept": "text/html,*/*"},
                               verify=False)
            if resp.status_code == 200:
                html = resp.text
        except Exception:
            pass

    if html:
        sources = extract_video_sources(html, base_url=url)
        result["sources"] = sources

        # 检查每个源
        for src in sources[:5]:  # 最多检查5个
            src_url = src["url"]
            if src["type"] == "embed":
                result["recommendations"].append({
                    "url": src_url,
                    "type": "embed",
                    "message": "嵌入视频平台，建议在内置浏览器中打开"
                })
                continue

            info = check_media_headers(src_url, timeout=6)
            src["info"] = info
            if info.get("alive"):
                src["playable_url"] = f"/api/media/stream?url={urllib.parse.quote(src_url, safe='')}"
                if src["type"] in ("video", "html5", "direct"):
                    probe = probe_media(src_url, timeout=8)
                    src["probe"] = probe

        if sources:
            result["recommendations"].append({
                "type": "play",
                "message": f"发现 {len(sources)} 个视频源",
                "sources": [{"url": s["url"], "type": s["type"],
                            "playable": s.get("info", {}).get("alive", False)}
                           for s in sources[:5]]
            })
        else:
            result["recommendations"].append({
                "type": "none",
                "message": "页面中未检测到视频源"
            })

    return result
