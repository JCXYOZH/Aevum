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
from .payload_transformer import *  # noqa: F401,F403

class WAFBypassAutomator:
    """WAF绕过自动化引擎 - 自动尝试变换、判断结果、自适应优化

    完整流程：检测WAF → 获取基线 → 逐个变换尝试 → 判断绕过/拦截 →
    记录统计 → 自适应选择最优变换 → 生成报告
    """

    def __init__(self, timeout: int = 10, user_agent: str = "",
                 max_attempts_per_technique: int = 3, delay: float = 0.0,
                 adaptive: bool = True, stop_on_success: bool = True):
        self.http_client = _BypassHttpClient(timeout=timeout, user_agent=user_agent)
        self.transformer = PayloadTransformer()
        self.waf_detector = WAFDetector()
        self.max_attempts_per_technique = max_attempts_per_technique
        self.delay = delay
        self.adaptive = adaptive
        self.stop_on_success = stop_on_success
        self.global_stats: Dict[str, TechniqueStats] = defaultdict(TechniqueStats)
        self.waf_specific_stats: Dict[str, Dict[str, TechniqueStats]] = defaultdict(lambda: defaultdict(TechniqueStats))
        self.bypass_history: List[WAFBypassResult] = []
        self._lock = threading.RLock()

    def bypass(self, url: str, payload: str, parameter: str = "",
               location: str = "url_param", method: str = "GET",
               techniques: List[str] = None, custom_headers: Dict = None) -> WAFBypassResult:
        """执行WAF绕过测试"""
        result = WAFBypassResult(
            target_url=url,
            original_payload=payload,
            injection_point=location,
            parameter_name=parameter,
        )

        # 1. 检测WAF
        baseline_status, baseline_headers, baseline_body, _ = self.http_client.send(
            url, method=method, headers=custom_headers
        )
        result.waf_product = self.waf_detector.detect_waf(url, baseline_headers, baseline_body)
        baseline_length = len(baseline_body)

        # 2. 确定要尝试的变换技术
        all_techniques = techniques or self.transformer.get_all_techniques()

        # 自适应排序：根据历史成功率排序
        if self.adaptive:
            all_techniques = self._sort_techniques(all_techniques, result.waf_product.value)

        # 3. 逐个尝试
        for technique in all_techniques:
            if self.stop_on_success and result.bypassed:
                break

            for attempt_num in range(self.max_attempts_per_technique):
                if self.delay > 0:
                    time.sleep(self.delay)

                # 变换payload
                if technique == "combined":
                    # 组合变换：使用成功率最高的2-3种
                    transformed = self._apply_combined_transform(payload, result.waf_product.value)
                    technique_chain = self._get_best_techniques(result.waf_product.value, 3)
                else:
                    transformed = self.transformer.transform(payload, technique)
                    technique_chain = [technique]

                # 发送请求
                params = {}
                data = {}
                headers = dict(custom_headers or {})
                cookies = {}

                if location == "url_param":
                    params[parameter] = transformed
                elif location == "post_data":
                    data[parameter] = transformed
                    method = "POST"
                elif location == "header":
                    headers[parameter] = transformed
                elif location == "cookie":
                    cookies[parameter] = transformed

                status, resp_headers, body, resp_time = self.http_client.send(
                    url, method=method, params=params, data=data,
                    headers=headers, cookies=cookies
                )

                # 判断结果
                attempt = BypassAttempt(
                    original_payload=payload,
                    transformed_payload=transformed,
                    technique=technique,
                    technique_chain=technique_chain,
                    url=url,
                    injection_point=location,
                    parameter_name=parameter,
                    http_status=status,
                    response_length=len(body),
                    response_time=resp_time,
                )

                # 判断是否绕过
                bypassed, bypass_indicators = self.waf_detector.is_bypassed(
                    status, resp_headers, body, baseline_length
                )
                blocked, block_indicators = self.waf_detector.is_blocked(
                    status, resp_headers, body, baseline_length
                )

                if bypassed:
                    attempt.status = BypassStatus.BYPASSED
                    attempt.bypass_indicators = bypass_indicators
                elif blocked:
                    attempt.status = BypassStatus.BLOCKED
                    attempt.block_indicators = block_indicators
                elif status == 0:
                    attempt.status = BypassStatus.ERROR
                    attempt.error = body
                else:
                    attempt.status = BypassStatus.UNKNOWN

                result.add_attempt(attempt)

                # 更新统计
                with self._lock:
                    self.global_stats[technique].record(attempt.status, resp_time, transformed)
                    self.waf_specific_stats[result.waf_product.value][technique].record(
                        attempt.status, resp_time, transformed
                    )
                    if technique not in result.technique_stats:
                        result.technique_stats[technique] = TechniqueStats(technique=technique)
                    result.technique_stats[technique].record(attempt.status, resp_time, transformed)

                if attempt.status == BypassStatus.BYPASSED:
                    break  # 该技术成功，不再重试

        result.completed_at = time.time()
        self.bypass_history.append(result)
        return result

    def bypass_multiple_payloads(self, url: str, payloads: List[str],
                                  parameter: str = "", location: str = "url_param",
                                  techniques: List[str] = None) -> List[WAFBypassResult]:
        """对多个payload执行绕过测试"""
        results = []
        for payload in payloads:
            result = self.bypass(url, payload, parameter=parameter,
                                 location=location, techniques=techniques)
            results.append(result)
        return results

    def _sort_techniques(self, techniques: List[str], waf_product: str) -> List[str]:
        """根据历史成功率排序变换技术"""
        waf_stats = self.waf_specific_stats.get(waf_product, {})

        def get_success_rate(tech):
            if tech in waf_stats and waf_stats[tech].total_attempts > 0:
                return waf_stats[tech].success_rate
            if tech in self.global_stats and self.global_stats[tech].total_attempts > 0:
                return self.global_stats[tech].success_rate * 0.8
            return 0.5  # 未测试过的给中等优先级

        return sorted(techniques, key=get_success_rate, reverse=True)

    def _get_best_techniques(self, waf_product: str, count: int = 3) -> List[str]:
        """获取成功率最高的技术"""
        all_techniques = self.transformer.get_all_techniques()
        sorted_techs = self._sort_techniques(all_techniques, waf_product)
        return sorted_techs[:count]

    def _apply_combined_transform(self, payload: str, waf_product: str) -> str:
        """应用组合变换"""
        best_techs = self._get_best_techniques(waf_product, 2)
        return self.transformer.transform_chain(payload, best_techs)

    def get_best_technique_for_waf(self, waf_product: str) -> Dict:
        """获取指定WAF产品的最优绕过技术"""
        waf_stats = self.waf_specific_stats.get(waf_product, {})
        if not waf_stats:
            return {"best_technique": "unknown", "success_rate": 0, "message": "无历史数据"}

        best = max(waf_stats.values(), key=lambda s: s.success_rate if s.total_attempts > 0 else -1)
        return {
            "waf_product": waf_product,
            "best_technique": best.technique,
            "success_rate": best.success_rate,
            "total_attempts": best.total_attempts,
            "successful_bypasses": best.successful_bypasses,
            "effective_payloads": best.effective_payloads[:5],
        }

    def get_global_stats(self) -> Dict:
        """获取全局统计"""
        return {
            "total_techniques_tested": len(self.global_stats),
            "total_bypass_attempts": sum(s.total_attempts for s in self.global_stats.values()),
            "total_successful_bypasses": sum(s.successful_bypasses for s in self.global_stats.values()),
            "overall_success_rate": (
                sum(s.successful_bypasses for s in self.global_stats.values()) /
                max(1, sum(s.total_attempts for s in self.global_stats.values()))
            ),
            "by_technique": {k: v.to_dict() for k, v in self.global_stats.items()},
        }

    def get_waf_specific_stats(self, waf_product: str) -> Dict:
        """获取指定WAF的统计"""
        waf_stats = self.waf_specific_stats.get(waf_product, {})
        return {
            "waf_product": waf_product,
            "techniques_tested": len(waf_stats),
            "total_attempts": sum(s.total_attempts for s in waf_stats.values()),
            "successful_bypasses": sum(s.successful_bypasses for s in waf_stats.values()),
            "by_technique": {k: v.to_dict() for k, v in waf_stats.items()},
        }

    def get_bypass_history(self, limit: int = 10) -> List[Dict]:
        """获取绕过历史"""
        return [r.get_summary() for r in self.bypass_history[-limit:]]

    def export_stats(self, output_path: str) -> bool:
        """导出统计数据"""
        try:
            data = {
                "global_stats": self.get_global_stats(),
                "waf_specific_stats": {k: self.get_waf_specific_stats(k) for k in self.waf_specific_stats},
                "bypass_history_count": len(self.bypass_history),
                "exported_at": time.time(),
            }
            os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            print(f"导出失败: {e}")
            return False
