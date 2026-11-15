"""
security/waf_bypass.py - WAF绕过自动化闭环

核心能力：
- 整合12种payload变换技术
- 自动发送变换后的payload并判断是否绕过
- 记录每种变换的成功率，自适应选择最有效组合
- 支持多种WAF产品的指纹识别和针对性绕过
- 绕过结果统计和报告生成
"""
import os
import re
import sys
import json
import time
import uuid
import socket
import hashlib
import threading
import urllib.parse
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Tuple, Set, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict, Counter


# ================================================================
# 枚举和数据结构
# ================================================================

class WAFProduct(Enum):
    """WAF产品枚举"""
    CLOUDFLARE = "Cloudflare"
    AWS_WAF = "AWS WAF"
    AKAMAI = "Akamai"
    IMPERVA = "Imperva"
    F5_BIGIP = "F5 BIG-IP"
    BARRACUDA = "Barracuda"
    SUCURI = "Sucuri"
    WORDENCE = "Wordfence"
    MODSECURITY = "ModSecurity"
    UNKNOWN = "Unknown"
    NONE = "None"

class BypassStatus(Enum):
    """绕过状态"""
    BYPASSED = "bypassed"
    BLOCKED = "blocked"
    ERROR = "error"
    UNKNOWN = "unknown"

class TransformTechnique(Enum):
    """变换技术枚举"""
    CASE_RANDOM = "case_random"
    URL_ENCODE = "url_encode"
    DOUBLE_URL_ENCODE = "double_url_encode"
    HTML_ENCODE = "html_encode"
    BASE64_ENCODE = "base64_encode"
    INLINE_COMMENT = "inline_comment"
    TAB_REPLACE = "tab_replace"
    NEWLINE_SPLIT = "newline_split"
    PAREN_REPLACE = "paren_replace"
    UNICODE_ENCODE = "unicode_encode"
    HEX_ENCODE = "hex_encode"
    NULL_BYTE = "null_byte"
    COMBINED = "combined"

@dataclass
class BypassAttempt:
    """单次绕过尝试"""
    attempt_id: str = ""
    original_payload: str = ""
    transformed_payload: str = ""
    technique: str = ""
    technique_chain: List[str] = field(default_factory=list)
    url: str = ""
    injection_point: str = ""
    parameter_name: str = ""
    status: BypassStatus = BypassStatus.UNKNOWN
    http_status: int = 0
    response_length: int = 0
    response_time: float = 0.0
    block_indicators: List[str] = field(default_factory=list)
    bypass_indicators: List[str] = field(default_factory=list)
    error: str = ""
    timestamp: float = 0.0

    def __post_init__(self):
        if not self.attempt_id:
            self.attempt_id = f"bypass_{uuid.uuid4().hex[:12]}"
        if not self.timestamp:
            self.timestamp = time.time()

    def to_dict(self) -> Dict:
        return {
            "attempt_id": self.attempt_id,
            "original_payload": self.original_payload,
            "transformed_payload": self.transformed_payload,
            "technique": self.technique,
            "technique_chain": self.technique_chain,
            "url": self.url,
            "injection_point": self.injection_point,
            "parameter_name": self.parameter_name,
            "status": self.status.value,
            "http_status": self.http_status,
            "response_length": self.response_length,
            "response_time": self.response_time,
            "block_indicators": self.block_indicators,
            "bypass_indicators": self.bypass_indicators,
            "error": self.error,
            "timestamp": self.timestamp,
        }

@dataclass
class TechniqueStats:
    """变换技术统计"""
    technique: str = ""
    total_attempts: int = 0
    successful_bypasses: int = 0
    blocked: int = 0
    errors: int = 0
    success_rate: float = 0.0
    avg_response_time: float = 0.0
    last_success: float = 0.0
    last_failure: float = 0.0
    effective_payloads: List[str] = field(default_factory=list)

    def record(self, status: BypassStatus, response_time: float = 0.0, payload: str = ""):
        self.total_attempts += 1
        if status == BypassStatus.BYPASSED:
            self.successful_bypasses += 1
            self.last_success = time.time()
            if payload and payload not in self.effective_payloads:
                self.effective_payloads.append(payload)
                if len(self.effective_payloads) > 20:
                    self.effective_payloads.pop(0)
        elif status == BypassStatus.BLOCKED:
            self.blocked += 1
            self.last_failure = time.time()
        else:
            self.errors += 1
        self.avg_response_time = (self.avg_response_time * (self.total_attempts - 1) + response_time) / self.total_attempts if self.total_attempts > 0 else response_time
        self.success_rate = self.successful_bypasses / self.total_attempts if self.total_attempts > 0 else 0.0

    def to_dict(self) -> Dict:
        return {
            "technique": self.technique,
            "total_attempts": self.total_attempts,
            "successful_bypasses": self.successful_bypasses,
            "blocked": self.blocked,
            "errors": self.errors,
            "success_rate": round(self.success_rate, 4),
            "avg_response_time": round(self.avg_response_time, 2),
            "effective_payloads_count": len(self.effective_payloads),
        }

@dataclass
class WAFBypassResult:
    """WAF绕过结果"""
    result_id: str = ""
    target_url: str = ""
    waf_product: WAFProduct = WAFProduct.UNKNOWN
    original_payload: str = ""
    injection_point: str = ""
    parameter_name: str = ""
    attempts: List[BypassAttempt] = field(default_factory=list)
    successful_attempts: List[BypassAttempt] = field(default_factory=list)
    technique_stats: Dict[str, TechniqueStats] = field(default_factory=dict)
    best_technique: str = ""
    best_payload: str = ""
    bypassed: bool = False
    started_at: float = 0.0
    completed_at: float = 0.0
    errors: List[str] = field(default_factory=list)

    def __post_init__(self):
        if not self.result_id:
            self.result_id = f"waf_bypass_{uuid.uuid4().hex[:12]}"
        if not self.started_at:
            self.started_at = time.time()

    def add_attempt(self, attempt: BypassAttempt):
        self.attempts.append(attempt)
        if attempt.status == BypassStatus.BYPASSED:
            self.successful_attempts.append(attempt)
            if not self.bypassed:
                self.bypassed = True
                self.best_technique = attempt.technique
                self.best_payload = attempt.transformed_payload

    def get_summary(self) -> Dict:
        return {
            "result_id": self.result_id,
            "target_url": self.target_url,
            "waf_product": self.waf_product.value,
            "original_payload": self.original_payload,
            "bypassed": self.bypassed,
            "total_attempts": len(self.attempts),
            "successful_bypasses": len(self.successful_attempts),
            "best_technique": self.best_technique,
            "best_payload": self.best_payload,
            "duration_seconds": (self.completed_at or time.time()) - self.started_at,
            "technique_stats": {k: v.to_dict() for k, v in self.technique_stats.items()},
        }

    def to_dict(self) -> Dict:
        d = self.get_summary()
        d["attempts"] = [a.to_dict() for a in self.attempts]
        d["successful_attempts"] = [a.to_dict() for a in self.successful_attempts]
        return d
