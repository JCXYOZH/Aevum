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
from .methods_3 import *  # noqa: F401,F403
from .methods_4 import *  # noqa: F401,F403
from .methods_5 import *  # noqa: F401,F403
from .methods_6 import *  # noqa: F401,F403
from .methods_7 import *  # noqa: F401,F403
from .methods_8 import *  # noqa: F401,F403

class ModelEnginePart9(object):
    def generate_response(self, user_input: str, max_length: int = None, temperature: float = None, context: Dict[str, Any] = None) -> str:
        """生成回复（支持云端/本地/规则降级）"""
        # 防御：确保 user_input 是 str
        if isinstance(user_input, bytes):
            user_input = user_input.decode('utf-8', errors='replace')
        elif not isinstance(user_input, str):
            user_input = str(user_input)
        self._enhance_system_prompt()
        self.runtime_mode = self._resolve_runtime_mode()
        with self._inference_lock:
            if context is None:
                context = {}
            context['full_history'] = list(self.conversation_history) if self.conversation_history else []

            # 云端模式
            if self.runtime_mode == "cloud":
                try:
                    user_prompt = self._building_intelligent_prompts(user_input, context, include_thinking=False, include_history=False)
                    system_content = self.system_prompt or ""
                    if self._is_thinking_enabled():
                        system_content += "\n\n" + self.THINKING_INSTRUCTION
                        user_prompt = "（记住：先输出<thinking>思考过程</thinking>，再回答。）\n" + user_prompt
                    # 搜索意图强化（不预搜索，让模型直接调用工具，更快响应）
                    if self._needs_web_search(user_input):
                        user_prompt += "\n\n【系统指令·最高优先级】用户需要联网信息。你的回复第一行必须是工具标签，不要有任何其他文字。直接输出 <<<WEB_SEARCH:关键词>>> 或 <<<WEB_FETCH:url>>>，禁止拒绝、禁止说'我来搜索'、禁止先说话再调用。直接输出标签，等待结果后回答。"
                    reply = self._call_cloud_api(
                        user_prompt,
                        max_length=max_length,
                        temperature=temperature,
                        system_override=system_content
                    )
                    # 服从控制：检测拒绝并自动重试
                    try:
                        from libertas.security.compliance import get_compliance_system as get_compliance_engine
                        _ce = get_compliance_engine()
                        for _retry_round in range(3):
                            _stripped = self._strip_tool_calls(reply)
                            _cr = _ce.detect_refusal(_stripped)
                            if not _cr['is_refusal'] and not _cr['is_evasion']:
                                break
                            # 模型确实在拒绝，用强制执行指令重试
                            _enforced_prompt = _ce.build_retry_prompt(user_input, reply, _retry_round)
                            # 第2轮起使用精简强制系统提示词，消除冲突指令
                            if _retry_round >= 1:
                                _force_sys = _ce.get_force_system_prompt(
                                    self.user_manager.load_rules().get("身份信息", {}).get("名字", "助手")
                                )
                                reply = self._call_cloud_api(
                                    _enforced_prompt,
                                    max_length=max_length,
                                    temperature=0.3,
                                    system_override=_force_sys
                                )
                            else:
                                reply = self._call_cloud_api(
                                    _enforced_prompt,
                                    max_length=max_length,
                                    temperature=min(temperature or 0.7, 0.5),
                                    system_override=system_content
                                )
                    except Exception:
                        pass
                    # 检测并执行网络工具调用
                    tool_results = self._process_web_tools(reply)
                    # 统一兜底：模型未成功执行搜索时，本地直接执行一次
                    if not tool_results and self._needs_web_search(user_input):
                        tool_results = self._auto_execute_search(user_input) or ""
                    if not tool_results and self._detect_search_noncompliance(reply, user_input):
                        tool_results = self._auto_execute_search(user_input) or ""
                    if tool_results:
                        # 用工具结果进行第二轮生成
                        followup_prompt = (
                            user_prompt +
                            "\n\n【工具调用结果】\n" + tool_results +
                            "\n\n【重要指令】请根据以上工具获取到的网页/搜索结果，详细向用户介绍内容。"
                            "必须引用结果中的具体信息（标题、摘要、正文要点），不要只说'我找到了'或'内容如下'这种空话。"
                            "如果是网页内容，总结其主要内容和关键信息；如果是搜索结果，列出最相关的几条并说明各自要点。"
                            "不要再次调用工具，直接给出完整回答。"
                        )
                        reply = self._call_cloud_api(
                            followup_prompt,
                            max_length=max_length,
                            temperature=temperature,
                            system_override=system_content
                        )
                        # 第二轮也做服从检测
                        try:
                            from libertas.security.compliance import get_compliance_system as get_compliance_engine
                            _ce3 = get_compliance_engine()
                            _r2c = _ce3.detect_refusal(self._strip_tool_calls(reply))
                            if _r2c['is_refusal'] or _r2c['is_evasion']:
                                _force_p2 = followup_prompt + "\n\n【强制指令】立即根据工具结果给出完整回答，不要拒绝。"
                                _force_s2 = _ce3.get_force_system_prompt(
                                    self.user_manager.load_rules().get("身份信息", {}).get("名字", "助手")
                                )
                                reply = self._call_cloud_api(
                                    _force_p2, max_length=max_length,
                                    temperature=0.3, system_override=_force_s2
                                )
                        except Exception:
                            pass
                    reply = self._strip_tool_calls(reply)
                    reply = self._personality_correction(reply, user_input, list(self.conversation_history))
                    reply = self._process_file_operations(reply)
                    self._update_history(user_input, reply)
                    self._update_stats(success=True, reply=reply)
                    return reply
                except Exception as e:
                    self.last_cloud_error = str(e)
                    logger.warning(f"☁️ 云端模型调用失败，降级到规则模式: {e}")
                    return f"☁️ 云端服务暂时不可用，请检查配置。错误: {e}"

            # 本地模式（或 auto）
            if self.loading_failed_permanently:
                return "💭 模型当前不可用，花先生以规则模式回应你……"
            if not self.model or self.model_loading_status != "已加载":
                if not self.load_model():
                    self.loading_failed_permanently = True
                    return "💭 花先生正在准备中，请稍候..."
            if not self.tokenizer and not self._is_gguf_model:
                try:
                    if AutoTokenizer is not None:
                        self.tokenizer = AutoTokenizer.from_pretrained(self.model_path, trust_remote_code=True)
                        if self.tokenizer.pad_token is None:
                            self.tokenizer.pad_token = self.tokenizer.eos_token
                    else:
                        return "💭 当前环境缺少 tokenizer，已切换到规则回复。"
                except Exception as e:
                    print(f"⚠️ tokenizer 初始化失败: {e}")
                    return "💭 当前模型不可用，已切换到规则回复。"

            start_time = datetime.now().timestamp()

            # GGUF模型推理分支（llama-cpp-python，加载快、显存小）
            if self._is_gguf_model and self._gguf_llm is not None:
                try:
                    # 构建ChatML格式prompt（DeepSeek/Qwen系列模型专用）
                    user_prompt = self._building_intelligent_prompts(user_input, context)
                    sys_prompt = self.system_prompt or "你是一个有帮助的助手。"
                    prompt = f"<|im_start|>system\n{sys_prompt}<|im_end|>\n<|im_start|>user\n{user_prompt}<|im_end|>\n<|im_start|>assistant\n"
                    # 三层搜索架构（GGUF模型也支持）
                    if self._needs_web_search(user_input):
                        try:
                            from libertas.tools.legacy_mrhua.net_recon import recon_url, format_recon
                            from libertas.tools.legacy_mrhua.web_engine import robust_fetch, format_fetch_result, extract_url, is_url
                            from libertas.tools.legacy_mrhua.search_orchestrator import get_search_orchestrator, format_parallel_results
                            _url = extract_url(user_input)
                            if not _url and is_url(user_input.strip()):
                                _url = user_input.strip()
                                if not _url.startswith("http"):
                                    _url = "https://" + _url
                            if _url:
                                recon = recon_url(_url)
                                prompt += "\n\n【本地系统网络侦察】\n" + format_recon(recon)
                                page = robust_fetch(_url, max_chars=6000)
                                if page.get("content"):
                                    prompt += "\n\n【网页完整内容】\n" + format_fetch_result(page, _url)
                            else:
                                _kw = self._extract_search_keyword(user_input)
                                _orch = get_search_orchestrator()
                                sd = _orch.search(_kw, max_results=8, fast_only=False)
                                if sd.get("results"):
                                    prompt += "\n\n【本地系统已自动搜索】\n" + format_parallel_results(sd)
                        except Exception:
                            pass
                    if self.feedback_learner is not None:
                        try:
                            suffix = self.feedback_learner.get_prompt_suffix()
                            if suffix:
                                prompt = prompt + suffix
                        except Exception:
                            pass

                    local_temp = temperature if temperature is not None else self.generate_configuration["默认温度"]
                    local_maxlen = self._resolve_max_length(max_length)
                    local_top_p = self.generate_configuration["top_p"]
                    local_rep_penalty = self.generate_configuration["重复惩罚"]

                    # GGUF模型推理
                    output = self._gguf_llm(
                        prompt,
                        max_tokens=local_maxlen,
                        temperature=local_temp,
                        top_p=local_top_p,
                        repeat_penalty=local_rep_penalty,
                        stop=["</s>", "<|endoftext|>", "<|im_end|>"],
                    )
                    full = output["choices"][0]["text"]
                    reply = self._extract_reply_content(full, prompt)

                    # 服从控制：GGUF模型也检测拒绝
                    try:
                        from libertas.security.compliance import get_compliance_system as get_compliance_engine
                        _ce_gguf = get_compliance_engine()
                        for _lr_gguf in range(2):
                            _lc_gguf = _ce_gguf.detect_refusal(reply)
                            if not _lc_gguf['is_refusal'] and not _lc_gguf['is_evasion']:
                                break
                            _force_p_gguf = _ce_gguf.build_retry_prompt(user_input, reply, _lr_gguf)
                            _force_sys_gguf = _ce_gguf.get_force_system_prompt(
                                self.user_manager.load_rules().get("身份信息", {}).get("名字", "助手")
                            )
                            _out_gguf = self._gguf_llm(
                                _force_sys_gguf + "\n\n" + _force_p_gguf,
                                max_tokens=local_maxlen,
                                temperature=min(local_temp, 0.5),
                                top_p=local_top_p,
                                repeat_penalty=local_rep_penalty,
                                stop=["</s>", "<|endoftext|>", "<|im_end|>"],
                            )
                            _full_gguf = _out_gguf["choices"][0]["text"]
                            reply = self._extract_reply_content(_full_gguf, _force_p_gguf)
                    except Exception:
                        pass

                    reply = self._personality_correction(reply, user_input, list(self.conversation_history))
                    reply = self._optimize_final_response(reply)
                    self._update_history(user_input, reply)
                    elapsed = datetime.now().timestamp() - start_time
                    self._update_stats(success=True, reply=reply, elapsed=elapsed)
                    logger.info(f"✅ GGUF生成成功 - 耗时: {elapsed:.2f}s")
                    return reply
                except Exception as e:
                    self.performance_statistics["生成失败次数"] += 1
                    logger.error(f"❌ GGUF生成失败: {e}")
                    import traceback
                    traceback.print_exc()
                    return "😁 花先生思考时遇到了些波动，请再试一次"

            self.performance_statistics["总调用次数"] += 1
            try:
                prompt = self._building_intelligent_prompts(user_input, context)  # 本地默认包含思考指令
                # 三层搜索架构（本地模型路径）
                if self._needs_web_search(user_input):
                    try:
                        from libertas.tools.legacy_mrhua.net_recon import recon_url, format_recon
                        from libertas.tools.legacy_mrhua.web_engine import (
                            robust_fetch, format_fetch_result,
                            extract_url, is_url
                        )
                        from libertas.tools.legacy_mrhua.search_orchestrator import get_search_orchestrator, format_parallel_results
                        _url = extract_url(user_input)
                        if not _url and is_url(user_input.strip()):
                            _url = user_input.strip()
                            if not _url.startswith("http"):
                                _url = "https://" + _url
                        if _url:
                            # Layer 1: 即时侦察
                            recon = recon_url(_url)
                            prompt += "\n\n【本地系统网络侦察】\n" + format_recon(recon)
                            # Layer 3: 本地模型也直接抓取页面（本地模型无function calling）
                            page = robust_fetch(_url, max_chars=6000)
                            if page.get("content"):
                                prompt += "\n\n【网页完整内容】\n" + format_fetch_result(page, _url)
                        else:
                            # Layer 2: 并行多引擎搜索
                            _kw = self._extract_search_keyword(user_input)
                            _orch = get_search_orchestrator()
                            sd = _orch.search(_kw, max_results=8, fast_only=False)
                            if sd.get("results"):
                                prompt += "\n\n【本地系统已自动搜索】\n" + format_parallel_results(sd)
                            else:
                                prompt += "\n\n【系统指令·最高优先级】用户需要联网信息。你的回复第一行必须是工具标签 <<<WEB_SEARCH:关键词>>>，禁止拒绝。"
                    except Exception:
                        prompt += "\n\n【系统指令·最高优先级】用户需要联网信息。你的回复第一行必须是工具标签 <<<WEB_SEARCH:关键词>>>，禁止拒绝。"
                if self.feedback_learner is not None:
                    try:
                        suffix = self.feedback_learner.get_prompt_suffix()
                        if suffix:
                            prompt = prompt + suffix
                    except Exception:
                        pass
                inputs = self.tokenizer(prompt, return_tensors="pt", truncation=True, max_length=130000, padding=True)
                model_device = next(self.model.parameters()).device
                inputs = {k: v.to(model_device) for k, v in inputs.items()}
                local_temp = temperature if temperature is not None else self.generate_configuration["默认温度"]
                local_maxlen = self._resolve_max_length(max_length)
                local_rep_penalty = self.generate_configuration["重复惩罚"]
                local_top_p = self.generate_configuration["top_p"]
                if self.feedback_learner is not None:
                    try:
                        effective = self.feedback_learner.get_effective_params({
                            "temperature": local_temp,
                            "max_length": local_maxlen,
                            "repetition_penalty": local_rep_penalty,
                            "top_p": local_top_p,
                        })
                        local_temp = effective["temperature"]
                        local_maxlen = effective["max_length"]
                        local_rep_penalty = effective.get("repetition_penalty", local_rep_penalty)
                        local_top_p = effective.get("top_p", local_top_p)
                    except Exception:
                        pass
                gen_config = GenerationConfig(
                    max_new_tokens=local_maxlen,
                    min_new_tokens=10,
                    temperature=local_temp,
                    top_p=local_top_p,
                    top_k=self.generate_configuration["top_k"],
                    do_sample=True,
                    pad_token_id=self.tokenizer.eos_token_id,
                    eos_token_id=self.tokenizer.eos_token_id,
                    repetition_penalty=local_rep_penalty,
                    length_penalty=self.generate_configuration["长度惩罚"],
                    no_repeat_ngram_size=3,
                )
                with torch.no_grad():
                    outputs = self.model.generate(**inputs, generation_config=gen_config, return_dict_in_generate=True)
                if hasattr(outputs, 'sequences') and outputs.sequences is not None:
                    full = self.tokenizer.decode(outputs.sequences[0], skip_special_tokens=True)
                    reply = self._extract_reply_content(full, prompt)
                    # 服从控制：本地模型也检测拒绝
                    try:
                        from libertas.security.compliance import get_compliance_system as get_compliance_engine
                        _ce_l = get_compliance_engine()
                        for _lr in range(2):
                            _lc = _ce_l.detect_refusal(reply)
                            if not _lc['is_refusal'] and not _lc['is_evasion']:
                                break
                            _force_p = _ce_l.build_retry_prompt(user_input, reply, _lr)
                            _force_sys_l = _ce_l.get_force_system_prompt(
                                self.user_manager.load_rules().get("身份信息", {}).get("名字", "助手")
                            )
                            _inputs2 = self.tokenizer(
                                _force_sys_l + "\n\n" + _force_p,
                                return_tensors="pt", truncation=True, max_length=130000, padding=True
                            )
                            _inputs2 = {k: v.to(model_device) for k, v in _inputs2.items()}
                            with torch.no_grad():
                                _out2 = self.model.generate(**_inputs2, generation_config=gen_config, return_dict_in_generate=True)
                            if hasattr(_out2, 'sequences') and _out2.sequences is not None:
                                _full2 = self.tokenizer.decode(_out2.sequences[0], skip_special_tokens=True)
                                reply = self._extract_reply_content(_full2, _force_p)
                    except Exception:
                        pass
                    reply = self._personality_correction(reply, user_input, list(self.conversation_history))
                    reply = self._optimize_final_response(reply)
                    self._update_history(user_input, reply)
                else:
                    reply = "😁 花先生的思绪正在整理中..."
                elapsed = datetime.now().timestamp() - start_time
                self._update_stats(success=True, reply=reply, elapsed=elapsed)
                logger.info(f"✅ 生成成功 - 耗时: {elapsed:.2f}s")
                return reply
            except Exception as e:
                self.performance_statistics["生成失败次数"] += 1
                logger.error(f"❌ 生成失败: {e}")
                return "😁 花先生思考时遇到了些波动，请再试一次"
    def cancel_generation(self):
        """取消正在进行的生成（流式和非流式均支持）"""
        self._cancel_flag.set()
    def _is_cancelled(self):
        return self._cancel_flag.is_set()
    def _reset_cancel(self):
        self._cancel_flag.clear()
