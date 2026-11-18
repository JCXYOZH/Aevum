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

from .models import SettingCategory, SettingDefinition, UserPreferences


class SettingsFacadeMixin:
    """设置汇总、schema、导入导出与偏好。"""

    def get_all_settings(self, user_id: str = "", category: str = "") -> Dict[str, Any]:
        """获取所有设置（从config.yaml读取实际值 + 工具治理配置 + UI偏好）"""
        result = {}
        # 1. 从 config.yaml 读取所有配置键的实际值
        for ui_key in self._config_keys:
            if category:
                # 检查这个键属于哪个schema分组
                schema = self.get_schema()
                found_cat = None
                for cat_key, cat_data in schema.items():
                    if ui_key in cat_data.get("items", {}):
                        found_cat = cat_key
                        break
                if found_cat and found_cat != category:
                    continue
            result[ui_key] = self._config_get(ui_key)
        # 2. 从工具治理读取 gov_key 项
        try:
            schema = self.get_schema()
            for cat_key, cat_data in schema.items():
                if category and cat_key != category:
                    continue
                for item_key, item_def in cat_data.get("items", {}).items():
                    if "gov_key" in item_def and item_key not in result:
                        result[item_key] = self._gov_get(item_def["gov_key"])
        except Exception:
            pass
        # 3. 加入 _definitions 中的键（UI偏好等）
        for key in self._definitions:
            if category and self._definitions[key].category != category:
                continue
            if key not in result:
                result[key] = self.get(key, user_id)
        # 4. 补充schema中剩余的键（先从全局设置读取用户实际保存的值，没有再给默认值）
        try:
            schema = self.get_schema()
            for cat_key, cat_data in schema.items():
                if category and cat_key != category:
                    continue
                for item_key, item_def in cat_data.get("items", {}).items():
                    if item_key not in result:
                        # 先从全局设置读取用户实际保存的值，没有再给默认值
                        saved_val = self._global_settings.get(item_key)
                        if saved_val is not None:
                            result[item_key] = saved_val
                            continue
                        itype = item_def.get("type", "text")
                        if itype == "boolean":
                            result[item_key] = False
                        elif itype == "select":
                            opts = item_def.get("options", [])
                            if opts:
                                first = opts[0]
                                result[item_key] = first.get("value", first) if isinstance(first, dict) else first
                            else:
                                result[item_key] = ""
                        elif itype == "range":
                            result[item_key] = item_def.get("min", 0)
                        else:
                            result[item_key] = ""
        except Exception:
            pass
        return result

    def get_all(self, user_id: str = "", category: str = "") -> Dict[str, Any]:
        """获取所有设置（向后兼容别名，web.py调用此方法）"""
        return self.get_all_settings(user_id, category)

    def get_schema(self) -> Dict[str, Any]:
        """获取设置Schema（按类别分组，供前端渲染设置表单）
        使用0.1.5版本的专业设置分组
        """
        return {
            "model_cloud": {
                "label": "模型与云端",
                "items": {
                    "model_runtime_mode": {"label": "模型运行模式", "type": "select", "options": ["cloud", "local"]},
                    "enable_model": {"label": "启用模型", "type": "boolean"},
                    "model_path": {"label": "本地模型路径", "type": "text", "placeholder": "如 /Users/xxx/Models/Qwen2.5-7B-Instruct"},
                    "local_model_device": {"label": "本地模型设备", "type": "select", "options": [
                        {"value": "auto", "label": "自动（推荐）"},
                        {"value": "cpu", "label": "CPU"},
                        {"value": "cuda", "label": "CUDA（NVIDIA GPU）"},
                        {"value": "mps", "label": "MPS（Apple Silicon）"}
                    ]},
                    "local_model_quantization": {"label": "本地模型量化", "type": "select", "options": [
                        {"value": "auto", "label": "自动（按优先级降级）"},
                        {"value": "none", "label": "不量化（原生精度，最吃显存）"},
                        {"value": "8bit", "label": "8-bit 量化"},
                        {"value": "4bit", "label": "4-bit 量化（最省显存）"}
                    ]},
                    "cloud_endpoint": {"label": "云端接口地址", "type": "text"},
                    "cloud_model_name": {"label": "云端模型名称", "type": "text"},
                    "cloud_timeout": {"label": "云端超时(秒)", "type": "range", "min": 10, "max": 300, "step": 5},
                    "max_length": {"label": "最大输出长度", "type": "range", "min": 512, "max": 16384, "step": 128},
                    "temperature": {"label": "温度(创造性)", "type": "range", "min": 0.0, "max": 2.0, "step": 0.05},
                    "enable_deep_thinking": {"label": "启用深度思考", "type": "boolean"},
                }
            },
            "cloud_privacy": {
                "label": "云端隐私（分类控制）",
                "items": {
                    "cloud_privacy": {"label": "云端隐私总开关（开启后按下方分类过滤）", "type": "boolean"},
                    "priv_send_memory": {"label": "允许发送：记忆数据（记忆河流/扫描记忆）", "type": "boolean"},
                    "priv_send_scan": {"label": "允许发送：扫描结果（端口/服务/漏洞）", "type": "boolean"},
                    "priv_send_knowledge": {"label": "允许发送：知识库文档内容", "type": "boolean"},
                    "priv_send_feedback": {"label": "允许发送：反馈学习数据", "type": "boolean"},
                    "priv_send_history": {"label": "允许发送：对话历史（上下文连贯需要）", "type": "boolean"},
                    "priv_send_tool_results": {"label": "允许发送：工具调用结果（AI回答需要）", "type": "boolean"},
                    "priv_send_user_context": {"label": "允许发送：用户上下文（主动提供的信息）", "type": "boolean"},
                    "priv_send_system_prompt": {"label": "允许发送：系统提示词（人格/身份设置）", "type": "boolean"},
                }
            },
            "paths": {
                "label": "路径与目录",
                "items": {
                    "seclists_path": {"label": "SecLists 字典路径", "type": "text"},
                    "memory_private_dir": {"label": "私有记忆目录", "type": "text"},
                    "memory_global_dir": {"label": "全局记忆目录", "type": "text"},
                    "log_dir": {"label": "日志目录", "type": "text"},
                    "wordlist_path": {"label": "自定义字典路径", "type": "text"},
                }
            },
            "runtime": {
                "label": "运行参数",
                "items": {
                    "enable_security": {"label": "启用安全工具", "type": "boolean"},
                    "web_host": {"label": "Web 监听地址", "type": "text"},
                    "web_port": {"label": "Web 端口", "type": "range", "min": 1024, "max": 65535, "step": 1},
                    "debug_mode": {"label": "调试模式", "type": "boolean"},
                    "max_conversation_history": {"label": "对话历史轮数", "type": "range", "min": 1, "max": 100, "step": 1},
                    "auto_save_interval": {"label": "自动保存间隔(秒)", "type": "range", "min": 10, "max": 600, "step": 10},
                    "scan_timeout": {"label": "扫描超时(秒)", "type": "range", "min": 30, "max": 3600, "step": 30},
                    "scan_threads": {"label": "扫描并发数", "type": "range", "min": 1, "max": 100, "step": 1},
                }
            },
            "vectorization": {
                "label": "向量化与知识库",
                "items": {
                    "semantic_enabled": {"label": "启用语义向量模型（关闭则不加载/下载模型，用TF-IDF或TagHash）", "type": "boolean"},
                    "vectorization_engine": {"label": "向量化引擎", "type": "select", "options": [
                        {"value": "tag", "label": "TagHash（标签哈希，最快）"},
                        {"value": "tfidf", "label": "TF-IDF（词频统计）"},
                        {"value": "semantic", "label": "Semantic（本地语义模型）"},
                        {"value": "cloud_api", "label": "Cloud API（云端Embedding）"}
                    ]},
                    "vectorization_dimension": {"label": "向量维度", "type": "range", "min": 64, "max": 1024, "step": 64},
                    "vectorization_normalize": {"label": "向量归一化", "type": "boolean"},
                    "semantic_model_name": {"label": "语义模型名称或本地路径", "type": "text", "placeholder": "模型名（自动下载）或本地绝对路径"},
                    "semantic_device": {"label": "语义模型设备", "type": "select", "options": [
                        {"value": "auto", "label": "自动（推荐）"},
                        {"value": "cpu", "label": "CPU"},
                        {"value": "cuda", "label": "CUDA（NVIDIA GPU）"},
                        {"value": "mps", "label": "MPS（Apple Silicon）"}
                    ]},
                    "semantic_cache_size": {"label": "语义缓存条数", "type": "range", "min": 100, "max": 10000, "step": 100},
                    "cloud_api_key": {"label": "云端Embedding密钥", "type": "text", "placeholder": "sk-...（不持久化，仅本次运行）"},
                    "cloud_api_endpoint": {"label": "云端Embedding端点", "type": "text", "placeholder": "https://api.openai.com/v1/embeddings"},
                    "cloud_api_model": {"label": "云端Embedding模型", "type": "text", "placeholder": "text-embedding-3-small"},
                    "cloud_api_timeout": {"label": "云端Embedding超时(秒)", "type": "range", "min": 5, "max": 120, "step": 5},
                    "cloud_api_cache_size": {"label": "云端缓存条数", "type": "range", "min": 100, "max": 5000, "step": 100},
                }
            },
            "appearance": {
                "label": "外观",
                "items": {
                    "theme": {"label": "主题色", "type": "select", "options": ["purple", "dark", "ocean", "forest", "sunset"]},
                    "font_size": {"label": "字体大小", "type": "select", "options": ["small", "medium", "large"]},
                    "animations": {"label": "窗口动画", "type": "boolean"},
                    "window_shadow": {"label": "窗口阴影", "type": "boolean"},
                    "code_font_family": {"label": "代码字体", "type": "text"},
                }
            },
            "ai_ui": {
                "label": "AI 界面偏好",
                "items": {
                    "ai_temperature": {"label": "界面温度(创造性)", "type": "range", "min": 0.0, "max": 2.0, "step": 0.05},
                    "ai_max_tokens": {"label": "界面最大输出", "type": "range", "min": 256, "max": 16384, "step": 256},
                    "ai_top_p": {"label": "Top-P", "type": "range", "min": 0.1, "max": 1.0, "step": 0.05},
                    "stream_output": {"label": "流式输出", "type": "boolean"},
                    "auto_save_chat": {"label": "自动保存对话", "type": "boolean"},
                    "max_chat_history": {"label": "界面历史条数", "type": "range", "min": 10, "max": 500, "step": 10},
                }
            },
            "security_ui": {
                "label": "安全与隐私（界面）",
                "items": {
                    "privacy_filter": {"label": "隐私脱敏引擎", "type": "boolean"},
                    "ssh_tunnel_auto": {"label": "SSH隧道自动检查", "type": "boolean"},
                    "browser_user_agent": {"label": "浏览器 User-Agent", "type": "text"},
                }
            },
            "system_ui": {
                "label": "系统（界面）",
                "items": {
                    "language": {"label": "语言", "type": "select", "options": [
                        {"value": "zh", "label": "中文"},
                        {"value": "en", "label": "English"}
                    ]},
                    "sound_effects": {"label": "音效", "type": "boolean"},
                    "notification_sound": {"label": "通知提示音", "type": "boolean"},
                    "show_timestamps": {"label": "显示时间戳", "type": "boolean"},
                    "auto_update_check": {"label": "自动检查更新", "type": "boolean"},
                }
            },
            "tool_gov": {
                "label": "工具治理（模型权限）",
                "items": {
                    "gov_enabled": {"label": "启用工具治理", "type": "boolean", "gov_key": "enabled"},
                    "gov_model_can_call": {"label": "允许模型调用工具", "type": "boolean", "gov_key": "model_can_call_tools"},
                    "gov_show_status": {"label": "显示工具调用状态", "type": "boolean", "gov_key": "show_tool_status"},
                    "gov_auto_risk": {"label": "自动执行最高风险级别", "type": "select", "options": [
                        {"value": "safe", "label": "仅安全（只读）"},
                        {"value": "low", "label": "低风险（含扫描）"},
                        {"value": "medium", "label": "中风险（含爆破）"},
                        {"value": "high", "label": "高风险（含破解）"}
                    ], "gov_key": "auto_approve_max_risk"},
                    "gov_model_visible_risk": {"label": "模型可调用的最高风险级别（仅决定是否提供给模型，高出的仍需授权）", "type": "select", "options": [
                        {"value": "safe", "label": "仅安全（默认）"},
                        {"value": "low", "label": "低风险"},
                        {"value": "medium", "label": "中风险"},
                        {"value": "high", "label": "高风险"}
                    ], "gov_key": "model_visible_max_risk"},
                    "gov_audit": {"label": "记录操作审计日志", "type": "boolean", "gov_key": "audit_enabled"},
                    "gov_log_params": {"label": "审计记录工具参数", "type": "boolean", "gov_key": "log_params"},
                    "gov_retries": {"label": "失败重试次数", "type": "range", "min": 0, "max": 5, "step": 1, "gov_key": "max_retries"},
                    "gov_fallback": {"label": "失败回退策略", "type": "select", "options": [
                        {"value": "retry_then_alternate", "label": "重试后切换工具"},
                        {"value": "skip", "label": "跳过失败工具"},
                        {"value": "abort", "label": "中止操作"}
                    ], "gov_key": "fallback_strategy"},
                    "gov_type_web": {"label": "允许Web工具（搜索/抓取）", "type": "boolean", "gov_key": "enabled_types.web"},
                    "gov_type_native": {"label": "允许原生安全工具", "type": "boolean", "gov_key": "enabled_types.native"},
                    "gov_type_external": {"label": "允许外部工具（nmap等）", "type": "boolean", "gov_key": "enabled_types.external"},
                    "gov_type_plugin": {"label": "允许内置插件", "type": "boolean", "gov_key": "enabled_types.plugin"},
                    "gov_type_wordlist": {"label": "允许使用字典资源", "type": "boolean", "gov_key": "enabled_types.wordlist"},
                    "gov_type_installable": {"label": "允许安装新工具", "type": "boolean", "gov_key": "enabled_types.installable"},
                    "gov_cat_info": {"label": "类别：信息收集", "type": "boolean", "gov_key": "enabled_categories.信息收集"},
                    "gov_cat_scan": {"label": "类别：扫描爆破", "type": "boolean", "gov_key": "enabled_categories.扫描爆破"},
                    "gov_cat_codec": {"label": "类别：编码解码", "type": "boolean", "gov_key": "enabled_categories.编码解码"},
                    "gov_cat_web": {"label": "类别：网络工具", "type": "boolean", "gov_key": "enabled_categories.网络工具"},
                    "gov_cat_ext": {"label": "类别：外部工具", "type": "boolean", "gov_key": "enabled_categories.外部工具"},
                    "gov_cat_plugin": {"label": "类别：插件工具", "type": "boolean", "gov_key": "enabled_categories.插件工具"},
                    "gov_cat_dict": {"label": "类别：字典资源", "type": "boolean", "gov_key": "enabled_categories.字典资源"},
                    "gov_cat_mgmt": {"label": "类别：工具管理", "type": "boolean", "gov_key": "enabled_categories.工具管理"},
                }
            }
        }

    def export_settings(self, user_id: str = "", include_sensitive: bool = False) -> Dict[str, Any]:
        """导出设置"""
        settings = self.get_all_settings(user_id)
        if not include_sensitive:
            sensitive_keys = [k for k in settings if any(s in k.lower()
                            for s in ["password", "secret", "token", "key", "api"])]
            for k in sensitive_keys:
                settings[k] = "***"
        return {
            "exported_at": time.time(),
            "user_id": user_id,
            "settings": settings,
            "version": "1.0",
        }

    def import_settings(self, settings_data: Dict[str, Any],
                        user_id: str = "", overwrite: bool = True) -> Tuple[int, int]:
        """导入设置"""
        imported = 0
        skipped = 0
        settings = settings_data.get("settings", {})
        for key, value in settings.items():
            if not overwrite and self.get(key, user_id) is not None:
                skipped += 1
                continue
            success, _ = self.set(key, value, user_id)
            if success:
                imported += 1
            else:
                skipped += 1
        return imported, skipped

    def get_user_preferences(self, user_id: str) -> Optional[UserPreferences]:
        return self._user_preferences.get(user_id)
