"""向量化职责：factory。"""

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

from .cloud import CloudVectorizer
from .fallback import FallbackVectorizer
from .semantic import SemanticVectorizer
from .tag import TagVectorizer
from .tag import TfidfTagVectorizer

def create_vectorizer_from_config(config: Dict[str, Any] = None) -> Any:
    """
    根据配置创建向量化器
    config: 来自 config.yaml 的 vectorization 节
    如果未提供，则从全局 config 读取
    默认使用回退链确保可用性
    """
    if config is None:
        config = global_config.get("vectorization", {})

    if not config and global_config.get('engine') == 'semantic':
        print("[TOOL] 检测到扁平配置，自动重建 vectorization 结构")
        config = {
            'engine': 'semantic',
            'semantic': {
                'model_name': global_config.get('model_name', 'paraphrase-multilingual-MiniLM-L12-v2'),
                'device': global_config.get('device', 'auto'),
                'cache_size': global_config.get('cache_size', 1000)
            }
        }

    use_fallback = config.get("use_fallback_chain", True)
    if use_fallback:
        return FallbackVectorizer(config)

    engine_type = config.get("engine", "tag")

    if engine_type == "semantic":
        semantic_cfg = config.get("semantic", {})
        return SemanticVectorizer(
            model_name=semantic_cfg.get("model_name", "paraphrase-multilingual-MiniLM-L12-v2"),
            device=semantic_cfg.get("device", "auto"),
            cache_size=semantic_cfg.get("cache_size", 1000)
        )
    elif engine_type == "tfidf":
        return TfidfTagVectorizer(
            dimension=config.get("tfidf_dimension", 256),
            normalize=config.get("normalize", True)
        )
    elif engine_type == "cloud_api":
        cloud_cfg = config.get("cloud_api", {})
        local_fallback = None
        if HAS_SENTENCE_TRANSFORMERS:
            try:
                local_fallback = SemanticVectorizer(
                    model_name=config.get("semantic", {}).get("model_name", "paraphrase-multilingual-MiniLM-L12-v2"),
                    device="auto",
                    cache_size=1000
                )
            except Exception:
                local_fallback = TfidfTagVectorizer() if HAS_SKLEARN else TagVectorizer()
        else:
            local_fallback = TfidfTagVectorizer() if HAS_SKLEARN else TagVectorizer()
        return CloudVectorizer(
            api_key=cloud_cfg.get("api_key", ""),
            endpoint=cloud_cfg.get("endpoint", "https://api.openai.com/v1/embeddings"),
            model=cloud_cfg.get("model", "text-embedding-3-small"),
            timeout=cloud_cfg.get("timeout", 30),
            cache_size=cloud_cfg.get("cache_size", 500),
            fallback_vectorizer=local_fallback
        )
    else:
        return TagVectorizer(
            dimension=config.get("dimension", 128),
            normalize=config.get("normalize", True)
        )
