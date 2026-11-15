"""向量化职责：cloud。"""

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


class CloudVectorizer:
    """
    云端向量化器 - 调用 OpenAI 兼容的 Embedding API
    无API Key时自动回退到fallback_vectorizer，绝不返回随机向量
    """
    def __init__(self, api_key: str = None, endpoint: str = None,
                 model: str = "text-embedding-3-small", timeout: int = 30,
                 cache_size: int = 500, fallback_vectorizer=None):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self.endpoint = endpoint or os.environ.get("OPENAI_ENDPOINT", "https://api.openai.com/v1/embeddings")
        self.model = model
        self.timeout = timeout
        self.cache_size = cache_size
        self._cache = {}
        self._cache_hits = 0
        self._cache_misses = 0
        self._dimension = 1536
        self._session = None
        self._fallback = fallback_vectorizer
        self._available = bool(self.api_key and HAS_REQUESTS)

        if not self._available:
            print("[WARN] 云端向量化器: API Key 未配置或requests不可用，将使用回退向量化器")

    def _get_session(self):
        if self._session is None and self._available:
            self._session = requests.Session()
            self._session.headers.update({
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            })
        return self._session

    def vectorize(self, tags: List[str]) -> List[float]:
        if not tags:
            return [0.0] * self.get_dimension()

        text = " ".join(tags)
        if text in self._cache:
            self._cache_hits += 1
            return self._cache[text]

        if not self._available:
            return self._fallback_vectorize(tags)

        try:
            session = self._get_session()
            payload = {"model": self.model, "input": [text]}
            resp = session.post(self.endpoint, json=payload, timeout=self.timeout)
            resp.raise_for_status()
            data = resp.json()
            if "data" in data and len(data["data"]) > 0:
                vec = data["data"][0].get("embedding", [])
                if vec:
                    self._dimension = len(vec)
                    self._add_to_cache(text, vec)
                    return vec
        except Exception as e:
            print(f"[WARN] 云端向量化失败，回退到本地向量化器: {e}")

        return self._fallback_vectorize(tags)

    def vectorize_batch(self, batch: List[List[str]]) -> List[List[float]]:
        if not batch:
            return []

        if not self._available:
            if self._fallback and hasattr(self._fallback, 'vectorize_batch'):
                return self._fallback.vectorize_batch(batch)
            return [self.vectorize(tags) for tags in batch]

        results = []
        texts_to_request = []
        request_indices = []

        for i, tags in enumerate(batch):
            if not tags:
                results.append([0.0] * self.get_dimension())
                continue
            text = " ".join(tags)
            if text in self._cache:
                self._cache_hits += 1
                results.append(self._cache[text])
            else:
                texts_to_request.append(text)
                request_indices.append(i)
                results.append(None)

        if texts_to_request:
            try:
                session = self._get_session()
                payload = {"model": self.model, "input": texts_to_request}
                resp = session.post(self.endpoint, json=payload, timeout=self.timeout)
                resp.raise_for_status()
                data = resp.json()
                if "data" in data:
                    for item in data["data"]:
                        idx = item.get("index", 0)
                        vec = item.get("embedding", [])
                        if vec and idx < len(request_indices):
                            self._dimension = len(vec)
                            results[request_indices[idx]] = vec
                            self._add_to_cache(texts_to_request[idx], vec)
            except Exception as e:
                print(f"[WARN] 云端批量向量化失败，回退到本地: {e}")

        for i in range(len(results)):
            if results[i] is None:
                results[i] = self._fallback_vectorize(batch[i])

        return results

    def _fallback_vectorize(self, tags: List[str]) -> List[float]:
        """回退到本地下游向量化器"""
        if self._fallback:
            vec = self._fallback.vectorize(tags)
            self._dimension = len(vec)
            return vec
        return [0.0] * self._dimension

    def _add_to_cache(self, key: str, value: List[float]):
        self._cache[key] = value
        self._cache_misses += 1
        if len(self._cache) > self.cache_size:
            keys = list(self._cache.keys())[:self.cache_size // 2]
            for k in keys:
                del self._cache[k]

    def get_dimension(self) -> int:
        return self._dimension

    def get_name(self) -> str:
        if self._available:
            return f"Cloud({self.model})"
        return f"Cloud(unavailable→{self._fallback.get_name() if self._fallback else 'none'})"
