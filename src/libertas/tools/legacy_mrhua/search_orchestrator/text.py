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


def _normalize_url(url: str) -> str:
    """标准化URL用于去重"""
    if not url:
        return ""
    url = url.rstrip("/")
    # 去掉协议
    url = re.sub(r"^https?://", "", url)
    # 去掉www.
    url = re.sub(r"^www\.", "", url)
    # 去掉常见跟踪参数
    if "?" in url:
        base, query = url.split("?", 1)
        params = parse_qs(query)
        clean_params = {k: v for k, v in params.items()
                        if not k.lower().startswith(("utm_", "ref", "source", "fbclid", "gclid"))}
        if clean_params:
            from urllib.parse import urlencode
            url = base + "?" + urlencode(clean_params, doseq=True)
        else:
            url = base
    return url.lower()

def _dedup_results(results: List[Dict]) -> List[Dict]:
    """按URL去重，保留第一个"""
    seen = set()
    deduped = []
    for r in results:
        url = r.get("url", "")
        if not url or url.startswith("【"):
            deduped.append(r)
            continue
        norm = _normalize_url(url)
        if norm and norm not in seen:
            seen.add(norm)
            deduped.append(r)
    return deduped

def _char_ngrams(text: str, n: int = 2) -> set:
    """提取字符级 n-gram 集合（中文按字，英文按词对）"""
    if not text:
        return set()
    # 清理：去掉URL、多余空白、标点
    text = re.sub(r'https?://\S+', '', text)
    text = re.sub(r'[\s\u3000]+', '', text)
    text = re.sub(r"[]，。！？、；：""''（）【】《》[{}()—…·.,!?;:'\"-]", '', text)
    if len(text) < n:
        return {text} if text else set()
    return {text[i:i+n] for i in range(len(text) - n + 1)}

def _jaccard(set_a: set, set_b: set) -> float:
    """Jaccard 相似度"""
    if not set_a or not set_b:
        return 0.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union else 0.0

def _content_dedup(results: List[Dict], threshold: float = 0.55) -> List[Dict]:
    """基于标题+摘要的内容相似度去重。

    不同网站转载同一内容（如百度百科/汉典/汉典国学）URL不同但内容高度重复，
    URL去重无法识别。用字符 bigram Jaccard 相似度过滤。
    threshold: 相似度阈值，超过则视为重复（0.55 对中文 bigram 比较合理）
    """
    if len(results) <= 1:
        return results
    kept = []
    kept_grams = []  # 保留结果的 n-gram 集合
    for r in results:
        if r.get("error"):
            kept.append(r)
            continue
        title = r.get("title", "")
        snippet = r.get("snippet", "")
        combined = f"{title} {snippet}".strip()
        grams = _char_ngrams(combined, 2)
        if not grams:
            kept.append(r)
            kept_grams.append(set())
            continue
        is_dup = False
        for kg in kept_grams:
            if _jaccard(grams, kg) >= threshold:
                is_dup = True
                break
        if not is_dup:
            kept.append(r)
            kept_grams.append(grams)
    return kept
