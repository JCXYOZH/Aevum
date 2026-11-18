"""
系统设置与偏好管理

全局设置、用户偏好、主题、语言、快捷键、界面配置、配置导入导出。
"""
import os
import json
import time
import uuid
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

from .models import SettingCategory, SettingDefinition


class SettingsDefaultsMixin:
    """默认设置定义初始化。"""

    def _init_default_definitions(self):
        """初始化默认设置定义"""
        defaults = [
            SettingDefinition("app.language", "zh-CN", "enum", "general",
                            "界面语言", options=["zh-CN", "en-US", "ja-JP"]),
            SettingDefinition("app.theme", "dark", "enum", "appearance",
                            "主题", options=["dark", "light", "auto"]),
            SettingDefinition("app.font_size", 14, "int", "appearance",
                            "字体大小", min_value=10, max_value=24),
            # 外观设置（与前端设置界面键名一致）
            SettingDefinition("theme", "dark", "enum", "appearance",
                            "主题色", options=["purple", "dark", "ocean", "forest", "sunset"]),
            SettingDefinition("font_size", "medium", "enum", "appearance",
                            "字体大小", options=["small", "medium", "large"]),
            SettingDefinition("animations", True, "bool", "appearance",
                            "窗口动画"),
            SettingDefinition("window_shadow", True, "bool", "appearance",
                            "窗口阴影"),
            SettingDefinition("code_font_family", "Menlo, Consolas, monospace", "string", "appearance",
                            "代码字体"),
            SettingDefinition("app.auto_update", True, "bool", "general",
                            "自动更新"),
            SettingDefinition("app.startup_launch", False, "bool", "general",
                            "开机启动"),
            SettingDefinition("performance.max_workers", 8, "int", "performance",
                            "最大工作线程数", min_value=1, max_value=64),
            SettingDefinition("performance.cache_enabled", True, "bool", "performance",
                            "启用缓存"),
            SettingDefinition("performance.cache_size_mb", 512, "int", "performance",
                            "缓存大小(MB)", min_value=64, max_value=8192),
            SettingDefinition("performance.request_timeout", 30, "int", "performance",
                            "请求超时(秒)", min_value=5, max_value=300),
            SettingDefinition("security.encryption_enabled", True, "bool", "security",
                            "启用加密"),
            SettingDefinition("security.session_timeout", 7200, "int", "security",
                            "会话超时(秒)", min_value=60, max_value=2592000),
            SettingDefinition("security.two_factor", False, "bool", "security",
                            "双因素认证", requires_confirmation=True),
            SettingDefinition("network.proxy_enabled", False, "bool", "network",
                            "启用代理"),
            SettingDefinition("network.proxy_host", "", "string", "network",
                            "代理地址"),
            SettingDefinition("network.proxy_port", 8080, "int", "network",
                            "代理端口", min_value=1, max_value=65535),
            SettingDefinition("notifications.enabled", True, "bool", "notifications",
                            "启用通知"),
            SettingDefinition("notifications.sound", True, "bool", "notifications",
                            "通知声音"),
            SettingDefinition("notifications.desktop", True, "bool", "notifications",
                            "桌面通知"),
            SettingDefinition("notifications.do_not_disturb", False, "bool", "notifications",
                            "勿扰模式"),
            SettingDefinition("advanced.debug_mode", False, "bool", "advanced",
                            "调试模式", requires_restart=True),
            SettingDefinition("advanced.verbose_logging", False, "bool", "advanced",
                            "详细日志"),
            SettingDefinition("advanced.log_level", "INFO", "enum", "advanced",
                            "日志级别", options=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]),
        ]
        for definition in defaults:
            self._definitions[definition.key] = definition
            self._global_settings[definition.key] = definition.default_value
    
        # config.yaml 持久化键映射（UI键 → config键，点号分隔）
        self._config_keys = {
            "model_runtime_mode": "model_runtime_mode",
            "model_path": "model_path",
            "local_model_device": "local_model_device",
            "local_model_quantization": "local_model_quantization",
            "enable_model": "enable_model",
            "cloud_endpoint": "cloud_endpoint",
            "cloud_model_name": "cloud_model_name",
            "cloud_timeout": "cloud_timeout",
            "max_length": "max_length",
            "temperature": "temperature",
            "enable_deep_thinking": "系统.启用深度思考",
            "cloud_privacy": "系统.云端隐私保护",
            "priv_send_memory": "系统.priv_send_memory",
            "priv_send_scan": "系统.priv_send_scan",
            "priv_send_knowledge": "系统.priv_send_knowledge",
            "priv_send_feedback": "系统.priv_send_feedback",
            "priv_send_history": "系统.priv_send_history",
            "priv_send_tool_results": "系统.priv_send_tool_results",
            "priv_send_user_context": "系统.priv_send_user_context",
            "priv_send_system_prompt": "系统.priv_send_system_prompt",
            "seclists_path": "字典.seclists_path",
            "memory_private_dir": "memory_private_dir",
            "memory_global_dir": "memory_global_dir",
            "log_dir": "log_dir",
            "enable_security": "enable_security",
            "web_port": "port",
            "web_host": "web_host",
            "debug_mode": "debug",
            "max_conversation_history": "max_conversation_history",
            "auto_save_interval": "auto_save_interval",
            "scan_timeout": "scan_timeout",
            "scan_threads": "scan_threads",
            "vectorization_engine": "vectorization.engine",
            "vectorization_dimension": "vectorization.dimension",
            "vectorization_normalize": "vectorization.normalize",
            "semantic_model_name": "vectorization.semantic.model_name",
            "semantic_device": "vectorization.semantic.device",
            "semantic_cache_size": "vectorization.semantic.cache_size",
            "semantic_enabled": "vectorization.semantic.enabled",
            "cloud_api_key": "vectorization.cloud_api.api_key",
            "cloud_api_endpoint": "vectorization.cloud_api.endpoint",
            "cloud_api_model": "vectorization.cloud_api.model",
            "cloud_api_timeout": "vectorization.cloud_api.timeout",
            "cloud_api_cache_size": "vectorization.cloud_api.cache_size",
        }
        # 仅运行时保存的键（不写入config.yaml）
        self._runtime_keys = {"cloud_api_key"}
        self._runtime_values = {}
        # config.yaml 键默认值
        self._config_defaults = {
            "model_runtime_mode": "cloud", "model_path": "", "local_model_device": "auto",
            "local_model_quantization": "auto", "enable_model": True,
            "cloud_endpoint": "https://api.deepseek.com/v1/chat/completions",
            "cloud_model_name": "deepseek-chat", "cloud_timeout": 30,
            "max_length": 8192, "temperature": 0.7, "enable_deep_thinking": True,
            "cloud_privacy": True, "priv_send_memory": False, "priv_send_scan": False,
            "priv_send_knowledge": False, "priv_send_feedback": False,
            "priv_send_history": False, "priv_send_tool_results": False,
            "priv_send_user_context": False, "priv_send_system_prompt": False,
            "seclists_path": "./SecLists", "memory_private_dir": "./LibertasData/MemorySystem",
            "memory_global_dir": "./LibertasData/MemorySystem_Global", "log_dir": "./LibertasData/logs",
            "enable_security": True, "web_port": 8080, "web_host": "127.0.0.1",
            "debug_mode": False, "max_conversation_history": 20, "auto_save_interval": 60,
            "scan_timeout": 300, "scan_threads": 10,
            "vectorization_engine": "tag", "vectorization_dimension": 128,
            "vectorization_normalize": True, "semantic_enabled": False,
            "semantic_model_name": "all-MiniLM-L6-v2", "semantic_device": "auto",
            "semantic_cache_size": 1000, "cloud_api_endpoint": "",
            "cloud_api_model": "", "cloud_api_timeout": 30, "cloud_api_cache_size": 500,
        }
