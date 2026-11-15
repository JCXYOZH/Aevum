"""
模型控制层

统一管理AI模型的调用、路由、限流、降级、缓存、成本控制、模型切换。
"""
import os
import re
import json
import time
import uuid
import hashlib
import threading
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

from .constants import _EMPTY_REPLY_PATTERNS, _EVASION_PATTERNS, _INJECTION_PATTERNS, _PROTOCOL_LEAK_PATTERNS, _REFUSAL_EN, _REFUSAL_ZH
from .models import ModelConfig, ModelRequest, ModelStatus


class ModelRegistryMixin:
    """模型注册、加载、保存、默认模型与回退链。"""

    def _init_default_models(self):
        """初始化默认模型配置"""
        defaults = [
            ModelConfig("default-chat", "chat", "local", "http://localhost:8080",
                       max_tokens=4096, temperature=0.7, priority=10,
                       capabilities=["chat", "completion"]),
            ModelConfig("fast-chat", "chat", "local", "http://localhost:8081",
                       max_tokens=2048, temperature=0.5, priority=5,
                       capabilities=["chat"]),
            ModelConfig("creative", "chat", "local", "http://localhost:8082",
                       max_tokens=4096, temperature=1.0, priority=3,
                       capabilities=["chat", "creative"]),
        ]
        for model in defaults:
            self._models[model.name] = model
        self._default_model = "default-chat"
        self._fallback_chain = ["default-chat", "fast-chat", "creative"]

    def _load(self):
        config_file = os.path.join(self.data_dir, "model_configs.json")
        try:
            if os.path.exists(config_file):
                with open(config_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self._default_model = data.get("default_model", self._default_model)
                self._fallback_chain = data.get("fallback_chain", self._fallback_chain)
                self._daily_budget = data.get("daily_budget", self._daily_budget)
                for m_data in data.get("models", []):
                    model = ModelConfig(
                        name=m_data.get("name", ""),
                        model_type=m_data.get("model_type", "chat"),
                        provider=m_data.get("provider", ""),
                        endpoint=m_data.get("endpoint", ""),
                        max_tokens=m_data.get("max_tokens", 4096),
                        temperature=m_data.get("temperature", 0.7),
                        priority=m_data.get("priority", 0),
                        enabled=m_data.get("enabled", True),
                        capabilities=m_data.get("capabilities", []),
                    )
                    model.model_id = m_data.get("model_id", model.model_id)
                    model.status = ModelStatus(m_data.get("status", "active"))
                    model.total_calls = m_data.get("total_calls", 0)
                    model.total_tokens = m_data.get("total_tokens", 0)
                    model.total_cost = m_data.get("total_cost", 0)
                    self._models[model.name] = model
        except Exception as e:
            terminal.warn(f"加载模型配置失败: {e}", "model_control")

    def _save(self):
        config_file = os.path.join(self.data_dir, "model_configs.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                "default_model": self._default_model,
                "fallback_chain": self._fallback_chain,
                "daily_budget": self._daily_budget,
                "models": [m.to_dict() for m in self._models.values()],
            }
            with open(config_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def register_model(self, config: ModelConfig) -> str:
        with self._lock:
            self._models[config.name] = config
            self._save()
        terminal.info(f"注册模型: {config.name}", "model_control")
        return config.name

    def unregister_model(self, name: str) -> bool:
        with self._lock:
            if name in self._models:
                del self._models[name]
                if self._default_model == name:
                    self._default_model = self._fallback_chain[0] if self._fallback_chain else ""
                self._save()
                return True
        return False

    def get_model(self, name: str = "") -> Optional[ModelConfig]:
        name = name or self._default_model
        return self._models.get(name)

    def list_models(self, enabled_only: bool = False, model_type: str = "") -> List[ModelConfig]:
        models = list(self._models.values())
        if enabled_only:
            models = [m for m in models if m.enabled and m.status == ModelStatus.ACTIVE]
        if model_type:
            models = [m for m in models if m.model_type == model_type]
        return sorted(models, key=lambda m: m.priority, reverse=True)

    def set_default_model(self, name: str) -> bool:
        if name in self._models:
            self._default_model = name
            self._save()
            return True
        return False

    def set_fallback_chain(self, chain: List[str]):
        self._fallback_chain = [n for n in chain if n in self._models]
        self._save()

    def register_request_handler(self, model_type: str, handler: Callable):
        self._request_handlers[model_type] = handler
