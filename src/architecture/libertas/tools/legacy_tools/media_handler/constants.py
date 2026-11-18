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

logger = logging.getLogger(__name__)

# 视频文件扩展名
VIDEO_EXTENSIONS = {
    '.mp4', '.webm', '.ogg', '.ogv', '.mov', '.avi', '.mkv',
    '.flv', '.wmv', '.m4v', '.mpg', '.mpeg', '.3gp', '.ts',
}

# 音频文件扩展名
AUDIO_EXTENSIONS = {'.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a', '.wma'}

# HLS/DASH
HLS_EXTENSIONS = {'.m3u8'}
DASH_EXTENSIONS = {'.mpd'}

# 视频MIME类型
VIDEO_MIME_TYPES = {
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
    'video/x-msvideo', 'video/x-matroska', 'video/x-flv',
    'video/mp2t', 'application/vnd.apple.mpegurl', 'application/x-mpegurl',
}

# 浏览器UA
_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

# SSL容错上下文
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE
