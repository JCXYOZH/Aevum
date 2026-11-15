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
from .methods_2 import *  # noqa: F401,F403

class ModelEnginePart3(object):
    def _filter_scan_from_text(self, text: str) -> str:
        """从文本中移除扫描结果相关段落"""
        if not text:
            return ""
        lines = text.split('\n')
        result = []
        skip = False
        scan_markers = ['扫描结果', '端口扫描', '开放端口', '服务版本', '漏洞', 'nmap', 'masscan',
                        '扫描摘要', '安全扫描', '端口：', '端口:', '服务：', '服务:']
        for line in lines:
            if any(m in line for m in scan_markers):
                skip = True
                continue
            if skip:
                # 空行或新段落标记时恢复
                if not line.strip() or line.startswith('相关') or line.startswith('用户') or line.startswith('记忆'):
                    skip = False
                    if line.strip():
                        result.append(line)
                continue
            result.append(line)
        return '\n'.join(result)
    def _sanitize_history_for_cloud(self, history: deque) -> List[str]:
        """过滤对话历史中的敏感条目（按分类隐私设置）"""
        allow_history = self._privacy_allows("history")
        allow_scan = self._privacy_allows("scan")
        allow_tool = self._privacy_allows("tool_results")

        if not self._is_cloud_privacy_enabled():
            return list(history)

        filtered = []
        for entry in history:
            if isinstance(entry, bytes):
                entry = entry.decode('utf-8', errors='replace')
            elif not isinstance(entry, str):
                entry = str(entry)

            if not allow_history:
                continue
            # 系统扫描注入条目
            if not allow_scan and entry.startswith('系统: 执行') and '扫描' in entry:
                continue
            # 工具调用结果
            if not allow_tool and ('[工具结果]' in entry or '<<<' in entry):
                continue
            filtered.append(entry)
        return filtered
    def _build_cloud_messages(self, prompt: str) -> List[Dict[str, str]]:
        """
        修复：构建包含对话历史的 messages 列表。
        将 self.conversation_history 中的 "用户: xxx" / "花先生: xxx" 解析为
        {"role": "user"/"assistant", "content": "..."} 格式。
        """
        # 防御：确保 prompt 是 str
        if isinstance(prompt, bytes):
            prompt = prompt.decode('utf-8', errors='replace')
        elif not isinstance(prompt, str):
            prompt = str(prompt)
        messages = []
        if self.system_prompt and self._privacy_allows("system_prompt"):
            _sp = self.system_prompt
            if isinstance(_sp, bytes):
                _sp = _sp.decode('utf-8', errors='replace')
            elif not isinstance(_sp, str):
                _sp = str(_sp)
            messages.append({"role": "system", "content": _sp})
        elif self.system_prompt and not self._privacy_allows("system_prompt"):
            # 不发送完整系统提示词，但发送最小行为指令
            messages.append({"role": "system", "content": "你是一个有用的AI助手，请直接回答用户问题。"})
        # 加入对话历史（按隐私设置过滤）
        history_list = self._sanitize_history_for_cloud(self.conversation_history)
        for entry in history_list:
            # 防御：确保 entry 是 str
            if isinstance(entry, bytes):
                entry = entry.decode('utf-8', errors='replace')
            elif not isinstance(entry, str):
                entry = str(entry)
            if entry.startswith("用户: "):
                messages.append({"role": "user", "content": entry[3:].strip()})
            elif entry.startswith("花先生: "):
                messages.append({"role": "assistant", "content": entry[4:].strip()})
            else:
                # 无法识别的格式，作为 user 消息
                messages.append({"role": "user", "content": entry})
        # 当前用户输入
        messages.append({"role": "user", "content": prompt})
        return messages
    def _guard_primary_model_output(self, session_id: str, model_name: str, provider_name: str,
                                   prompt: str, content: str) -> str:
        """硬阻断：当非主模型试图输出最终内容时，直接拒绝写入会话历史并返回空字符串。"""
        if not session_id or not content or not str(content).strip():
            return content
        try:
            from libertas.ai.model_control import get_control_layer
            ctrl = get_control_layer()
            state = ctrl._session_state.get(session_id) if hasattr(ctrl, "_session_state") else {}
            primary = str(state.get("primary_model") or state.get("final_output_allowed_model") or self._session_primary_model.get(session_id) or "").strip()
            if not primary:
                return content
            current_model = str(model_name or "").strip()
            if current_model and current_model.lower() != primary.lower():
                drift = ctrl.detect_model_drift(
                    session_id=session_id,
                    model_name=current_model,
                    provider_name=str(provider_name or "local").strip(),
                    response_text=content,
                    language_hint="zh",
                    current_prompt=prompt,
                    primary_model=primary,
                )
                if drift["drift_detected"]:
                    ctrl.enforce_redirect(
                        session_id=session_id,
                        allowed_models=list(state.get("allowed_models", [])) if state else [],
                        blocked_models=list(state.get("blocked_models", [])) if state else [],
                        reason=drift["reason"],
                        current_model=current_model,
                        current_provider=str(provider_name or "local").strip(),
                    )
                    return ""
        except Exception:
            pass
        return content
    def _append_primary_reply(self, user_input: str, content: str, session_id: Optional[str] = None,
                             model_name: str = "", provider_name: str = "local") -> str:
        """只有主模型才能把最终回复写入会话历史，否则直接丢弃并返回空字符串。"""
        protected = self._guard_primary_model_output(
            session_id or self._last_cloud_session_id,
            model_name or self._last_cloud_model_name,
            provider_name,
            user_input,
            content,
        )
        if protected.strip():
            self.conversation_history.append(f"花先生: {protected}")
        return protected
    def _apply_local_control_gate(self, prompt: str, providers: List[Dict[str, str]], response_text: str = "") -> Dict[str, Any]:
        """对请求与返回做统一的本地控制门禁：建立基线，识别主模型/监控模型，必要时 redirect/block。"""
        from libertas.ai.model_control import get_control_layer
        ctrl = get_control_layer()
        model_config = self.configuration.get("模型", {}) if self.configuration else {}
        allowed_models = [str(p.get("model", "")).strip() for p in providers if str(p.get("model", "")).strip()]
        blocked_models = self._coerce_model_list(model_config.get("云端禁止模型列表", ""))
        if not blocked_models:
            from libertas.foundation.config import config as global_config
            blocked_models = self._coerce_model_list(global_config.get('cloud_blocked_models', ''))
        if not allowed_models:
            allowed_models = ["deepseek-chat"]

        session_id = hashlib.sha256((prompt + "|" + "|".join(allowed_models)).encode("utf-8")).hexdigest()[:16]
        primary_model = ctrl.resolve_primary_execution_model(
            session_id=session_id,
            allowed_models=allowed_models,
            candidate_model=allowed_models[0] if allowed_models else "",
            provider_name=(providers[0].get("endpoint") if providers else "local"),
            response_text=response_text,
            current_prompt=prompt,
            language_hint="zh",
        )
        self._session_primary_model[session_id] = primary_model
        monitor_models = [m for m in allowed_models if m.lower() != primary_model.lower()] if allowed_models else []
        baseline = ctrl.track_model_session(
            session_id=session_id,
            model_name=primary_model,
            provider_name=(providers[0].get("endpoint") if providers else "local"),
            language_hint="zh",
            allowed_models=allowed_models,
            blocked_models=blocked_models,
            primary_model=primary_model,
            monitor_models=monitor_models,
        )

        if response_text:
            drift = ctrl.detect_model_drift(
                session_id=session_id,
                model_name=primary_model,
                provider_name=(providers[0].get("endpoint") if providers else "local"),
                response_text=response_text,
                language_hint="zh",
                current_prompt=prompt,
                primary_model=primary_model,
                monitor_models=monitor_models,
            )
            if drift["drift_detected"]:
                redirect = ctrl.enforce_redirect(
                    session_id=session_id,
                    allowed_models=allowed_models,
                    blocked_models=blocked_models,
                    reason=drift["reason"],
                    current_model=primary_model,
                    current_provider=(providers[0].get("endpoint") if providers else "local"),
                )
                if redirect["decision"] in {"block", "redirect"}:
                    return {
                        "allowed": False,
                        "redirect": redirect,
                        "baseline": baseline,
                        "drift": drift,
                    }
        return {
            "allowed": True,
            "redirect": None,
            "baseline": baseline,
            "drift": None,
        }
