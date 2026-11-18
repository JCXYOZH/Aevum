"""向量化职责：tag。"""

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

from .similarity import _tokenize

class TagVectorizer:
    """
    标签哈希向量化器
    特点：极快、无依赖、确定性
    """
    def __init__(self, dimension: int = 128, normalize: bool = True):
        self.dimension = dimension
        self.normalize = normalize
        self._hash_cache = {}

    def _stable_hash_to_index(self, tag: str) -> int:
        if tag in self._hash_cache:
            return self._hash_cache[tag]
        md5 = hashlib.md5(tag.encode('utf-8')).hexdigest()
        idx = int(md5[:8], 16) % self.dimension
        self._hash_cache[tag] = idx
        return idx

    def vectorize(self, tags: List[str]) -> List[float]:
        if not tags:
            return [0.0] * self.dimension

        vec = [0.0] * self.dimension
        for tag in tags:
            tag = tag.strip()
            if not tag:
                continue
            idx = self._stable_hash_to_index(tag)
            vec[idx] += 1.0

        if self.normalize:
            norm = math.sqrt(sum(v * v for v in vec))
            if norm > 1e-8:
                vec = [v / norm for v in vec]
            else:
                vec = [1.0 / math.sqrt(self.dimension)] * self.dimension

        return vec

    def vectorize_batch(self, batch: List[List[str]]) -> List[List[float]]:
        return [self.vectorize(tags) for tags in batch]

    def get_dimension(self) -> int:
        return self.dimension

    def get_name(self) -> str:
        return "TagHash"

class TfidfTagVectorizer:
    """
    TF-IDF 向量化器
    使用sklearn的TfidfVectorizer，支持中文分词
    比TagHash有词汇级语义，比Semantic快
    """
    def __init__(self, dimension: int = 256, normalize: bool = True):
        self.dimension = dimension
        self.normalize = normalize
        self._tfidf = None
        self._vocab_fitted = False
        self._cache = {}
        self._document_count = 0

        if HAS_SKLEARN:
            self._tfidf = SklearnTfidf(
                max_features=dimension,
                tokenizer=_tokenize if HAS_JIEBA else None,
                token_pattern=r"(?u)\b\w+\b" if not HAS_JIEBA else None,
                lowercase=False
            )

    def _ensure_fitted(self, texts: List[str]):
        """延迟拟合：积累足够文档后拟合TF-IDF"""
        if not HAS_SKLEARN or self._tfidf is None:
            return
        if not self._vocab_fitted and len(texts) > 0:
            try:
                self._tfidf.fit(texts)
                self._vocab_fitted = True
            except Exception:
                self._tfidf = None

    def vectorize(self, tags: List[str]) -> List[float]:
        if not tags:
            return [0.0] * self.dimension

        text = " ".join(tags)
        if text in self._cache:
            return self._cache[text]

        if not HAS_SKLEARN or self._tfidf is None:
            return self._fallback_vectorize(tags)

        try:
            if not self._vocab_fitted:
                self._ensure_fitted([text])
            if self._vocab_fitted:
                vec = self._tfidf.transform([text]).toarray()[0]
                vec_list = vec.tolist()
                if len(vec_list) < self.dimension:
                    vec_list.extend([0.0] * (self.dimension - len(vec_list)))
                elif len(vec_list) > self.dimension:
                    vec_list = vec_list[:self.dimension]
                if self.normalize:
                    norm = math.sqrt(sum(v * v for v in vec_list))
                    if norm > 1e-8:
                        vec_list = [v / norm for v in vec_list]
                self._cache[text] = vec_list
                return vec_list
        except Exception:
            pass

        return self._fallback_vectorize(tags)

    def _fallback_vectorize(self, tags: List[str]) -> List[float]:
        """sklearn不可用时降级到字符级TF"""
        vec = [0.0] * self.dimension
        for tag in tags:
            for ch in tag:
                idx = int(hashlib.md5(ch.encode('utf-8')).hexdigest()[:8], 16) % self.dimension
                vec[idx] += 1.0
        if self.normalize:
            norm = math.sqrt(sum(v * v for v in vec))
            if norm > 1e-8:
                vec = [v / norm for v in vec]
        return vec

    def vectorize_batch(self, batch: List[List[str]]) -> List[List[float]]:
        texts = [" ".join(tags) for tags in batch if tags]
        if HAS_SKLEARN and self._tfidf is not None and texts:
            try:
                if not self._vocab_fitted:
                    self._ensure_fitted(texts)
                if self._vocab_fitted:
                    matrix = self._tfidf.transform(texts).toarray()
                    results = []
                    for row in matrix:
                        vec_list = row.tolist()
                        if len(vec_list) < self.dimension:
                            vec_list.extend([0.0] * (self.dimension - len(vec_list)))
                        results.append(vec_list[:self.dimension])
                    return results
            except Exception:
                pass
        return [self.vectorize(tags) for tags in batch]

    def get_dimension(self) -> int:
        return self.dimension

    def get_name(self) -> str:
        return "TF-IDF" if HAS_SKLEARN else "TF-IDF(fallback)"
