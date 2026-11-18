"""向量化职责：shared。"""

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

from .semantic import SemanticVectorizer

_shared_lock = threading.Lock()

def get_shared_semantic_vectorizer() -> Optional[SemanticVectorizer]:
    """获取共享的语义向量化器实例（所有模块共用，模型只加载一次）。"""
    global _shared_semantic
    if _shared_semantic is not None:
        return _shared_semantic
    # 检查设置是否启用语义模型（使用 get_all() 确保能读取到 schema 中定义的键）
    try:
        from libertas.data.system_settings import get_system_settings
        all_settings = get_system_settings().get_all()
        # 只有明确设置为 False 才禁用，其他情况（None、True、不存在）都启用
        if all_settings.get("semantic_enabled", True) is False:
            print("[WARN] 语义模型已在设置中禁用")
            return None
    except Exception as e:
        print(f"[WARN] 读取 semantic_enabled 设置失败，默认启用: {e}")
    with _shared_lock:
        if _shared_semantic is not None:
            return _shared_semantic
        # 查找本地模型路径（支持 ModelScope、HuggingFace、Torch 等多种缓存结构）
        model_name = "paraphrase-multilingual-MiniLM-L12-v2"
        local_paths = [
            os.path.expanduser(f"~/Models/modelscope-cache/models/{model_name}"),
            os.path.expanduser(f"~/.cache/torch/sentence_transformers/{model_name}"),
            os.path.join(os.path.expanduser("~"), "LibertasData", "models", model_name),
        ]

        # ModelScope 标准缓存结构：{cache_dir}/models/{org}--{name}/snapshots/{branch}
        modelscope_cache_dirs = [
            os.path.join(os.path.expanduser("~"), "LibertasData", "models"),
            os.path.expanduser("~/.cache/modelscope/hub"),
            os.path.expanduser("~/Models/modelscope-cache"),
        ]
        for ms_cache in modelscope_cache_dirs:
            for org_prefix in ["sentence-transformers--", ""]:
                ms_model_dir = os.path.join(ms_cache, "models", f"{org_prefix}{model_name}")
                if os.path.isdir(ms_model_dir):
                    snapshots_dir = os.path.join(ms_model_dir, "snapshots")
                    if os.path.isdir(snapshots_dir):
                        for branch in os.listdir(snapshots_dir):
                            p = os.path.join(snapshots_dir, branch)
                            if os.path.isdir(p) and os.path.exists(os.path.join(p, "config.json")):
                                local_paths.append(p)
                    if os.path.exists(os.path.join(ms_model_dir, "config.json")):
                        local_paths.append(ms_model_dir)

        # HuggingFace 标准缓存结构
        hf_cache = os.path.expanduser(
            f"~/.cache/huggingface/hub/models--sentence-transformers--{model_name}/snapshots"
        )
        if os.path.isdir(hf_cache):
            for d in os.listdir(hf_cache):
                p = os.path.join(hf_cache, d)
                if os.path.isdir(p):
                    local_paths.append(p)

        model_path = None
        for p in local_paths:
            if os.path.isdir(p) and os.path.exists(os.path.join(p, "config.json")):
                model_path = p
                break
        if model_path is None:
            model_path = model_name
            print(f"[DOWNLOAD] 本地未找到语义模型，将自动下载: {model_path}")
        else:
            print(f"[OK] 使用本地语义模型: {model_path}")

        # 不强制离线模式，允许 SentenceTransformer 自动下载模型
        # 只有当用户明确设置离线模式时才使用离线
        if os.environ.get("LIBERTAS_OFFLINE_MODE", "0") == "1":
            os.environ["HF_HUB_OFFLINE"] = "1"
            os.environ["TRANSFORMERS_OFFLINE"] = "1"
        else:
            os.environ.pop("HF_HUB_OFFLINE", None)
            os.environ.pop("TRANSFORMERS_OFFLINE", None)

        # 从配置文件读取设备设置（支持 auto/cpu/cuda），不强制使用 cpu
        semantic_device = "auto"
        try:
            semantic_cfg = global_config.get("vectorization", {}).get("semantic", {})
            semantic_device = semantic_cfg.get("device", "auto")
        except Exception:
            pass

        try:
            print(f"[TOOL] 正在创建语义向量化器（设备: {semantic_device}）...")
            _shared_semantic = SemanticVectorizer(
                model_name=model_path, device=semantic_device, cache_size=5000, lazy=True
            )
            # 启动后台加载（如果是lazy模式，会在后台线程中加载/下载模型）
            if hasattr(_shared_semantic, '_start_background_load'):
                _shared_semantic._start_background_load()
            print(f"[OK] 语义向量化器创建成功（设备: {semantic_device}，后台加载中）")
        except Exception as e:
            print(f"[WARN] 语义向量化器创建失败: {e}")
            import traceback
            traceback.print_exc()
            _shared_semantic = None
        return _shared_semantic

    def rebuild(self, config: Dict[str, Any] = None):
        """用新配置重建向量化链（设置变更后调用）"""
        if config is None:
            config = global_config.get("vectorization", {})
        self._chain = []
        self._primary = None
        self._build_chain(config)
        return self.get_chain_info()
