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

@dataclass
class FuzzResult:
    """模糊测试结果"""
    fuzz_id: str = ""
    target: str = ""
    parameter: str = ""
    original_value: str = ""
    mutated_value: str = ""
    strategy: str = ""
    status_code: int = 0
    response_time: float = 0.0
    response_length: int = 0
    response_headers: Dict = field(default_factory=dict)
    response_body: str = ""
    is_anomaly: bool = False
    anomaly_type: str = ""
    anomaly_description: str = ""
    error: str = ""
    timestamp: float = 0.0

    def __post_init__(self):
        if not self.fuzz_id:
            self.fuzz_id = f"fuzz_{uuid.uuid4().hex[:12]}"
        if not self.timestamp:
            self.timestamp = time.time()

    def to_dict(self) -> Dict:
        return {
            "fuzz_id": self.fuzz_id,
            "target": self.target,
            "parameter": self.parameter,
            "original_value": self.original_value,
            "mutated_value": self.mutated_value[:200] if self.mutated_value else "",
            "strategy": self.strategy,
            "status_code": self.status_code,
            "response_time": self.response_time,
            "response_length": self.response_length,
            "is_anomaly": self.is_anomaly,
            "anomaly_type": self.anomaly_type,
            "anomaly_description": self.anomaly_description,
            "error": self.error,
        }

class ParameterFuzzer:
    """参数模糊测试器

    对URL参数、POST参数、Header、Cookie进行模糊测试。
    检测异常响应（500错误、超时、响应长度异常、错误信息泄露）。
    """

    def __init__(self, timeout: int = 10, max_retries: int = 1,
                 anomaly_threshold: float = 2.0):
        self.timeout = timeout
        self.max_retries = max_retries
        self.anomaly_threshold = anomaly_threshold
        self.mutation_engine = MutationEngine()
        self.results: List[FuzzResult] = []
        self.baseline = None

    def set_baseline(self, url: str, parameter: str, value: str = "test"):
        """设置基线响应（用于异常检测对比）"""
        try:
            import requests
            test_url = self._build_url(url, parameter, value)
            response = requests.get(test_url, timeout=self.timeout, allow_redirects=False)
            self.baseline = {
                "status_code": response.status_code,
                "response_time": response.elapsed.total_seconds(),
                "response_length": len(response.content),
                "response_headers": dict(response.headers),
            }
            return self.baseline
        except Exception as e:
            self.baseline = {"error": str(e)}
            return self.baseline

    def fuzz_parameter(self, url: str, parameter: str, original_value: str = "1",
                        count: int = 50, strategies: List = None) -> List[FuzzResult]:
        """模糊测试单个参数"""
        if self.baseline is None:
            self.set_baseline(url, parameter, original_value)

        mutations = self.mutation_engine.generate_mutations(
            original_value, count, strategies
        )

        results = []
        for mutated in mutations:
            result = self._send_fuzz_request(url, parameter, original_value, mutated)
            if result:
                results.append(result)
                self.results.append(result)

        return results

    def fuzz_url_parameters(self, url: str, count: int = 30) -> Dict[str, List[FuzzResult]]:
        """自动发现并模糊测试URL中的所有参数"""
        parsed = urlparse(url)
        params = parse_qs(parsed.query)

        results = {}
        for param in params:
            original = params[param][0] if params[param] else "1"
            results[param] = self.fuzz_parameter(url, param, original, count)

        return results

    def _send_fuzz_request(self, url: str, parameter: str,
                             original: str, mutated: str) -> Optional[FuzzResult]:
        """发送模糊测试请求"""
        result = FuzzResult(
            target=url,
            parameter=parameter,
            original_value=original,
            mutated_value=mutated,
        )

        try:
            import requests
            fuzz_url = self._build_url(url, parameter, mutated)

            start = time.time()
            response = requests.get(fuzz_url, timeout=self.timeout, allow_redirects=False)
            result.response_time = time.time() - start
            result.status_code = response.status_code
            result.response_length = len(response.content)
            result.response_headers = dict(response.headers)
            result.response_body = response.text[:5000]

            # 异常检测
            self._detect_anomaly(result)

        except Exception as e:
            result.error = str(e)
            result.is_anomaly = True
            result.anomaly_type = "connection_error"
            result.anomaly_description = f"连接错误: {str(e)[:100]}"

        return result

    def _build_url(self, url: str, parameter: str, value: str) -> str:
        """构建模糊测试URL"""
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        params[parameter] = [value]
        new_query = urlencode(params, doseq=True)
        return urlunparse(parsed._replace(query=new_query))

    def _detect_anomaly(self, result: FuzzResult):
        """检测异常响应"""
        # 500错误
        if result.status_code >= 500:
            result.is_anomaly = True
            result.anomaly_type = "server_error"
            result.anomaly_description = f"服务器错误: {result.status_code}"
            return

        # 超时（响应时间超过基线2倍）
        if self.baseline and "response_time" in self.baseline:
            baseline_time = self.baseline["response_time"]
            if baseline_time > 0 and result.response_time > baseline_time * self.anomaly_threshold:
                result.is_anomaly = True
                result.anomaly_type = "timeout"
                result.anomaly_description = (
                    f"响应时间异常: {result.response_time:.2f}s "
                    f"(基线: {baseline_time:.2f}s)"
                )
                return

        # 响应长度异常
        if self.baseline and "response_length" in self.baseline:
            baseline_len = self.baseline["response_length"]
            if baseline_len > 0:
                ratio = result.response_length / baseline_len
                if ratio > 3 or ratio < 0.1:
                    result.is_anomaly = True
                    result.anomaly_type = "length_anomaly"
                    result.anomaly_description = (
                        f"响应长度异常: {result.response_length} "
                        f"(基线: {baseline_len}, 比率: {ratio:.2f})"
                    )
                    return

        # 错误信息泄露
        error_patterns = [
            (r'SQL syntax.*MySQL', "sql_error_mysql"),
            (r'Microsoft SQL Server.*error', "sql_error_mssql"),
            (r'PostgreSQL.*ERROR', "sql_error_postgres"),
            (r'Oracle.*error', "sql_error_oracle"),
            (r'SQLite.*error', "sql_error_sqlite"),
            (r'Warning.*mysql_', "php_mysql_warning"),
            (r'Fatal error', "php_fatal_error"),
            (r'Traceback', "python_traceback"),
            (r'Exception in thread', "java_exception"),
            (r'NullReferenceException', "dotnet_null_ref"),
            (r'Stack trace', "stack_trace"),
            (r'/etc/passwd', "file_disclosure"),
            (r'root:.*:0:0:', "passwd_disclosure"),
        ]
        for pattern, atype in error_patterns:
            if re.search(pattern, result.response_body, re.IGNORECASE):
                result.is_anomaly = True
                result.anomaly_type = atype
                result.anomaly_description = f"检测到错误信息: {atype}"
                return

    def get_anomalies(self) -> List[FuzzResult]:
        """获取所有异常结果"""
        return [r for r in self.results if r.is_anomaly]

    def get_stats(self) -> Dict:
        anomalies = self.get_anomalies()
        return {
            "total_requests": len(self.results),
            "anomalies": len(anomalies),
            "by_anomaly_type": dict(Counter(a.anomaly_type for a in anomalies)),
            "by_status_code": dict(Counter(r.status_code for r in self.results)),
            "average_response_time": (
                sum(r.response_time for r in self.results) / len(self.results)
                if self.results else 0
            ),
        }
