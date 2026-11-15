# models/model_engine.py
# 模型引擎：负责本地/云端模型的加载、推理、流式生成
# 支持量化加载（4bit/8bit）、CPU/GPU 混合、自动降级
import os
import sys
import json
import time
import math
import random
import threading
import hashlib
import re
from collections import deque, OrderedDict
from datetime import datetime
from typing import Dict, List, Optional, Any, Callable
try:
    import jieba
except ImportError:
    jieba = None

# 尝试导入 transformers 相关
try:
    import torch
except ImportError:
    torch = None

try:
    from transformers import AutoModelForCausalLM, AutoTokenizer, GenerationConfig, TextIteratorStreamer
    try:
        from transformers import logging as _transformers_logging
        logger = _transformers_logging.get_logger(__name__)
    except Exception:
        logger = None
except ImportError:
    AutoModelForCausalLM = None
    AutoTokenizer = None
    GenerationConfig = None
    TextIteratorStreamer = None
    logger = None

# 兜底：纯云端安装（未安装 transformers）时 logger 会是 None，
# 会让下面所有 logger.warning/info 抛 AttributeError，把真正的错误盖掉。
if logger is None:
    import logging as _std_logging
    logger = _std_logging.getLogger(__name__)

# 尝试导入 bitsandbytes（量化）
# bitsandbytes 与某些 torch 版本不兼容时，可能在导入阶段抛出 AttributeError
# （例如 module 'torch' has no attribute 'library'），这不应导致整个模型引擎无法加载。
bitsandbytes = None
bitsandbytes_import_error = None
try:
    import bitsandbytes
except Exception as exc:  # noqa: BLE001 - optional dependency may fail under incompatible envs
    bitsandbytes_import_error = exc
    bitsandbytes = None
    if logger is not None:
        logger.warning("bitsandbytes 不可用，跳过 8-bit/4-bit 量化: %s", exc)

# 尝试导入 llama-cpp-python（GGUF格式支持，加载速度快3-5倍，显存占用小）
# 某些 Windows / 打包环境下，llama_cpp 的原生库路径可能不存在，导致 FileNotFoundError
# 或其他加载错误；这不应让整个 MrHua 在启动时崩溃。
LlamaCpp = None
_llama_cpp_available = False
llama_cpp_import_error = None
try:
    from llama_cpp import Llama as LlamaCpp
    _llama_cpp_available = True
except Exception as exc:  # noqa: BLE001 - optional native dependency may fail on missing DLLs
    llama_cpp_import_error = exc
    LlamaCpp = None
    _llama_cpp_available = False
    if logger is not None:
        logger.warning("llama_cpp 不可用，GGUF 模型加载已禁用: %s", exc)

# 尝试导入 requests（云端调用）
try:
    import requests
except ImportError:
    requests = None

# SSH隧道管理器
try:
    from libertas.network.ssh_tunnel import SSHTunnelManager
except Exception:
    SSHTunnelManager = None

# 隐私脱敏引擎
try:
    from libertas.security.privacy import PrivacySanitizer
except Exception:
    PrivacySanitizer = None

# 导入用户管理（用于规则加载）
from libertas.identity.user import UserManager
from libertas.tools.batch_executor import extract_tasks_from_reply, BatchExecutor
from libertas.foundation.config import get_data_dir

# ==================== 模型LRU缓存 ====================
from .model_cache import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403
from .methods_1 import *  # noqa: F401,F403

class ModelEnginePart2(object):
    def _switch_memory_for_active_user(self):
        """根据当前活跃用户切换记忆目录：主用户用MemorySystem，子用户用users目录。
        返回 True 表示发生了目录切换（用户切换），False 表示目录未变。"""
        if not self.memory_system:
            return False
        try:
            from libertas.foundation.config import config as global_config
            sub = self._get_active_sub_user()
            if sub and sub.get('name'):
                # 子用户记忆目录：~/MrHuaData/users/{子用户名}/
                from libertas.foundation.config import data_path
                base = data_path()
                sub_dir = os.path.join(base, 'users', sub['name'])
            else:
                # 主用户记忆目录：~/MrHuaData/MemorySystem
                sub_dir = global_config.resolve_path(global_config.get('memory_private_dir', ''))
            os.makedirs(sub_dir, exist_ok=True)
            os.makedirs(os.path.join(sub_dir, '记忆河流'), exist_ok=True)
            os.makedirs(os.path.join(sub_dir, '扫描记忆'), exist_ok=True)
            switched = os.path.abspath(self.memory_system.PrivateDir) != os.path.abspath(sub_dir)
            if switched:
                self.memory_system.PrivateDir = sub_dir
                self.memory_system.MemoryDirectory = sub_dir
                self.memory_system.MemoryRiverDirectory = os.path.join(sub_dir, '记忆河流')
                self.memory_system.ScanMemoryDirectory = os.path.join(sub_dir, '扫描记忆')
                self.memory_system.RulePath = os.path.join(sub_dir, '规则.json')
                self.memory_system.SystemStatePath = os.path.join(sub_dir, '系统状态.json')
                self.memory_system.MetadataPath = os.path.join(sub_dir, '系统元数据.json')
                # 重新加载所有数据
                self.memory_system.MemoryCache = {}
                from collections import defaultdict
                self.memory_system.MemoryIndex = defaultdict(list)
                self.memory_system.ScanIndex = defaultdict(list)
                self.memory_system.scan_vectors = {}
                # 加载扫描索引
                if hasattr(self.memory_system, '_load_scan_index'):
                    self.memory_system._load_scan_index()
                # 加载系统元数据
                if hasattr(self.memory_system, '_load_system_metadata'):
                    self.memory_system.SystemMetadata = self.memory_system._load_system_metadata()
                # 加载规则
                if hasattr(self.memory_system, '_load_rule'):
                    self.memory_system.Rule = self.memory_system._load_rule()
                # 加载系统状态
                if hasattr(self.memory_system, '_load_system_state'):
                    self.memory_system.SystemState = self.memory_system._load_system_state()
                # 重建主题索引（从磁盘文件）
                if hasattr(self.memory_system, '_rebuild_memory_index'):
                    self.memory_system._rebuild_memory_index()
                # 重建向量索引
                if hasattr(self.memory_system, '_build_scan_vector_index'):
                    self.memory_system._build_scan_vector_index()
                # 重置并重建认知网络（清除旧用户的哈希，用新目录的记忆重建）
                if hasattr(self.memory_system, '_cognitive_network') and self.memory_system._cognitive_network:
                    self.memory_system._cognitive_network.reset()
                    self.memory_system._cognitive_network._initialize_cognitive_network()
                print(f"🔄 已切换记忆目录: {sub_dir}")
            return switched
        except Exception as e:
            print(f"⚠️ 切换记忆目录失败: {e}")
            import traceback
            traceback.print_exc()
            return False
    def _is_thinking_enabled(self) -> bool:
        """检查是否启用思考过程，优先级：子用户身份档案 > 主用户设置 > 默认开启"""
        # 子用户身份档案设置
        sub_identity = self._get_active_sub_identity()
        if sub_identity and '思考过程' in sub_identity:
            val = str(sub_identity['思考过程']).strip().lower()
            if val in ('关闭', 'false', '0', 'off', 'no', '禁用'):
                return False
            if val in ('开启', 'true', '1', 'on', 'yes', '启用'):
                return True
        # 主用户设置（prompt_engine）
        return getattr(self.prompt_engine, 'thinking_enabled', True)
    def _enhance_system_prompt(self):
        """用PromptEngine构建完整多层系统提示词。
        层级：身份 → 用户自定义人格 → 预设行为准则 → 场景 → 服从 → 沉浸感 → 指令 → 硬规则
        预设人格只叠加行为准则，不覆盖用户自定义的身份和系统提示词。
        子用户身份档案激活时，其自定义身份覆盖主用户身份。
        """
        try:
            username = self.user_manager.get_effective_username()
            rules = self.user_manager.load_rules(username, force_reload=True)
            identity = rules.get("身份信息", {})
            # 子用户身份档案覆盖
            sub_identity = self._get_active_sub_identity()
            if sub_identity:
                identity = {**identity, **sub_identity}
            principles = rules.get("核心原则", [])
            base = rules.get("系统提示词", "")
            # 先切换记忆目录，检测是否发生了用户切换
            user_switched = self._switch_memory_for_active_user()
            # 用户切换时重置提示词引擎和对话历史，防止旧用户配置/上下文泄漏
            # 但程序启动时（_prompt_config_loaded=True）不 reset，防止覆盖刚从磁盘加载的人格配置
            # reload_prompt_config() 调用时（_reloading_prompt_config=True）也不 reset，防止覆盖刚设置的人格配置
            if user_switched and not getattr(self, '_prompt_config_loaded', False) and not getattr(self, '_reloading_prompt_config', False):
                self.prompt_engine.reset()
                self.conversation_history.clear()
            # 只有用户切换时才从磁盘导入配置；其他时候使用内存中的会话配置
            # 避免每次对话/设置都用磁盘配置覆盖用户刚设置的人格、服从等级、思考开关等
            # 程序启动时（_prompt_config_loaded=True）已经在 __init__ 中导入了，不需要重复导入
            if username and user_switched and not getattr(self, '_prompt_config_loaded', False):
                pe_cfg = rules.get("提示词配置", {})
                if pe_cfg:
                    self.prompt_engine.import_config(pe_cfg)
            # 程序启动后，清除标志位，让后续用户切换时正常 reset 和导入
            if getattr(self, '_prompt_config_loaded', False):
                self._prompt_config_loaded = False
            enhanced = self.prompt_engine.build_system_prompt(
                identity=identity,
                principles=principles,
                base_prompt=base
            )
            if enhanced:
                self.system_prompt = enhanced
        except Exception:
            # 增强失败时保留基础提示词，不使用错误字符串
            if not self.system_prompt or "请先设置" in self.system_prompt:
                self.system_prompt = self._create_system_prompt()
    def reload_prompt_config(self):
        """重新加载提示词配置（用户修改后调用）"""
        self.system_prompt = self._create_system_prompt()
        # 设置标志位，防止 _enhance_system_prompt() 中的 reset() 覆盖刚设置的人格配置
        self._reloading_prompt_config = True
        self._enhance_system_prompt()
        self._reloading_prompt_config = False
        return self.system_prompt
    def _persist_prompt_config(self):
        try:
            username = self.user_manager.get_effective_username()
            if not username:
                return  # 未登录时配置仅保存在内存中
            rules = self.user_manager.load_rules(username, force_reload=True)
            rules['提示词配置'] = self.prompt_engine.export_config()
            self.user_manager.save_rules(rules, username)
        except Exception:
            pass
    def set_prompt_scenario(self, scenario: str) -> bool:
        ok = self.prompt_engine.set_scenario(scenario)
        if ok:
            self._persist_prompt_config()
            self._enhance_system_prompt()
        return ok
    def set_prompt_obedience(self, level: str) -> bool:
        ok = self.prompt_engine.set_obedience(level)
        if ok:
            self._persist_prompt_config()
            self._enhance_system_prompt()
        return ok
    def set_immersion(self, key: str, enabled: bool) -> bool:
        ok = self.prompt_engine.set_immersion(key, enabled)
        if ok:
            self._persist_prompt_config()
            self._enhance_system_prompt()
        return ok
    def set_search_auth(self, level: int) -> bool:
        ok = self.prompt_engine.set_search_auth(level)
        if ok:
            self._persist_prompt_config()
            self._enhance_system_prompt()
        return ok
    def add_custom_instruction(self, instruction: str):
        self.prompt_engine.add_instruction(instruction)
        self._persist_prompt_config()
        self._enhance_system_prompt()
    def get_prompt_config(self) -> Dict[str, Any]:
        return self.prompt_engine.export_config()
    def get_system_prompt_preview(self) -> str:
        """返回当前实际使用的系统提示词预览（与发送给模型的一致）"""
        try:
            # 先确保系统提示词是最新的
            self._enhance_system_prompt()
            return self.system_prompt or "[系统提示词为空]"
        except Exception as e:
            return f"[预览生成失败: {e}]"
    def _load_identity(self) -> Dict[str, Any]:
        try:
            from libertas.data.data_manager import DataDirectoryManager as DataManager
            import json, os
            path = os.path.join(DataManager.get_settings_dir(), "identity.json")
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass
        return {}
    def _load_principles(self) -> List[str]:
        try:
            from libertas.data.data_manager import DataDirectoryManager as DataManager
            import json, os
            path = os.path.join(DataManager.get_settings_dir(), "principles.json")
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass
        return []
    def get_persona_presets(self) -> List[Dict]:
        return self.prompt_engine.list_persona_presets()
    def generate_code_with_cloud(self, task: str, language: str = "",
                                  code_context: str = "", file_path: str = "") -> Dict[str, Any]:
        """用云端模型生成代码"""
        # 防御：确保 task 是 str
        if isinstance(task, bytes):
            task = task.decode('utf-8', errors='replace')
        elif not isinstance(task, str):
            task = str(task)
        if isinstance(language, bytes):
            language = language.decode('utf-8', errors='replace')
        elif language is not None and not isinstance(language, str):
            language = str(language)
        if isinstance(code_context, bytes):
            code_context = code_context.decode('utf-8', errors='replace')
        elif code_context is not None and not isinstance(code_context, str):
            code_context = str(code_context)
        if isinstance(file_path, bytes):
            file_path = file_path.decode('utf-8', errors='replace')
        elif file_path is not None and not isinstance(file_path, str):
            file_path = str(file_path)
        if self.runtime_mode == "local":
            return {"success": False, "error": "代码生成需要云端模型，请切换到云端模式"}
        code_prompt = self.prompt_engine.build_code_prompt(task, language, code_context, file_path)
        original_scenario = self.prompt_engine.current_scenario
        self.prompt_engine.set_scenario("code_generation")
        self._enhance_system_prompt()
        try:
            result = self._call_cloud_api(code_prompt, max_length=self._resolve_max_length(), temperature=0.3)
            return {"success": True, "code": result, "language": language, "file_path": file_path}
        except Exception as e:
            return {"success": False, "error": str(e)}
        finally:
            self.prompt_engine.set_scenario(original_scenario)
            self._enhance_system_prompt()
    def _resolve_runtime_mode(self) -> str:
        model_config = self.configuration.get("模型", {}) or {}
        mode = str(model_config.get("运行模式", "local") or "local").strip().lower()
        if mode not in {"local", "cloud", "auto"}:
            mode = "local"
        return mode
    def set_runtime_mode(self, mode: str) -> str:
        normalized = str(mode or "local").strip().lower()
        if normalized not in {"local", "cloud", "auto"}:
            normalized = "local"
        self.configuration.setdefault("模型", {})["运行模式"] = normalized
        self.runtime_mode = normalized
        return normalized
    def _non_chat_model_kind(self, model_name: str) -> str:
        """若是非对话模型，返回类型描述；否则返回空串。

        判定顺序（特异性优先，避免品牌名前缀误吸）：
        视频强特征 -> 图片强特征 -> 图片通用 -> 语音 -> 嵌入 -> 万相品牌兜底
        """
        name = str(model_name or "").strip().lower()
        if not name:
            return ""
        if any(h in name for h in self._KIND_VIDEO_HINTS):
            return "视频生成"
        if any(h in name for h in self._KIND_IMAGE_HINTS):
            return "图片生成"
        if any(h in name for h in self._KIND_IMAGE_GENERIC):
            return "图片生成"
        if any(h in name for h in self._KIND_AUDIO_HINTS):
            return "语音"
        if any(h in name for h in self._KIND_EMBED_HINTS):
            return "嵌入/重排"
        if any(h in name for h in self._KIND_WAN_BRAND):
            return "图片生成"   # wanx-v1 / wanx-t2i 等，带 video 的已被上面命中
        return ""
    def _resolve_max_length(self, max_length: int = None) -> int:
        """解析统一的最大输出长度，显式参数优先于模型配置和默认值。"""
        model_cfg = self.configuration.get("模型", {}) or {}
        gen_cfg = self.generate_configuration or {}
        candidates = [max_length]
        for key in self._MAX_LENGTH_KEYS:
            candidates.append(model_cfg.get(key))
        for key in self._MAX_LENGTH_KEYS:
            candidates.append(self.configuration.get(key))
        for key in self._MAX_LENGTH_KEYS:
            candidates.append(gen_cfg.get(key))
        # 全局 config.yaml（顶层 max_length）
        try:
            from libertas.foundation.config import config as global_config
            candidates.append(global_config.get("max_length"))
        except Exception:
            pass
        for candidate in candidates:
            try:
                value = int(candidate)
            except (TypeError, ValueError):
                continue
            if value > 0:
                return value
        return self.DEFAULT_MAX_LENGTH
    def _is_cloud_privacy_enabled(self) -> bool:
        """检查云端隐私保护总开关是否开启"""
        try:
            from libertas.foundation.config import config as global_config
            sys_cfg = self.configuration.get("系统", {}) if self.configuration else {}
            val = sys_cfg.get("云端隐私保护", global_config.get("cloud_privacy", True))
            return bool(val)
        except Exception:
            return True
    def _privacy_allows(self, category: str) -> bool:
        """检查某类数据是否允许发送到云端。

        总开关关闭时，所有类别都允许（向后兼容）。
        总开关开启时，由各分类开关单独控制（默认不允许敏感数据）。
        """
        if not self._is_cloud_privacy_enabled():
            return True
        try:
            from libertas.foundation.config import config as global_config
            sys_cfg = self.configuration.get("系统", {}) if self.configuration else {}
            key_map = {
                "memory": "priv_send_memory",
                "scan": "priv_send_scan",
                "knowledge": "priv_send_knowledge",
                "feedback": "priv_send_feedback",
                "history": "priv_send_history",
                "tool_results": "priv_send_tool_results",
                "user_context": "priv_send_user_context",
                "system_prompt": "priv_send_system_prompt",
            }
            cfg_key = key_map.get(category)
            if not cfg_key:
                return False
            # 系统配置中的键名可能是中文或英文
            val = sys_cfg.get(cfg_key, global_config.get(cfg_key, None))
            if val is None:
                # 安全默认值：敏感类别默认不允许
                safe_defaults = {
                    "memory": False, "scan": False, "knowledge": False,
                    "feedback": False, "history": True, "tool_results": True,
                    "user_context": True, "system_prompt": True,
                }
                return safe_defaults.get(category, False)
            return bool(val)
        except Exception:
            return False
    def _sanitize_for_cloud(self, text: str) -> str:
        """
        云端隐私过滤：移除本地记忆内容，保护隐私。
        - 移除"相关记忆信息"段落
        - 移除"相关历史安全扫描"段落
        - 移除"最近的记忆记录"段落
        - 保留用户当前问题和对话历史（对话历史是用户主动输入的）
        """
        # 防御：确保 text 是 str
        if isinstance(text, bytes):
            text = text.decode('utf-8', errors='replace')
        elif text is None:
            return ""
        elif not isinstance(text, str):
            text = str(text)
        if not text:
            return text
        lines = text.split('\n')
        result = []
        skip = False
        for line in lines:
            if any(marker in line for marker in [
                '相关记忆信息:',
                '相关记忆信息：',
                '--- 以下是相关历史安全扫描',
                '--- 请根据上述记录回答',
                '📚 最近的记忆记录：',
                '📝 相关普通记忆：',
                '📋 当前对话中的扫描摘要：',
            ]):
                skip = True
                continue
            if skip:
                if line.startswith('用户问题') or line.startswith('用户：') or line.startswith('花先生回应当前问题'):
                    skip = False
                    result.append(line)
                continue
            result.append(line)
        return '\n'.join(result)
