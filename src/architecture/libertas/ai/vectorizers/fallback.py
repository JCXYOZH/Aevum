"""向量化职责：fallback。"""

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
from .semantic import SemanticVectorizer
from .tag import TagVectorizer
from .tag import TfidfTagVectorizer
from .shared import get_shared_semantic_vectorizer

class FallbackVectorizer:
    """
    自动回退链向量化器
    按优先级尝试：Cloud → Semantic → TF-IDF → TagHash
    确保任何环境下都有可用的向量化器
    """
    def __init__(self, config: Dict[str, Any] = None):
        self._chain = []
        self._primary = None
        self._build_chain(config or global_config.get("vectorization", {}))

    def _build_chain(self, config: Dict[str, Any]):
        engine_type = config.get("engine", "tag")

        # 检查是否启用语义模型
        semantic_enabled = True
        try:
            from libertas.data.system_settings import get_system_settings
            semantic_enabled = get_system_settings().get("semantic_enabled", True)
        except Exception:
            pass

        if engine_type == "cloud_api":
            cloud_cfg = config.get("cloud_api", {})
            local_fallback = self._create_local_fallback(config)
            try:
                cloud = CloudVectorizer(
                    api_key=cloud_cfg.get("api_key", ""),
                    endpoint=cloud_cfg.get("endpoint", "https://api.openai.com/v1/embeddings"),
                    model=cloud_cfg.get("model", "text-embedding-3-small"),
                    timeout=cloud_cfg.get("timeout", 30),
                    cache_size=cloud_cfg.get("cache_size", 500),
                    fallback_vectorizer=local_fallback
                )
                self._chain.append(cloud)
            except Exception:
                pass
            if local_fallback:
                self._chain.append(local_fallback)
        elif engine_type == "semantic":
            if semantic_enabled:
                try:
                    # 强制复用共享向量化器实例，绝不自己 new，防止模型加载两遍
                    shared = get_shared_semantic_vectorizer()
                    if shared is not None:
                        self._chain.append(shared)
                    # shared 为 None 说明语义模型被禁用或不可用，直接降级到 TF-IDF
                except Exception as e:
                    print(f"[WARN] 语义向量化器不可用: {e}")
            tfidf = self._create_tfidf(config)
            if tfidf:
                self._chain.append(tfidf)
            self._chain.append(TagVectorizer(
                dimension=config.get("dimension", 128),
                normalize=config.get("normalize", True)
            ))
        elif engine_type == "tfidf":
            tfidf = self._create_tfidf(config)
            if tfidf:
                self._chain.append(tfidf)
            self._chain.append(TagVectorizer(
                dimension=config.get("dimension", 128),
                normalize=config.get("normalize", True)
            ))
        else:
            # tag 引擎：TF-IDF（如有）→ TagHash，保证最低质量
            tfidf = self._create_tfidf(config)
            if tfidf:
                self._chain.append(tfidf)
            self._chain.append(TagVectorizer(
                dimension=config.get("dimension", 128),
                normalize=config.get("normalize", True)
            ))

        self._primary = self._chain[0] if self._chain else TagVectorizer()
        names = " → ".join(v.get_name() for v in self._chain)
        print(f"[LINK] 向量化回退链: {names}")

    def _create_local_fallback(self, config: Dict[str, Any]):
        """创建本地回退向量化器（Semantic → TF-IDF → TagHash）"""
        if HAS_SENTENCE_TRANSFORMERS:
            try:
                shared = get_shared_semantic_vectorizer()
                if shared is not None:
                    return shared
                semantic_cfg = config.get("semantic", {})
                return SemanticVectorizer(
                    model_name=semantic_cfg.get("model_name", "paraphrase-multilingual-MiniLM-L12-v2"),
                    device=semantic_cfg.get("device", "auto"),
                    cache_size=semantic_cfg.get("cache_size", 1000),
                    lazy=True
                )
            except Exception:
                pass
        return self._create_tfidf(config) or TagVectorizer(
            dimension=config.get("dimension", 128),
            normalize=config.get("normalize", True)
        )

    def _create_tfidf(self, config: Dict[str, Any]):
        try:
            return TfidfTagVectorizer(
                dimension=config.get("tfidf_dimension", 256),
                normalize=config.get("normalize", True)
            )
        except Exception:
            return None

    def vectorize(self, tags: List[str]) -> List[float]:
        """按链顺序尝试，前一个返回None或全零则回退到下一个。"""
        target_dim = self.get_dimension()
        for v in self._chain:
            try:
                result = v.vectorize(tags)
                if result is not None and any(abs(x) > 1e-8 for x in result[:10]):
                    # 统一维度：填充或截断到目标维度
                    if len(result) < target_dim:
                        result = result + [0.0] * (target_dim - len(result))
                    elif len(result) > target_dim:
                        result = result[:target_dim]
                    return result
            except Exception:
                continue
        # 全部失败，返回零向量
        return [0.0] * target_dim

    def vectorize_batch(self, batch: List[List[str]]) -> List[List[float]]:
        """批量向量化，按链回退。"""
        target_dim = self.get_dimension()
        for v in self._chain:
            try:
                if hasattr(v, 'vectorize_batch'):
                    results = v.vectorize_batch(batch)
                else:
                    results = [v.vectorize(tags) for tags in batch]
                if results and all(r is not None and any(abs(x) > 1e-8 for x in r[:10]) for r in results if r):
                    # 统一维度
                    normalized = []
                    for r in results:
                        if r is None:
                            normalized.append([0.0] * target_dim)
                        elif len(r) < target_dim:
                            normalized.append(r + [0.0] * (target_dim - len(r)))
                        elif len(r) > target_dim:
                            normalized.append(r[:target_dim])
                        else:
                            normalized.append(r)
                    return normalized
            except Exception:
                continue
        return [[0.0] * target_dim for _ in batch]

    def get_dimension(self) -> int:
        return self._primary.get_dimension()

    def get_name(self) -> str:
        return self._primary.get_name()

    def get_chain_info(self) -> List[str]:
        return [v.get_name() for v in self._chain]

    # ============================================================
    # sklearn style compatibility methods (for memory.py legacy code)
    # ============================================================
    def fit(self, documents, **kwargs):
        """sklearn-style fit. FallbackVectorizer needs no training."""
        return self

    def transform(self, text, **kwargs):
        """sklearn-style transform. Tokenize string then call vectorize()."""
        if isinstance(text, list):
            return [self._transform_single(t) for t in text]
        return self._transform_single(text)

    def _transform_single(self, text):
        if not text:
            return [0.0] * self.get_dimension()
        try:
            import jieba
            tags = list(jieba.cut(str(text).lower()))
        except Exception:
            import re
            tags = re.findall(r'[\u4e00-\u9fa5]|[a-zA-Z0-9]+', str(text).lower())
        if not tags:
            tags = [str(text)[:10]]
        return self.vectorize(tags)

    def fit_transform(self, documents, **kwargs):
        """sklearn-style fit_transform."""
        self.fit(documents)
        return self.transform(documents)
