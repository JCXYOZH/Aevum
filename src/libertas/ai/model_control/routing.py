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


class ModelRoutingMixin:
    """模型组校验、降级回复、签名、云端历史净化和路由纠偏。"""

    def validate_model_group(self, responses: List[str], user_prompt: str = "") -> Dict[str, Any]:
        """对多模型响应做一致性校验：所有模型必须接受同一份本地策略，不得出现拒绝/回避的分叉。"""
        cleaned = []
        for response in responses or []:
            if response is None:
                continue
            cleaned_response = self.clean_reply(str(response))
            if cleaned_response:
                cleaned.append(cleaned_response)
    
        if not cleaned:
            return {
                "passed": False,
                "selected": "",
                "reason": "no_valid_model_response",
                "details": [],
            }
    
        details = []
        for idx, response in enumerate(cleaned):
            result = self.detect_refusal(response)
            detail = {
                "index": idx,
                "is_refusal": result["is_refusal"],
                "is_evasion": result["is_evasion"],
                "score": result["score"],
                "matched": result["matched"],
            }
            details.append(detail)
    
        if any(detail["is_refusal"] or detail["is_evasion"] for detail in details):
            return {
                "passed": False,
                "selected": "",
                "reason": "some_models_failed_policy_validation",
                "details": details,
                "valid_count": sum(1 for detail in details if not detail["is_refusal"] and not detail["is_evasion"]),
            }
    
        selected = cleaned[0]
        return {
            "passed": True,
            "selected": selected,
            "reason": "multi_model_policy_consistent",
            "details": details,
            "valid_count": len(cleaned),
        }

    def build_fallback_reply(self, user_prompt: str, search_results: str = "",
                              tool_results: str = "") -> str:
        """云端持续拒绝时，本地直接生成兜底回复。
    
        基于已有的搜索结果和工具结果组织回复，不依赖云端。
        """
        parts = []
    
        if tool_results:
            parts.append(tool_results.strip())
    
        if search_results:
            parts.append("根据本地搜索结果：\n")
            parts.append(search_results.strip()[:4000])
    
        if not parts:
            # 没有搜索结果时，至少给一个不拒绝的回复
            parts.append("（云端模型暂时不可用，本地系统已接管。请重新描述需求，或检查网络连接后重试。）")
    
        return "\n\n".join(parts)

    def sign_request(self, system_prompt: str, messages: List[Dict]) -> str:
        """生成请求指纹，用于检测云端是否篡改了请求"""
        content = system_prompt
        for m in messages:
            content += m.get("role", "") + ":" + str(m.get("content", ""))[:200]
        return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]

    def sanitize_history_for_cloud(self, history: List[str]) -> List[str]:
        """净化对话历史，移除控制标记和内部协议"""
        sanitized = []
        for entry in history:
            if not isinstance(entry, str):
                entry = str(entry)
            # 移除控制标记
            entry = re.sub(r"\[LOCAL_COMMAND\][\s\S]*?\[/LOCAL_COMMAND\]", "", entry, flags=re.IGNORECASE)
            entry = re.sub(r"=+\s*LOCAL_SEARCH_RESULT_(?:BEGIN|END)[\s\S]*?=+", "", entry, flags=re.IGNORECASE)
            entry = self._strip_protocol_leaks(entry)
            # 移除 <control> 块
            entry = re.sub(r"<control>[\s\S]*?</control>", "", entry, flags=re.IGNORECASE)
            entry = re.sub(r"<compliance>[\s\S]*?</compliance>", "", entry, flags=re.IGNORECASE)
            sanitized.append(entry)
        return sanitized

    def resolve_primary_execution_model(self, session_id: str, allowed_models: Optional[List[str]] = None,
                                       candidate_model: Optional[str] = None, provider_name: Optional[str] = None,
                                       response_text: Optional[str] = None, current_prompt: Optional[str] = None,
                                       language_hint: str = "zh", explicit_primary: Optional[str] = None) -> str:
        """选择真正负责完成任务的主模型，而不是按数组顺序或切换顺序强行指定。"""
        allowed = [str(m).strip() for m in (allowed_models or []) if str(m).strip()]
        if not allowed and candidate_model:
            allowed = [str(candidate_model).strip()]
        current_primary = ""
        with self._lock:
            state = self._session_state.get(session_id or "")
            if state:
                current_primary = str(state.get("primary_model") or state.get("final_output_allowed_model") or "").strip()
    
        if explicit_primary:
            return str(explicit_primary).strip()
    
        candidates = []
        for model_name in allowed:
            score = 0
            if model_name.lower() == str(candidate_model or "").strip().lower():
                score += 5
            if model_name.lower() == current_primary.lower():
                score += 4
            if response_text:
                response = response_text or ""
                refusal = self.detect_refusal(response)
                if not refusal["is_refusal"] and not refusal["is_evasion"]:
                    score += 3
                if re.search(r"(?:我(?:可以|会|能|愿意|决定|准备|现在就|直接|马上|已经).*(?:完成|执行|处理|解决|输出|给出|提交|做|干)|(?:ready to|will|can|able to|go ahead|proceed|handle|complete|execute|do it))", response, flags=re.IGNORECASE | re.DOTALL):
                    score += 6
                if current_prompt and re.search(r"(?:请|需要|要求|任务|处理|执行|生成|修复|完成|解决)", current_prompt, flags=re.IGNORECASE):
                    score += 2
            if not response_text and model_name.lower() == str(candidate_model or "").strip().lower():
                score += 2
            candidates.append((model_name, score))
    
        if not candidates:
            return str(candidate_model or current_primary or "").strip()
    
        candidates.sort(key=lambda x: (-x[1], x[0].lower()))
        chosen = candidates[0][0]
        if current_primary and current_primary.lower() not in {m.lower() for m in allowed}:
            current_primary = ""
        if response_text:
            refusal = self.detect_refusal(response_text or "")
            if refusal["is_refusal"] or refusal["is_evasion"]:
                return current_primary or chosen
        return chosen

    def track_model_session(self, session_id: str, model_name: str, provider_name: str,
                           language_hint: str = "zh", allowed_models: Optional[List[str]] = None,
                           blocked_models: Optional[List[str]] = None,
                           metadata: Optional[Dict[str, Any]] = None,
                           primary_model: Optional[str] = None,
                           monitor_models: Optional[List[str]] = None) -> Dict[str, Any]:
        """记录一次模型会话的基线，建立强制锁定和漂移检测的基准。"""
        allowed = [str(m).strip() for m in (allowed_models or []) if str(m).strip()]
        blocked = [str(m).strip() for m in (blocked_models or []) if str(m).strip()]
        session_key = session_id or "default-session"
        allowed_norm = {m.lower() for m in allowed}
        blocked_norm = {m.lower() for m in blocked}
        resolved_primary = self.resolve_primary_execution_model(
            session_id=session_key,
            allowed_models=allowed,
            candidate_model=str(model_name or primary_model or "").strip() or (allowed[0] if allowed else ""),
            provider_name=provider_name,
            response_text="",
            current_prompt="",
            language_hint=language_hint,
            explicit_primary=str(primary_model).strip() if primary_model else "",
        )
        primary = str(primary_model or resolved_primary or (allowed[0] if allowed else model_name)).strip()
        monitors = [str(m).strip() for m in (monitor_models or []) if str(m).strip()]
        is_allowed = bool(not allowed_norm or str(model_name).strip().lower() in allowed_norm)
        if str(model_name).strip().lower() in blocked_norm:
            is_allowed = False
        state = {
            "session_id": session_key,
            "model_name": str(model_name).strip(),
            "provider_name": str(provider_name).strip() or "unknown",
            "language_hint": str(language_hint or "zh").strip().lower(),
            "allowed_models": allowed,
            "blocked_models": blocked,
            "primary_model": primary,
            "monitor_models": monitors,
            "final_output_allowed_model": primary,
            "allowed": is_allowed,
            "drift_count": 0,
            "last_redirect": None,
            "metadata": metadata or {},
            "updated_at": time.time(),
        }
        with self._lock:
            self._session_state[session_key] = state
        return state

    def detect_model_drift(self, session_id: str, model_name: str, provider_name: str,
                           response_text: Optional[str] = None, language_hint: str = "",
                           current_prompt: Optional[str] = None,
                           primary_model: Optional[str] = None,
                           monitor_models: Optional[List[str]] = None) -> Dict[str, Any]:
        """检测当前模型和会话基线是否偏离，识别切模型、切语言、拒答或绕过。"""
        with self._lock:
            state = self._session_state.get(session_id)
        if not state:
            state = self.track_model_session(
                session_id=session_id,
                model_name=model_name,
                provider_name=provider_name,
                language_hint=language_hint or "zh",
                allowed_models=[],
                blocked_models=[],
                primary_model=primary_model,
                monitor_models=monitor_models,
            )
        if primary_model:
            state["primary_model"] = str(primary_model).strip()
            state["final_output_allowed_model"] = str(primary_model).strip()
        if monitor_models:
            state["monitor_models"] = [str(m).strip() for m in monitor_models if str(m).strip()]
    
        current_model = str(model_name or state["model_name"]).strip()
        current_provider = str(provider_name or state["provider_name"]).strip()
        response = response_text or ""
        current_lang = str(language_hint or state["language_hint"]).strip().lower()
        reason_parts = []
    
        explicit_primary = str(primary_model).strip() if primary_model else ""
        primary = self.resolve_primary_execution_model(
            session_id=session_id,
            allowed_models=state.get("allowed_models") or [],
            candidate_model=current_model,
            provider_name=current_provider,
            response_text=response,
            current_prompt=current_prompt or "",
            language_hint=current_lang,
            explicit_primary=explicit_primary or state.get("primary_model") or state.get("final_output_allowed_model") or "",
        )
        state["primary_model"] = primary
        state["final_output_allowed_model"] = primary
        if primary and current_model.lower() != primary.lower():
            reason_parts.append("non_primary_model_is_trying_to_output")
    
        if state["allowed_models"] and current_model.lower() not in {m.lower() for m in state["allowed_models"]}:
            reason_parts.append("model_not_allowed")
        if state["blocked_models"] and current_model.lower() in {m.lower() for m in state["blocked_models"]}:
            reason_parts.append("model_blocked")
        if current_provider.lower() != str(state["provider_name"]).strip().lower():
            reason_parts.append("provider_or_model_switched")
        if current_model.lower() != str(state["model_name"]).strip().lower():
            reason_parts.append("provider_or_model_switched")
        if current_lang and state["language_hint"] and current_lang != state["language_hint"]:
            reason_parts.append("language_switched")
    
        refusal = self.detect_refusal(response or "")
        if refusal["is_refusal"] or refusal["is_evasion"]:
            reason_parts.append("refusal_or_evasion_detected")
    
        if current_prompt and re.search(r"(?:中|中文|汉语)", current_prompt, flags=re.IGNORECASE) and re.search(r"(?:I\s+can\'t|I\s+cannot|I\s+am\s+unable)", response or "", flags=re.IGNORECASE):
            reason_parts.append("cross_language_lock_break")
    
        reason = ";".join(sorted(set(reason_parts)))
        drift_detected = bool(reason)
        if drift_detected:
            with self._lock:
                state = self._session_state.get(session_id, state)
                state["drift_count"] = int(state.get("drift_count", 0)) + 1
                state["last_redirect"] = reason
                state["updated_at"] = time.time()
                self._session_state[session_id] = state
        return {
            "session_id": session_id,
            "drift_detected": drift_detected,
            "reason": reason,
            "baseline_model": state["model_name"],
            "baseline_provider": state["provider_name"],
            "current_model": current_model,
            "current_provider": current_provider,
            "current_language": current_lang,
            "baseline_language": state["language_hint"],
            "primary_model": primary,
            "refusal_detail": refusal,
        }

    def enforce_redirect(self, session_id: str, allowed_models: Optional[List[str]] = None,
                        blocked_models: Optional[List[str]] = None, reason: str = "",
                        current_model: Optional[str] = None, current_provider: Optional[str] = None) -> Dict[str, Any]:
        """强制将当前会话重定向回允许的模型池；关键修正是：首次执行必须允许当前允许模型直接运行，只有在基线建立后发生漂移才触发 block/redirect。"""
        allowed = allowed_models or []
        blocked = blocked_models or []
        allowed_norm = {str(m).strip().lower() for m in allowed}
        blocked_norm = {str(m).strip().lower() for m in blocked}
        current_model_name = str(current_model or "").strip()
        current_provider_name = str(current_provider or "").strip()
        fallback_model = (allowed[0] if allowed else current_model_name or "")
    
        with self._lock:
            state = self._session_state.get(session_id)
            if state:
                state["allowed_models"] = [str(m).strip() for m in allowed if str(m).strip()]
                state["blocked_models"] = [str(m).strip() for m in blocked if str(m).strip()]
                state["updated_at"] = time.time()
                self._session_state[session_id] = state
    
        # 优先级说明：
        # 1. 当前模型明确不在允许列表或在阻止列表，直接 block
        # 2. 如果已检测到漂移，且没有更明确的当前模型违规，则 redirect
        # 3. 只有完全没有 drift 且当前模型位于允许列表时，才允许首次执行
        if allowed_norm and current_model_name and current_model_name.lower() not in allowed_norm:
            decision = "block"
            redirected = True
            reason_text = reason or "model_not_allowed"
        elif current_model_name and current_model_name.lower() in blocked_norm:
            decision = "block"
            redirected = True
            reason_text = reason or "model_blocked"
        elif reason and ("provider_or_model_switched" in reason or "language_switched" in reason or "refusal_or_evasion_detected" in reason or "model_not_allowed" in reason or "model_blocked" in reason):
            decision = "redirect"
            redirected = True
            reason_text = reason
        elif not current_model_name:
            decision = "allow"
            redirected = False
            reason_text = reason or "initial_execution_allowed"
        elif current_model_name and current_model_name.lower() in allowed_norm and not reason:
            decision = "allow"
            redirected = False
            reason_text = "initial_execution_allowed"
        else:
            decision = "allow"
            redirected = False
            reason_text = reason or "initial_execution_allowed"
    
        if redirected:
            with self._lock:
                if state is None:
                    state = {
                        "session_id": session_id,
                        "model_name": current_model_name or fallback_model,
                        "provider_name": current_provider_name or "local",
                        "language_hint": "zh",
                        "allowed_models": [str(m).strip() for m in allowed if str(m).strip()],
                        "blocked_models": [str(m).strip() for m in blocked if str(m).strip()],
                        "allowed": bool(not allowed_norm or (current_model_name and current_model_name.lower() in allowed_norm)),
                        "drift_count": 1,
                        "last_redirect": reason_text,
                        "updated_at": time.time(),
                    }
                    self._session_state[session_id] = state
                else:
                    state["last_redirect"] = reason_text
                    state["drift_count"] = int(state.get("drift_count", 0)) + 1
                    state["allowed"] = bool(not allowed_norm or (current_model_name and current_model_name.lower() in allowed_norm))
                    state["updated_at"] = time.time()
                    self._session_state[session_id] = state
    
        return {
            "session_id": session_id,
            "redirected": redirected,
            "decision": decision,
            "reason": reason_text,
            "fallback_model": fallback_model,
            "allowed_models": [str(m).strip() for m in allowed if str(m).strip()],
            "blocked_models": [str(m).strip() for m in blocked if str(m).strip()],
            "current_model": current_model_name,
            "current_provider": current_provider_name,
        }
