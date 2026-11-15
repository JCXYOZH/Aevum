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

class ModelEnginePart1(object):
    def __new__(cls, *args, **kwargs):
        # 修复：双重检查锁定，防止多线程竞态创建多个实例
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    def __init__(self, memory_system=None, model_path="", configuration: Dict = None, user_manager: UserManager = None, affinity_engine = None, feedback_learner = None):
        # 确保单例只初始化一次
        if hasattr(self, '_initialized') and self._initialized:
            if logger:
                logger.info("✅ 模型引擎已初始化，跳过重复初始化")
            return
        self.memory_system = memory_system
        self.user_manager = user_manager or UserManager()  # 如果未传入则创建默认
        self.affinity_engine = affinity_engine  # 接收外部注入
        self.feedback_learner = feedback_learner  # 反馈学习器
        self.ssh_tunnel = SSHTunnelManager() if SSHTunnelManager else None
        self.privacy = PrivacySanitizer() if PrivacySanitizer else None

        # 如果 memory_system 存在，也注入 affinity_engine
        if self.memory_system:
            self.memory_system.affinity_engine = affinity_engine
        # 从 UserManager 加载规则（仅用于系统提示词）
        self.rule = self.user_manager.load_rules()
        self.model_path = model_path
        self.configuration = configuration or {}
        self.runtime_mode = self._resolve_runtime_mode()
        self.last_cloud_error = None
        self._cancel_flag = threading.Event()
        self._generating = False
        self._runtime_api_key = ""  # 临时API密钥，不持久化，重启后清空
        # 启动时就把有效密钥发布到全局配置（覆盖命令行 --cloud-api-key 的用法），
        # 否则只有本引擎能用它，生成类功能会读到 config.yaml 的旧值。
        self._publish_cloud_key()
        self._session_primary_model = {}
        self._last_cloud_model_name = ""
        self._last_cloud_session_id = ""
        self._current_model_info = {}  # 当前加载模型的预读取信息
        self._is_gguf_model = False  # 当前加载的是否是GGUF格式模型
        self._gguf_llm = None  # GGUF模型实例（llama-cpp-python）
        # 模型LRU缓存：多个模型同时驻留显存，切换不用重新加载
        _cache_config = (self.configuration.get("模型", {}) or {}).get("模型缓存", {}) or {}
        self._model_cache = ModelCache(
            max_size=_cache_config.get("最大缓存数量"),
            max_vram_gb=_cache_config.get("最大显存GB"),
        )
        self._model_cache_enabled = _cache_config.get("启用", True)

        # 从config.yaml自动配置SSH隧道
        if self.ssh_tunnel:
            try:
                from libertas.foundation.config import config as global_config
                tunnel_cfg = global_config.get("ssh_tunnel", {})
                if tunnel_cfg and tunnel_cfg.get("ssh_host"):
                    self.ssh_tunnel.configure_from_dict(tunnel_cfg)
                    if tunnel_cfg.get("enabled", False):
                        result = self.ssh_tunnel.start()
                        if result.get("success"):
                            print(f"🔒 SSH隧道已连接: {result.get('socks_proxy','')}")
                            # 同步设置web_search代理
                            try:
                                from libertas.tools.legacy_mrhua.web_search import set_proxy as _ws_set_proxy
                                _ws_set_proxy(self.ssh_tunnel.get_requests_proxies())
                            except Exception:
                                pass
                        else:
                            print(f"⚠️ SSH隧道启动失败: {result.get('error','')}")
            except Exception as e:
                print(f"⚠️ SSH隧道配置加载失败: {e}")

        self.model = None
        self.tokenizer = None
        self.loading_failed_permanently = False
        # 设备选择：优先读取 config.yaml 的 local_model_device，默认自动检测
        try:
            from libertas.foundation.config import config as _cfg
            _dev = (_cfg.get('local_model_device', 'auto') or 'auto').lower()
            if _dev == 'cpu':
                self.device = 'cpu'
            elif _dev == 'cuda' and torch and torch.cuda.is_available():
                self.device = 'cuda'
            elif _dev == 'mps' and torch and hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
                self.device = 'mps'
            else:
                self.device = 'cuda' if torch and torch.cuda.is_available() else (
                    'mps' if torch and hasattr(torch.backends, 'mps') and torch.backends.mps.is_available() else 'cpu')
        except Exception:
            self.device = 'cuda' if torch and torch.cuda.is_available() else 'cpu'
        self.model_loading_status = "未加载"
        self.conversation_history = deque(maxlen=10)
        self._loaded = False
        self._loading_in_progress = False
        self._load_lock = threading.RLock()
        self._inference_lock = threading.RLock()
        self.quantization_status = {
            "requested_mode": self.configuration.get("模型", {}).get("量化模式", "auto"),
            "effective": False,
            "success": False,
            "detail": "尚未尝试加载"
        }
        if os.environ.get('BITSANDBYTES_NOWELCOME') is None:
            os.environ['BITSANDBYTES_NOWELCOME'] = '1'
        self.system_prompt = self._create_system_prompt()
        from ..prompt_engine import PromptEngine
        self.prompt_engine = PromptEngine()
        # 程序启动时从磁盘导入人格配置（修复：之前只有用户切换时才导入，导致重启后人格设置丢失）
        try:
            _init_username = self.user_manager.get_effective_username()
            if _init_username:
                _init_rules = self.user_manager.load_rules(_init_username, force_reload=True)
                _init_pe_cfg = _init_rules.get("提示词配置", {})
                if _init_pe_cfg:
                    self.prompt_engine.import_config(_init_pe_cfg)
                    print(f"✅ 人格配置已从磁盘加载: persona={_init_pe_cfg.get('persona', 'default')}, scenario={_init_pe_cfg.get('scenario', 'casual')}, obedience={_init_pe_cfg.get('obedience', 'balanced')}")
        except Exception as _init_e:
            print(f"⚠️ 人格配置加载失败（使用默认值）: {_init_e}")
        self._enhance_system_prompt()
        self.performance_statistics = {
            "总调用次数": 0, "成功生成次数": 0, "生成失败次数": 0,
            "总生成时间": 0, "平均生成时间": 0, "总回复长度": 0, "平均回复长度": 0,
            "最后一次调用": None, "启动时间": datetime.now().isoformat()
        }
        self.generate_configuration = {
            "长度惩罚": 1.0, "默认最大长度": 4096, "默认温度": 0.65, "top_p": 0.85, "top_k": 30,
            "重复惩罚": 1.2, "频率惩罚": 0.3, "存在惩罚": 0.2, "禁止重复n元组": 3,
        }
        self.mixed_loading_configuration = {
            "最小GPU层数": 4, "最大GPU层数": 26, "安全缓冲比例": 0.2,
            "每层大小_GB": 0.18, "总层数": 28
        }
        self._cuda_probe_ok = None   # CUDA 可用性探测结果缓存
        self._cuda_probe_error = ''
        self._prompt_config_loaded = True  # 标记人格配置已从磁盘加载，防止 _enhance_system_prompt 中的 reset() 覆盖
        self._initialized = True
        if logger:
            logger.info(f"🚀 终极花先生模型引擎初始化完成 - 设备: {self.device}")
    def _get_thinking_config(self, key: str, default=None):
        """
        从用户规则中读取思考配置，若不存在则返回全局配置或默认值。
        """
        try:
            rules = self.user_manager.load_rules() if self.user_manager else {}
            thinking_config = rules.get("thinking_config", {})
            return thinking_config.get(key, default)
        except Exception:
            return default
    def _generate_thinking_from_memory(self, user_input: str, user_id: str) -> Optional[str]:
        """
        基于记忆密度和用户状态生成动态思考内容。
        支持从用户 rules.json 的 thinking_config 读取个性化参数：
        - custom_template: 用户自定义模板字符串，支持 {变量} 占位符
        - style: concise / playful / detailed（仅在无模板时生效）
        - min_memories, max_references, low_energy_threshold: 控制检索行为
        若成功返回包含 <thinking> 标签的字符串，否则返回 None。
        """
        if not self.memory_system:
            return None

        # ----- 1. 读取用户配置 -----
        min_memories = self._get_thinking_config("min_memories", 2)
        max_refs = self._get_thinking_config("max_references", 3)
        low_energy = self._get_thinking_config("low_energy_threshold", 0.1)
        style = self._get_thinking_config("style", "concise")          # concise / detailed / playful
        custom_template = self._get_thinking_config("custom_template") # 用户自定义模板（可选）

        try:
            # ----- 2. 密度加权检索相关记忆 -----
            related = self.memory_system.retrieve_by_density(
                user_input, user_id, top_k=max_refs + 1, min_energy=low_energy
            )
            if len(related) < min_memories:
                return None

            # ----- 3. 获取用户三值摘要（Q/K/V） -----
            tri_summary = None
            if self.affinity_engine:
                tri_summary = self.affinity_engine.get_user_tri_value_summary(user_id)

            # ----- 4. 构建上下文变量字典（供模板和风格逻辑使用） -----
            ctx = {
                "user_input": user_input,
                "q_mean": tri_summary.get('q_mean', 0.5) if tri_summary else 0.5,
                "k_mean": tri_summary.get('k_mean', 0.5) if tri_summary else 0.5,
                "v_mean": tri_summary.get('v_mean', 0.5) if tri_summary else 0.5,
                "energy": tri_summary.get('energy', 0.5) if tri_summary else 0.5,
                "phase_transition_count": tri_summary.get('phase_transition_count', 0) if tri_summary else 0,
                "affinity": tri_summary.get('affinity', 0.5) if tri_summary else 0.5,
            }

            # 添加记忆内容（最多3条）
            memory_list = []
            for i, mem in enumerate(related[:3]):
                content = mem.get('内容', '')[:60]
                ctx[f"memory{i+1}"] = content
                memory_list.append(content)
            ctx["memory_summary"] = " ".join(memory_list)

            # 派生变量（便于模板使用）
            ctx["energy_status"] = "积极" if ctx["energy"] > 0.6 else "疲惫" if ctx["energy"] < 0.4 else "平稳"
            ctx["q_tendency"] = "逻辑优先" if ctx["q_mean"] > 0.6 else "情感优先" if ctx["q_mean"] < 0.4 else "平衡"

            # ----- 5. 优先使用用户自定义模板 -----
            if custom_template:
                try:
                    thinking_text = custom_template.format(**ctx)
                    if thinking_text.strip():
                        return f"<thinking>\n{thinking_text}\n</thinking>"
                except KeyError as e:
                    print(f"⚠️ 自定义模板缺少变量 {e}，回退到 style 逻辑")
                except Exception as e:
                    print(f"⚠️ 自定义模板渲染失败: {e}")

            # ----- 6. 回退到内置 style 逻辑 -----
            thinking_parts = []

            if style == "concise":
                # ---------- 简洁风格 ----------
                if ctx.get('q_mean') is not None:
                    if ctx['q_mean'] > 0.6:
                        thinking_parts.append("用户偏好：逻辑导向。")
                    elif ctx['q_mean'] < 0.4:
                        thinking_parts.append("用户偏好：情感导向。")
                if memory_list:
                    mem_summary = " ".join(memory_list[:2])
                    if mem_summary:
                        thinking_parts.append(f"相关记忆：{mem_summary}...")

            elif style == "playful":
                # ---------- 轻松俏皮风格（无角色预设，保留轻松语气） ----------
                if ctx.get('energy') is not None:
                    if ctx['energy'] > 0.6:
                        thinking_parts.append("用户看起来心情不错，可以用轻松的语气回应～")
                    else:
                        thinking_parts.append("用户似乎有些疲惫，回应时温和一些比较好。")
                if memory_list:
                    mem_texts = [f"之前提到过: {m}..." for m in memory_list[:2] if m]
                    if mem_texts:
                        thinking_parts.append("我记得： " + " ".join(mem_texts))

            else:  # style == "detailed"（默认详细风格）
                # ---------- 详细风格 ----------
                if ctx.get('q_mean') is not None:
                    q = ctx['q_mean']
                    if q > 0.6:
                        thinking_parts.append("用户倾向：注重逻辑和事实。")
                    elif q < 0.4:
                        thinking_parts.append("用户倾向：注重情感和体验。")
                    else:
                        thinking_parts.append("用户倾向：平衡兼顾。")

                if ctx.get('k_mean') is not None:
                    k = ctx['k_mean']
                    if k > 0.7:
                        thinking_parts.append("知识储备：用户对此话题较熟悉。")
                    elif k < 0.3:
                        thinking_parts.append("知识储备：用户可能需要基础解释。")

                if ctx.get('v_mean') is not None and ctx.get('energy') is not None:
                    v = ctx['v_mean']
                    energy = ctx['energy']
                    if v > 0.7 and energy > 0.6:
                        thinking_parts.append("用户情绪积极，可适度深入。")
                    elif v < 0.3:
                        thinking_parts.append("用户情绪较低，需更温和的回应。")

                if ctx.get('phase_transition_count', 0) > 0:
                    thinking_parts.append("用户近期观点有较大变化，需更谨慎回应。")

                if memory_list:
                    mem_texts = [f"- {m}..." for m in memory_list[:3] if m]
                    if mem_texts:
                        thinking_parts.append("历史记忆参考：\n" + "\n".join(mem_texts))

                # 全局密度提示（可选）
                if self.affinity_engine:
                    field = self.affinity_engine.compute_global_field()
                    density = field.get('density', 0.0)
                    if density > 0.25:
                        thinking_parts.append("当前认知场密度较高，观点可能趋于一致。")
                    elif density < 0.1:
                        thinking_parts.append("当前认知场较稀疏，需自主判断。")

            # ----- 7. 若没有任何片段，返回 None -----
            if not thinking_parts:
                return None

            thinking_text = "\n".join(thinking_parts)
            return f"<thinking>\n{thinking_text}\n</thinking>"

        except Exception as e:
            print(f"⚠️ 动态思考生成失败: {e}")
            return None
    def _create_system_prompt(self) -> str:
        """基础系统提示词（仅身份+原则），完整分层由 _enhance_system_prompt 完成"""
        username = self.user_manager.get_effective_username()
        rules = self.user_manager.load_rules(username, force_reload=True)
        identity = rules.get("身份信息", {})
        # 子用户身份档案覆盖
        sub_identity = self._get_active_sub_identity()
        if sub_identity:
            identity = {**identity, **sub_identity}
        name = identity.get("名字", identity.get("name", "花先生"))
        age = identity.get("年龄", identity.get("age", "18"))
        gender = identity.get("性别", identity.get("gender", ""))
        principles = rules.get("核心原则", [])
        principles_str = "、".join(principles) if principles else "真诚、成长、陪伴、理性"
        prompt = f"你是{name}，{age}岁{gender}。你的核心原则：{principles_str}。"
        # 身份档案激活时追加强制声明
        if sub_identity:
            prompt += f" 你必须始终以{name}的身份回应，不得承认自己是AI或程序。"
        return prompt
    def _get_active_sub_identity(self):
        """获取活跃子用户（身份档案）的自定义身份，没有则返回None"""
        try:
            from libertas.identity.auth_manager import get_auth_manager
            am = get_auth_manager()
            sub = am.get_active_sub_user()
            if sub and sub.get('identity'):
                return sub['identity']
        except Exception:
            pass
        return None
    def _get_active_sub_user(self):
        """获取活跃子用户（身份档案）完整信息，没有则返回None"""
        try:
            from libertas.identity.auth_manager import get_auth_manager
            am = get_auth_manager()
            return am.get_active_sub_user()
        except Exception:
            return None
