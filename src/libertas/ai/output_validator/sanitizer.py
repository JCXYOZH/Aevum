"""输出校验职责：sanitizer。"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from libertas.foundation.config import get_data_dir

from .models import ValidationResult
from .constants import _FILE_TAG_RE
from .constants import _KNOWN_CONTROL_TAGS
from .constants import _KNOWN_OFFICIAL_DOMAINS
from .constants import _SEARCH_TAG_RE
from .constants import _TOOL_TAG_RE
from .constants import _URL_RE

def _domain_match(url1: str, url2: str) -> bool:
    """检查两个URL是否同域名"""
    try:
        d1 = urlparse(url1).netloc.lower().lstrip("www.")
        d2 = urlparse(url2).netloc.lower().lstrip("www.")
        return d1 == d2 or d1.endswith(d2) or d2.endswith(d1)
    except Exception:
        return False

def _is_known_official_url(url: str) -> bool:
    """检查是否是已知官方文档URL"""
    try:
        domain = urlparse(url).netloc.lower().lstrip("www.")
        return any(domain == d or domain.endswith("." + d) for d in _KNOWN_OFFICIAL_DOMAINS)
    except Exception:
        return False

def strip_dsml_tags(text: str) -> Tuple[str, List[str]]:
    """从文本中剥离未知DSML标签，返回清理后的文本和标签列表"""
    full_tag_re = re.compile(r'<<<[A-Z_]+(?::[^>]*)?>>>')
    tags = []

    def _collect(m):
        tag_text = m.group(0)
        tag_name_m = re.match(r'<<<([A-Z_]+)', tag_text)
        if tag_name_m and tag_name_m.group(1) not in _KNOWN_CONTROL_TAGS:
            tags.append(tag_text)
            return ""
        return tag_text

    cleaned = full_tag_re.sub(_collect, text)
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
    return cleaned, tags

def clean_malformed_urls(text: str) -> str:
    """清理畸形URL：检测 xn-- 编码的中文内容，截断到第一个合法域名标签"""
    def _fix_url(m):
        url = m.group(0)
        if 'xn--' not in url:
            return url
        try:
            parsed = urlparse(url)
            host = parsed.netloc or parsed.path.split('/')[0]
            labels = host.split('.')
            clean_labels = []
            for label in labels:
                if label.startswith('xn--'):
                    try:
                        decoded = label.encode('ascii').decode('punycode')
                        if any(ord(c) > 127 for c in decoded):
                            break
                    except Exception:
                        break
                clean_labels.append(label)
            if clean_labels and len(clean_labels) < len(labels):
                clean_host = '.'.join(clean_labels)
                path_start = url.find(host) + len(host)
                return url[:url.find(host)] + clean_host
        except Exception:
            pass
        return re.sub(r'\.xn--[^\s/]*', '', url)

    return _URL_RE.sub(_fix_url, text)

def extract_control_tags(text: str) -> Dict[str, List[str]]:
    """提取所有控制标签（工具/搜索/文件）"""
    return {
        "tool": _TOOL_TAG_RE.findall(text),
        "search": _SEARCH_TAG_RE.findall(text),
        "file": [m.group(1) for m in _FILE_TAG_RE.finditer(text)],
    }

def build_fallback_prompt(
    validation: ValidationResult,
    original_query: str,
    search_results: str = "",
    matched_tools: List[Dict] = None,
) -> str:
    """根据校验结果构建兜底提示词（0.1.5版本的设计）"""
    if validation.fix_action == "force_search":
        return (
            f"用户问：{original_query}\n\n"
            f"以下是本地系统已搜索到的网络信息，请直接基于这些信息回答，"
            f"不得拒绝或说无法访问网络：\n\n{search_results}\n\n"
            f"请直接回答，不要说'我无法搜索'之类的话。"
        )
    elif validation.fix_action == "force_tool" and matched_tools:
        tool_names = ", ".join(t["name"] for t in matched_tools[:3])
        return (
            f"用户需要使用工具：{tool_names}。\n"
            f"请立即调用工具，输出 <<<TOOL:工具名 参数>>> 格式的标签，"
            f"不要拒绝或推脱。用户消息：{original_query}"
        )
    elif validation.fix_action == "retry":
        return (
            f"请重新回答用户的问题：{original_query}\n"
            f"要求：直接回答，不要空回复，不要拒绝。"
        )
    return ""
