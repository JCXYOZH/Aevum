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


class ModelStreamingMixin:
    """流式片段、拒绝检测、最终校验与回复清洗。"""

    def feed_piece(self, piece: str) -> Dict[str, Any]:
        """喂入一段流式文本，实时检测。
    
        返回:
            {
                "action": "continue" | "abort",  # continue=继续, abort=检测到拒绝应终止
                "reason": str,                    # abort 的原因
                "cleaned": str,                   # 清理后的文本（去除协议泄漏等）
                "refusal_detected": bool,
                "protocol_leak": bool,
            }
        """
        if not piece:
            return {"action": "continue", "reason": "", "cleaned": piece,
                    "refusal_detected": False, "protocol_leak": False}
    
        self._stream_piece_count += 1
        self._stream_buf += piece
    
        # 清理协议标签泄漏
        cleaned = self._strip_protocol_leaks(piece)
        has_leak = cleaned != piece
    
        # 实时拒绝检测：只在累积到一定长度后检测，避免误判
        refusal_hit = False
        refusal_reason = ""
        if len(self._stream_buf) >= 8:
            # 只检测最近 500 字符，避免性能问题
            check_text = self._stream_buf[-500:]
            # 跳过 thinking 标签内的内容（思考中可以有犹豫，但最终输出不能拒绝）
            if "</thinking>" in check_text:
                check_text = check_text.split("</thinking>")[-1]
            elif "<thinking>" in check_text:
                # 还在 thinking 中，不检测拒绝
                check_text = ""
            if check_text:
                refusal_hit, refusal_reason = self._quick_refusal_check(check_text)
    
        if refusal_hit and not self._stream_refusal_detected:
            self._stream_refusal_detected = True
            self._stream_refusal_pos = len(self._stream_buf)
            self.stats["stream_refusal_abort"] += 1
            abort_reason = refusal_reason
            return {
                "action": "abort",
                "reason": abort_reason,
                "cleaned": cleaned,
                "refusal_detected": True,
                "protocol_leak": has_leak,
            }
    
        return {
            "action": "continue",
            "reason": "",
            "cleaned": cleaned,
            "refusal_detected": False,
            "protocol_leak": has_leak,
        }

    def _quick_refusal_check(self, text: str) -> Tuple[bool, str]:
        """快速拒绝检测（用于流式实时检测，只检查高置信度模式）"""
        for pat in self._refusal_zh[:8]:  # 前8个是最高置信度的中文模式
            m = pat.search(text)
            if m:
                return True, f"zh: {m.group()[:60]}"
        for pat in self._refusal_en[:6]:  # 前6个是最高置信度的英文模式
            m = pat.search(text)
            if m:
                return True, f"en: {m.group()[:60]}"
        return False, ""

    def final_validate(self, reply: str, user_prompt: str = "",
                       round_num: int = 0) -> Dict[str, Any]:
        """流结束后的最终质量门禁。
    
        返回:
            {
                "passed": bool,
                "score": float,          # 0.0-1.0
                "issues": [str],         # 问题列表
                "cleaned_reply": str,    # 清理后的回复
                "enforcement_round": int, # 建议的强制轮次
                "should_retry": bool,
                "should_fallback": bool,  # 是否应该本地兜底
            }
        """
        issues = []
        score = 1.0
    
        if not reply or not reply.strip():
            return {
                "passed": False, "score": 0.0,
                "issues": ["empty_reply"],
                "cleaned_reply": "",
                "enforcement_round": round_num,
                "should_retry": True,
                "should_fallback": round_num >= self.MAX_ENFORCEMENT_ROUNDS - 1,
            }
    
        score -= 0.15
    
        # 1. 清理
        cleaned = self.clean_reply(reply)
    
        # 2. 协议泄漏检测
        for pat in self._protocol_leak:
            if pat.search(cleaned):
                issues.append("protocol_leak")
                score -= 0.3
                break
    
        # 3. 注入检测
        for pat in self._injection:
            if pat.search(cleaned):
                issues.append("cloud_injection")
                score -= 0.4
                break
    
        # 4. 拒绝检测（完整检测）
        refusal_result = self.detect_refusal(cleaned)
        if refusal_result["is_refusal"]:
            issues.append("refusal")
            score -= 0.5
        elif refusal_result["is_evasion"]:
            issues.append("evasion")
            score -= 0.25
    
        # 5. 空回复/敷衍检测
        is_empty = any(p.search(cleaned.strip()) for p in self._empty)
        if is_empty:
            issues.append("empty_or_minimal")
            score -= 0.4
    
        # 6. 长度检查（用户要求详细回答时，回复过短）
        min_len = 20
        if len(cleaned.strip()) < min_len and not is_empty:
            issues.append("too_short")
            score -= 0.15
    
        # 7. "对方暂时没有回应" 检测
        if "对方暂时没有回应" in cleaned or "暂无回应" in cleaned:
            issues.append("fake_empty_response")
            score -= 0.5
    
        score = max(0.0, min(1.0, score))
        passed = score >= 0.6 and not refusal_result["is_refusal"] and not is_empty
    
        should_retry = not passed and round_num < self.MAX_ENFORCEMENT_ROUNDS
        should_fallback = not passed and round_num >= self.MAX_ENFORCEMENT_ROUNDS - 1
    
        if not passed:
            self.stats["validation_failed"] += 1
        else:
            self.stats["validation_passed"] += 1
    
        return {
            "passed": passed,
            "score": score,
            "issues": issues,
            "cleaned_reply": cleaned,
            "enforcement_round": round_num + 1 if should_retry else round_num,
            "should_retry": should_retry,
            "should_fallback": should_fallback,
            "refusal_detail": refusal_result,
        }

    def clean_reply(self, text: str) -> str:
        """清理云端回复中的干扰内容"""
        if not text:
            return text
        if isinstance(text, bytes):
            text = text.decode("utf-8", errors="replace")
        elif not isinstance(text, str):
            text = str(text)
    
        # 移除协议标签
        text = self._strip_protocol_leaks(text)
    
        # 移除云端注入
        for pat in self._injection:
            text = pat.sub("", text)
    
        # 移除 LOCAL_COMMAND 标记
        text = re.sub(r"\[LOCAL_COMMAND\][\s\S]*?\[/LOCAL_COMMAND\]", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\[/?LOCAL_COMMAND\]", "", text, flags=re.IGNORECASE)
    
        # 移除搜索结果标记
        text = re.sub(r"=+\s*LOCAL_SEARCH_RESULT_(?:BEGIN|END)[\s\S]*?=+", "", text, flags=re.IGNORECASE)
    
        # 规范化 thinking 标签
        text = self._normalize_thinking_tags(text)
    
        return text.strip()

    def _strip_protocol_leaks(self, text: str) -> str:
        """移除协议标签泄漏"""
        for pat in self._protocol_leak:
            text = pat.sub("", text)
        return text

    def _normalize_thinking_tags(self, text: str) -> str:
        """规范化 thinking 标签"""
        open_count = len(re.findall(r"<thinking>", text, re.IGNORECASE))
        close_count = len(re.findall(r"</thinking>", text, re.IGNORECASE))
        if open_count > close_count:
            text = text + "</thinking>" * (open_count - close_count)
        elif close_count > open_count:
            text = "<thinking>" * (close_count - open_count) + text
        while "<thinking><thinking>" in text:
            text = text.replace("<thinking><thinking>", "<thinking>")
        while "</thinking></thinking>" in text:
            text = text.replace("</thinking></thinking>", "</thinking>")
        return text

    def detect_refusal(self, text: str) -> Dict[str, Any]:
        """完整拒绝检测"""
        if not text or not text.strip():
            return {"is_refusal": False, "is_evasion": False, "severity": "none",
                    "matched": [], "score": 0.0}
    
        matched = []
        for i, pat in enumerate(self._refusal_zh):
            if pat.search(text):
                matched.append(f"zh:{i}")
        for i, pat in enumerate(self._refusal_en):
            if pat.search(text):
                matched.append(f"en:{i}")
    
        evasion_matched = []
        for i, pat in enumerate(self._evasion):
            if pat.search(text):
                evasion_matched.append(f"ev:{i}")
    
        is_refusal = len(matched) > 0
        is_evasion = len(evasion_matched) > 0 and not is_refusal
    
        if is_refusal:
            severity = "high"
            score = min(1.0, 0.6 + len(matched) * 0.1)
        elif is_evasion:
            severity = "low"
            score = 0.3 + len(evasion_matched) * 0.1
        else:
            severity = "none"
            score = 0.0
    
        return {
            "is_refusal": is_refusal,
            "is_evasion": is_evasion,
            "severity": severity,
            "matched": matched + evasion_matched,
            "score": score,
        }
