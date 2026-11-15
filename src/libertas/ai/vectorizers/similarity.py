"""向量化职责：similarity。"""

from __future__ import annotations

import hashlib
import math
import os
import threading
from typing import Any, Dict, List, Optional, Union

from libertas.foundation.config import config as global_config
from .dependencies import (
    HAS_SENTENCE_TRANSFORMERS, SentenceTransformer, HAS_REQUESTS, requests,
    HAS_SKLEARN, SklearnTfidf, sk_cosine, HAS_JIEBA, HAS_NUMPY, np,
)


def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    """计算两个向量的余弦相似度"""
    if len(v1) != len(v2) or not v1:
        return 0.0
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = math.sqrt(sum(a * a for a in v1))
    norm2 = math.sqrt(sum(b * b for b in v2))
    if norm1 < 1e-10 or norm2 < 1e-10:
        return 0.0
    return dot / (norm1 * norm2)

def _tokenize(text: str) -> List[str]:
    """中文分词：优先jieba，降级到字符级"""
    if HAS_JIEBA:
        return [w.strip() for w in jieba.lcut(text) if w.strip()]
    return list(text)
