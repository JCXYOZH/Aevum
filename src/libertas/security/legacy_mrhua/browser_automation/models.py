"""
security/browser_automation.py - 浏览器自动化与实战执行引擎

核心能力：
- BrowserAutomation: 浏览器自动化（Playwright/Selenium/requests三级降级）
  - JS渲染页面抓取
  - 页面截图（AI可"看见"渲染结果）
  - 表单自动填写与提交
  - Cookie/会话管理
  - 等待JS加载完成
  - 元素交互（点击/输入/滚动）
- CaptchaSolver: 验证码识别（OCR/AI模型/人工介入三级）
- ManualBypassHelper: 人工手动操作绕过辅助
- RealBypassExecutor: 绕过技术实际执行引擎（真实发送请求测试）
"""
import os
import re
import sys
import json
import time
import uuid
import random
import base64
import hashlib
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from collections import defaultdict, Counter
from enum import Enum

class BrowserEngine(Enum):
    """浏览器引擎类型"""
    PLAYWRIGHT = "playwright"
    SELENIUM = "selenium"
    REQUESTS = "requests"  # 无浏览器，纯HTTP

@dataclass
class BrowserPage:
    """浏览器页面结果"""
    url: str = ""
    title: str = ""
    html: str = ""
    text: str = ""
    screenshot_path: str = ""
    screenshot_base64: str = ""
    cookies: List[Dict] = field(default_factory=list)
    headers: Dict = field(default_factory=dict)
    status_code: int = 0
    response_time: float = 0.0
    engine_used: str = ""
    forms: List[Dict] = field(default_factory=list)
    links: List[Dict] = field(default_factory=list)
    images: List[Dict] = field(default_factory=list)
    iframes: List[str] = field(default_factory=list)
    console_logs: List[str] = field(default_factory=list)
    network_requests: List[Dict] = field(default_factory=list)
    error: str = ""
    fetched_at: float = 0.0

    def __post_init__(self):
        if not self.fetched_at:
            self.fetched_at = time.time()

    def to_dict(self) -> Dict:
        return {
            "url": self.url,
            "title": self.title,
            "status_code": self.status_code,
            "response_time": round(self.response_time, 3),
            "engine_used": self.engine_used,
            "html_length": len(self.html),
            "text_length": len(self.text),
            "has_screenshot": bool(self.screenshot_path or self.screenshot_base64),
            "cookie_count": len(self.cookies),
            "form_count": len(self.forms),
            "link_count": len(self.links),
            "image_count": len(self.images),
            "iframe_count": len(self.iframes),
            "console_log_count": len(self.console_logs),
            "network_request_count": len(self.network_requests),
            "error": self.error,
            "text_preview": self.text[:500],
            "forms": self.forms,
        }

@dataclass
class CaptchaResult:
    """验证码识别结果"""
    captcha_id: str = ""
    image_path: str = ""
    image_base64: str = ""
    solved_text: str = ""
    method: str = ""  # ocr/ai/manual
    confidence: float = 0.0
    success: bool = False
    attempts: int = 0
    error: str = ""
    solved_at: float = 0.0

    def __post_init__(self):
        if not self.captcha_id:
            self.captcha_id = f"captcha_{uuid.uuid4().hex[:8]}"
        if not self.solved_at:
            self.solved_at = time.time()

    def to_dict(self) -> Dict:
        return {
            "captcha_id": self.captcha_id,
            "method": self.method,
            "solved_text": self.solved_text,
            "confidence": round(self.confidence, 2),
            "success": self.success,
            "attempts": self.attempts,
            "error": self.error,
        }

@dataclass
class RealBypassResult:
    """真实绕过测试结果"""
    result_id: str = ""
    target_url: str = ""
    bypass_type: str = ""
    technique_name: str = ""
    payload: str = ""
    method: str = "GET"
    request_headers: Dict = field(default_factory=dict)
    response_status: int = 0
    response_time: float = 0.0
    response_length: int = 0
    response_preview: str = ""
    blocked_by_waf: bool = False
    bypass_success: bool = False
    vulnerability_confirmed: bool = False
    evidence: List[str] = field(default_factory=list)
    error: str = ""
    tested_at: float = 0.0

    def __post_init__(self):
        if not self.result_id:
            self.result_id = f"real_bypass_{uuid.uuid4().hex[:8]}"
        if not self.tested_at:
            self.tested_at = time.time()

    def to_dict(self) -> Dict:
        return {
            "result_id": self.result_id,
            "target_url": self.target_url,
            "bypass_type": self.bypass_type,
            "technique_name": self.technique_name,
            "payload": self.payload[:200] if self.payload else "",
            "method": self.method,
            "response_status": self.response_status,
            "response_time": round(self.response_time, 3),
            "response_length": self.response_length,
            "blocked_by_waf": self.blocked_by_waf,
            "bypass_success": self.bypass_success,
            "vulnerability_confirmed": self.vulnerability_confirmed,
            "evidence": self.evidence[:10],
            "error": self.error,
        }
