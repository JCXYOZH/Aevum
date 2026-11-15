"""向量化职责：semantic。"""

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


class SemanticVectorizer:
    """
    语义向量化器 - 使用 sentence-transformers
    支持中文语义理解，支持批量编码
    """
    def __init__(self, model_name: str = "paraphrase-multilingual-MiniLM-L12-v2",
                 device: str = "auto", cache_size: int = 1000, lazy: bool = False):
        self.model_name = model_name
        self.device = device
        self.cache_size = cache_size
        self._model = None
        self._cache = {}
        self._cache_hits = 0
        self._cache_misses = 0
        self._dimension = 384  # MiniLM默认维度，加载后更新
        self._loaded = False
        self._failed = False
        self._loading = False
        self._load_lock = threading.Condition()
        if lazy:
            self._start_background_load()
        else:
            self._load_model()

    def _start_background_load(self):
        """在后台daemon线程中加载模型，不阻塞调用方。"""
        if self._loaded or self._failed or self._loading:
            return
        t = threading.Thread(target=self._bg_load_worker, daemon=True, name="semantic-model-loader")
        t.start()

    def _bg_load_worker(self):
        """后台加载线程worker。"""
        try:
            self._load_model()
            if self._loaded:
                # 健康检查：验证模型能产出非零向量
                test_vec = self._model.encode("health check", normalize_embeddings=True)
                if test_vec is None or len(test_vec) == 0 or all(abs(x) < 1e-8 for x in test_vec[:10]):
                    print("[WARN] 语义模型健康检查失败：产出全零向量")
                    self._failed = True
                    self._loaded = False
                else:
                    print("[OK] 语义模型健康检查通过")
        except Exception as e:
            print(f"[WARN] 语义模型后台加载失败: {e}")
            self._failed = True
            self._loaded = False
            self._loading = False
            with self._load_lock:
                self._load_lock.notify_all()

    def is_ready(self) -> bool:
        """模型是否已加载就绪且健康。"""
        return self._loaded and not self._failed

    def _resolve_model_path(self) -> str:
        """解析模型路径，支持多种情况：
        1. 绝对路径且存在 → 直接使用本地模型
        2. 绝对路径不存在 → 提取模型名，自动下载
        3. 模型名 → 检查本地缓存，找不到则返回模型名
        """
        name = self.model_name

        # 情况1：绝对路径且存在
        if os.path.isabs(name) and os.path.isdir(name):
            return name

        # 情况2：绝对路径不存在，提取末尾的模型名
        if os.path.isabs(name):
            base = os.path.basename(name.rstrip("/\\"))
            print(f"[WARN] 本地模型路径不存在: {name}")
            name = base

        # 情况3：检查所有已知的本地缓存路径
        local_paths = [
            os.path.join(os.path.expanduser("~"), "LibertasData", "models", name),
            os.path.expanduser(f"~/Models/modelscope-cache/models/{name}"),
            os.path.expanduser(f"~/.cache/torch/sentence_transformers/{name}"),
        ]

        # ModelScope 标准缓存结构：{cache_dir}/models/{org}--{name}/snapshots/{branch}
        modelscope_cache_dirs = [
            os.path.join(os.path.expanduser("~"), "LibertasData", "models"),  # 用户当前的缓存路径
            os.path.expanduser("~/.cache/modelscope/hub"),  # ModelScope 默认缓存路径
            os.path.expanduser("~/Models/modelscope-cache"),  # 旧版缓存路径
        ]
        for ms_cache in modelscope_cache_dirs:
            # 支持 sentence-transformers--{name} 和直接 {name} 两种结构
            for org_prefix in ["sentence-transformers--", ""]:
                ms_model_dir = os.path.join(ms_cache, "models", f"{org_prefix}{name}")
                if os.path.isdir(ms_model_dir):
                    # 检查 snapshots 子目录
                    snapshots_dir = os.path.join(ms_model_dir, "snapshots")
                    if os.path.isdir(snapshots_dir):
                        for branch in os.listdir(snapshots_dir):
                            p = os.path.join(snapshots_dir, branch)
                            if os.path.isdir(p) and os.path.exists(os.path.join(p, "config.json")):
                                print(f"[OK] 找到 ModelScope 缓存模型: {p}")
                                return p
                    # 直接在模型目录下检查
                    if os.path.exists(os.path.join(ms_model_dir, "config.json")):
                        print(f"[OK] 找到 ModelScope 缓存模型: {ms_model_dir}")
                        return ms_model_dir

        # HuggingFace 标准缓存结构
        hf_cache = os.path.expanduser(
            f"~/.cache/huggingface/hub/models--sentence-transformers--{name}/snapshots"
        )
        if os.path.isdir(hf_cache):
            for d in os.listdir(hf_cache):
                p = os.path.join(hf_cache, d)
                if os.path.isdir(p) and os.path.exists(os.path.join(p, "config.json")):
                    local_paths.append(p)

        for p in local_paths:
            if os.path.isdir(p) and os.path.exists(os.path.join(p, "config.json")):
                return p

        # 本地找不到，返回模型名（SentenceTransformer 会尝试下载）
        return name

    def _load_model(self):
        if self._loaded:
            return
        # 防止后台线程和主线程并发加载同一模型
        if self._loading:
            with self._load_lock:
                while self._loading and not self._loaded and not self._failed:
                    self._load_lock.wait(timeout=0.5)
            return
        with self._load_lock:
            if self._loaded:
                return
            self._loading = True
        if not HAS_SENTENCE_TRANSFORMERS:
            self._failed = True
            self._loading = False
            with self._load_lock:
                self._load_lock.notify_all()
            raise ImportError("sentence-transformers 未安装，请运行: pip install sentence-transformers")

        import torch
        if self.device == "auto":
            if torch.cuda.is_available():
                self.device = "cuda"
            else:
                # MiniLM等小模型在CPU上更快更稳定，MPS反而可能卡住
                self.device = "cpu"
        elif self.device == "mps":
            # MPS后端加载sentence_transformers小模型可能卡死，强制CPU
            print("[WARN] MPS后端可能导致模型加载卡住，切换到CPU")
            self.device = "cpu"

        resolved = self._resolve_model_path()
        print(f"[AI] 加载语义向量模型: {resolved} (设备: {self.device})")
        # 强制离线模式，防止HuggingFace网络请求卡死
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
        try:
            self._model = SentenceTransformer(resolved, device=self.device)
        except Exception as e:
            # 自动下载失败时，尝试缓存到 ~/LibertasData/models/
            cache_dir = os.path.join(os.path.expanduser("~"), "LibertasData", "models")
            os.makedirs(cache_dir, exist_ok=True)
            model_name = os.path.basename(resolved.rstrip("/\\")) if os.path.isabs(resolved) else resolved
            print(f"[WARN] 模型加载失败({e})，尝试下载到缓存目录: {cache_dir}")
            try:
                self._model = SentenceTransformer(model_name, device=self.device,
                                                  cache_folder=cache_dir)
            except Exception as e2:
                self._failed = True
                self._loading = False
                with self._load_lock:
                    self._load_lock.notify_all()
                raise e2
        self._dimension = self._model.get_embedding_dimension()
        self._loaded = True
        self._loading = False
        with self._load_lock:
            self._load_lock.notify_all()
        print(f"[OK] 语义向量模型加载完成 (维度: {self._dimension}, 设备: {self.device})")

    def vectorize(self, tags: List[str]) -> Optional[List[float]]:
        if not tags:
            return [0.0] * self.get_dimension()

        text = " ".join(tags)
        if text in self._cache:
            self._cache_hits += 1
            return self._cache[text]

        # 模型未就绪（后台加载中/已失败），返回None让上层回退
        if not self._loaded or self._failed:
            if not self._loading and not self._failed:
                self._start_background_load()
            return None

        try:
            vec = self._model.encode(text, normalize_embeddings=True)
            vec_list = vec.tolist()
            self._add_to_cache(text, vec_list)
            return vec_list
        except Exception as e:
            print(f"[WARN] 语义向量生成失败: {e}")
            return None

    def vectorize_batch(self, batch: List[List[str]]) -> List[List[float]]:
        """批量向量化，利用model.encode的batch加速"""
        if not batch:
            return []

        texts = []
        results = []
        uncached_indices = []

        for i, tags in enumerate(batch):
            if not tags:
                results.append([0.0] * self.get_dimension())
                continue
            text = " ".join(tags)
            if text in self._cache:
                self._cache_hits += 1
                results.append(self._cache[text])
            else:
                texts.append(text)
                uncached_indices.append(i)
                results.append(None)

        if texts and self._loaded and not self._failed:
            try:
                vecs = self._model.encode(texts, batch_size=32, normalize_embeddings=True)
                for idx, vec in zip(uncached_indices, vecs):
                    vec_list = vec.tolist()
                    results[idx] = vec_list
                    self._add_to_cache(texts[uncached_indices.index(idx)], vec_list)
            except Exception as e:
                print(f"[WARN] 批量语义向量生成失败: {e}")
                for idx in uncached_indices:
                    if results[idx] is None:
                        results[idx] = None  # 让上层回退
        elif texts and not self._loaded and not self._failed and not self._loading:
            self._start_background_load()

        # 未就绪的项返回None，让FallbackVectorizer回退到下一个向量化器
        for i in range(len(results)):
            if results[i] is None:
                results[i] = None

        return results

    def _add_to_cache(self, key: str, value: List[float]):
        self._cache[key] = value
        self._cache_misses += 1
        if len(self._cache) > self.cache_size:
            keys = list(self._cache.keys())[:self.cache_size // 2]
            for k in keys:
                del self._cache[k]

    def get_dimension(self) -> int:
        return self._dimension or 384

    def get_name(self) -> str:
        return f"Semantic({self.model_name})"
