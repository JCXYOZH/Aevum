"""向量化职责：manager。"""

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

from .fallback import FallbackVectorizer
from .factory import create_vectorizer_from_config

_vectorization_lock = threading.Lock()

def get_vectorization_manager() -> "FallbackVectorizer":
    """获取全局向量化管理器单例（线程安全）"""
    global _vectorization_manager
    if _vectorization_manager is None:
        with _vectorization_lock:
            if _vectorization_manager is None:
                _vectorization_manager = FallbackVectorizer(
                    global_config.get("vectorization", {})
                )
    return _vectorization_manager

def rebuild_vectorization(config: Dict[str, Any] = None) -> List[str]:
    """重建全局向量化链（设置变更后调用）

    同时重建记忆系统的向量化器（如果 Libertas 实例可用）。
    """
    chain = get_vectorization_manager().rebuild(config)
    # 同步重建记忆系统的向量化器和索引
    try:
        from ..interfaces.web import get_Libertas
        zx = get_Libertas()
        if zx and hasattr(zx, 'memory_system') and zx.memory_system:
            cfg = config if config is not None else global_config.get("vectorization", {})
            zx.memory_system.tag_vectorizer = create_vectorizer_from_config(cfg)
            zx.memory_system._rebuild_memory_index()
    except Exception:
        pass
    return chain

def reset_vectorization_manager():
    """重置单例（主要用于测试和配置完全重载）"""
    global _vectorization_manager
    with _vectorization_lock:
        _vectorization_manager = None
