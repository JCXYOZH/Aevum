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
from .models import *  # noqa: F401,F403
from .browser_automation import *  # noqa: F401,F403

class CaptchaSolver:
    """验证码识别器

    三级识别：OCR → AI模型 → 人工介入
    """

    def __init__(self):
        self.has_tesseract = self._check_tesseract()
        self.has_ai_model = False  # 可扩展接入AI模型

    def _check_tesseract(self) -> bool:
        try:
            import pytesseract
            from PIL import Image
            return True
        except ImportError:
            return False

    def solve(self, image_path: str = None, image_base64: str = None,
              method: str = "auto", max_attempts: int = 3) -> CaptchaResult:
        """识别验证码

        Args:
            image_path: 验证码图片路径
            image_base64: 验证码图片Base64
            method: 识别方法（auto/ocr/ai/manual）
            max_attempts: 最大尝试次数
        """
        result = CaptchaResult(method=method)

        if not image_path and not image_base64:
            result.error = "未提供验证码图片"
            return result

        # 保存图片
        if image_base64 and not image_path:
            image_path = f"captcha_{uuid.uuid4().hex[:8]}.png"
            with open(image_path, 'wb') as f:
                f.write(base64.b64decode(image_base64))
            result.image_path = image_path

        if method == "auto":
            # 自动选择：OCR → AI → 人工
            if self.has_tesseract:
                return self._solve_ocr(image_path, result, max_attempts)
            else:
                result.method = "manual"
                result.error = "未安装OCR库，需要人工识别"
                return result
        elif method == "ocr":
            return self._solve_ocr(image_path, result, max_attempts)
        elif method == "manual":
            result.method = "manual"
            result.error = "等待人工识别"
            return result
        else:
            result.error = f"不支持的识别方法: {method}"
            return result

    def _solve_ocr(self, image_path: str, result: CaptchaResult,
                    max_attempts: int) -> CaptchaResult:
        """使用OCR识别验证码"""
        result.method = "ocr"
        try:
            import pytesseract
            from PIL import Image, ImageFilter, ImageEnhance

            for attempt in range(max_attempts):
                result.attempts = attempt + 1

                # 不同的预处理方式
                img = Image.open(image_path)
                if attempt == 0:
                    # 原图
                    processed = img
                elif attempt == 1:
                    # 灰度+增强对比度
                    processed = img.convert("L")
                    processed = ImageEnhance.Contrast(processed).enhance(2.0)
                elif attempt == 2:
                    # 二值化
                    processed = img.convert("L")
                    processed = processed.point(lambda x: 0 if x < 128 else 255, "1")
                else:
                    # 模糊+锐化
                    processed = img.filter(ImageFilter.SHARPEN)

                # OCR识别
                text = pytesseract.image_to_string(
                    processed,
                    config="--psm 7 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
                ).strip()

                # 清理结果
                text = re.sub(r'[^a-zA-Z0-9]', '', text)

                if len(text) >= 3:
                    result.solved_text = text
                    result.confidence = 0.6 + (attempt * 0.1)  # 尝试越多置信度越低？不，应该是预处理越多越可能准
                    result.success = True
                    break

            if not result.success:
                result.error = f"OCR识别失败，尝试了{result.attempts}次"

        except ImportError:
            result.error = "pytesseract/PIL未安装"
        except Exception as e:
            result.error = f"OCR识别异常: {str(e)}"

        return result

    def submit_manual_result(self, captcha_id: str, text: str) -> CaptchaResult:
        """提交人工识别结果"""
        result = CaptchaResult(
            captcha_id=captcha_id,
            solved_text=text,
            method="manual",
            confidence=1.0,
            success=True,
        )
        return result

class ManualBypassHelper:
    """人工手动操作绕过辅助

    提供浏览器交互界面，让人工手动操作绕过安全验证，
    然后自动捕获操作结果（Cookie/Token/会话）。
    """

    def __init__(self):
        self.browser = BrowserAutomation(headless=False)  # 非无头模式，人工可见
        self.captured_data = {}

    def start_manual_session(self, url: str,
                             capture_elements: List[str] = None) -> Dict:
        """启动人工操作会话

        Args:
            url: 目标URL
            capture_elements: 要捕获的元素选择器列表
        """
        session_id = f"manual_{uuid.uuid4().hex[:8]}"
        self.captured_data[session_id] = {
            "url": url,
            "started_at": time.time(),
            "cookies": [],
            "tokens": {},
            "local_storage": {},
            "session_storage": {},
            "network_requests": [],
            "status": "waiting_for_manual",
        }

        return {
            "session_id": session_id,
            "url": url,
            "instructions": [
                "1. 浏览器窗口已打开",
                "2. 手动完成登录/验证码/人机验证等操作",
                "3. 操作完成后，调用 capture_session() 捕获会话",
                "4. 捕获的Cookie/Token可用于后续自动化请求",
            ],
            "capture_elements": capture_elements or [],
        }

    def capture_session(self, session_id: str) -> Dict:
        """捕获人工操作后的会话数据"""
        if session_id not in self.captured_data:
            return {"error": "会话不存在"}

        data = self.captured_data[session_id]

        try:
            # 使用Playwright捕获当前页面状态
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=False)
                context = browser.new_context()
                page = context.new_page()
                page.goto(data["url"], wait_until="domcontentloaded")

                # 等待人工操作（这里简化为等待固定时间）
                print("请在浏览器中完成操作，30秒后自动捕获...")
                page.wait_for_timeout(30000)

                # 捕获Cookie
                data["cookies"] = context.cookies()

                # 捕获localStorage和sessionStorage
                data["local_storage"] = page.evaluate("() => JSON.stringify(localStorage)")
                data["session_storage"] = page.evaluate("() => JSON.stringify(sessionStorage)")

                # 捕获Token
                tokens = page.evaluate("""() => {
                    const tokens = {};
                    for (let key in localStorage) {
                        if (key.toLowerCase().includes('token') || key.toLowerCase().includes('auth')) {
                            tokens[key] = localStorage[key];
                        }
                    }
                    return tokens;
                }""")
                data["tokens"] = tokens

                browser.close()

            data["status"] = "captured"
            data["captured_at"] = time.time()

        except Exception as e:
            data["error"] = f"捕获失败: {str(e)}"
            data["status"] = "error"

        return data

    def generate_replay_script(self, session_id: str, output_path: str = None) -> str:
        """生成会话重放脚本"""
        if session_id not in self.captured_data:
            return "会话不存在"

        data = self.captured_data[session_id]
        if data["status"] != "captured":
            return "会话尚未捕获"

        # 生成Python重放脚本
        script = f'''#!/usr/bin/env python3
"""
自动生成的会话重放脚本
会话ID: {session_id}
目标URL: {data["url"]}
捕获时间: {data.get("captured_at", time.time())}
"""
import requests

# 捕获的Cookie
cookies = {{
'''
        for cookie in data.get("cookies", []):
            script += f'    "{cookie.get("name", "")}": "{cookie.get("value", "")}",\n'

        script += f'''}}

# 捕获的Token
headers = {{
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
'''

        for key, value in data.get("tokens", {}).items():
            if isinstance(value, str):
                script += f'    "Authorization": "Bearer {value}",\n'

        script += f'''}}

# 使用捕获的会话发送请求
session = requests.Session()
session.cookies.update(cookies)
session.headers.update(headers)

resp = session.get("{data["url"]}", timeout=30, verify=False)
print(f"状态码: {{resp.status_code}}")
print(f"响应长度: {{len(resp.text)}}")
print(resp.text[:500])
'''

        if output_path:
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(script)

        return script
