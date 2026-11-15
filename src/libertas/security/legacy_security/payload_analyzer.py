"""攻击载荷分析器 - 对HTTP请求/响应中的载荷进行分类和风险评分。"""

import re
import base64
import urllib.parse
from typing import Dict, List, Optional, Tuple

PAYLOAD_CATEGORIES = {
    "sqli": {
        "label": "SQL注入",
        "severity": "high",
        "patterns": [
            r"(?i)(\bunion\b.*\bselect\b)",
            r"(?i)(\bselect\b.*\bfrom\b.*\bwhere\b)",
            r"(?i)(\binsert\b\s+\binto\b)",
            r"(?i)(\bdrop\b\s+\b(table|database)\b)",
            r"(?i)(\bupdate\b.*\bset\b.*=)",
            r"(?i)(\bdelete\b\s+\bfrom\b)",
            r"(?i)(\bor\b\s+[\d'\"]+\s*=\s*[\d'\"]+)",
            r"(?i)(\band\b\s+[\d'\"]+\s*=\s*[\d'\"]+)",
            r"(?i)(--|#|/\*).*(select|union|or\s+1)",
            r"(?i)(sleep\s*\(\s*\d+\s*\)|benchmark\s*\()",
            r"(?i)(waitfor\s+delay|pg_sleep|dbms_pipe\.receive_message)",
            r"(?i)(load_file\s*\(|into\s+outfile|into\s+dumpfile)",
            r"(?i)(information_schema|sysobjects|sqlite_master)",
            r"('\s*(or|and)\s+'.*'='|'\s*(or|and)\s+\d+=\d+)",
        ],
    },
    "xss": {
        "label": "跨站脚本",
        "severity": "high",
        "patterns": [
            r"(?i)<\s*script[^>]*>",
            r"(?i)</\s*script\s*>",
            r"(?i)javascript\s*:",
            r"(?i)on(load|error|click|mouseover|focus|submit)\s*=",
            r"(?i)<\s*img[^>]+onerror\s*=",
            r"(?i)<\s*svg[^>]*on\w+\s*=",
            r"(?i)<\s*iframe[^>]*>",
            r"(?i)document\.(cookie|location|write)",
            r"(?i)window\.(location|open|name)",
            r"(?i)eval\s*\(",
            r"(?i)alert\s*\(|confirm\s*\(|prompt\s*\(",
            r"(?i)<\s*body[^>]+onload",
            r"(?i)String\.fromCharCode",
        ],
    },
    "rce": {
        "label": "远程命令执行",
        "severity": "critical",
        "patterns": [
            r"(?i)(;\s*(ls|id|whoami|uname|cat|pwd|curl|wget|nc|bash|sh)\b)",
            r"(?i)(\|\s*(ls|id|whoami|uname|cat|pwd|curl|wget|nc|bash|sh)\b)",
            r"(?i)(`[^`]*(ls|id|whoami|uname|cat|pwd)`)",
            r"(?i)(\$\([^)]*\))",
            r"(?i)(system|exec|passthru|shell_exec|popen|proc_open)\s*\(",
            r"(?i)(/bin/(bash|sh|dash|zsh))",
            r"(?i)(python\s+-c|perl\s+-e|ruby\s+-e|php\s+-r)",
            r"(?i)(nc\s+-e|bash\s+-i|/dev/tcp/)",
            r"(?i)(chmod\s+[0-7]{3,4}|chown\s+)",
            r"(?i)(wget\s+http|curl\s+http.*\|\s*(bash|sh))",
            r"(?i)(\$\{jndi:|ldap://|rmi://|dns://)",
        ],
    },
    "lfi": {
        "label": "文件包含/读取",
        "severity": "high",
        "patterns": [
            r"(?i)(\.\./){2,}",
            r"(?i)(\.\.\\){2,}",
            r"(?i)(/etc/passwd|/etc/shadow|/etc/hosts|/proc/self/)",
            r"(?i)(boot\.ini|win\.ini|system32)",
            r"(?i)(php://filter|php://input|data://|file://)",
            r"(?i)(/var/log/|/proc/version|/etc/issue)",
            r"(?i)(c:\\windows\\|c:/windows/)",
        ],
    },
    "ssrf": {
        "label": "服务端请求伪造",
        "severity": "high",
        "patterns": [
            r"(?i)(127\.0\.0\.1|localhost|0\.0\.0\.0)",
            r"(?i)(169\.254\.169\.254)",
            r"(?i)(10\.\d{1,3}\.\d{1,3}\.\d{1,3})",
            r"(?i)(172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})",
            r"(?i)(192\.168\.\d{1,3}\.\d{1,3})",
            r"(?i)(metadata\.google\.internal|169\.254\.169\.254)",
            r"(?i)(file://|gopher://|dict://|ftp://)",
        ],
    },
    "rce_java": {
        "label": "Java反序列化/JNDI注入",
        "severity": "critical",
        "patterns": [
            r"(?i)(\$\{jndi:)",
            r"(?i)(ldap://|rmi://|ldaps://)",
            r"(?i)(java\.runtime|getRuntime\(\)\.exec)",
            r"(?i)(commons-collections|invokertransformer)",
            r"(?i)(ysoserial|objectInputStream|readObject)",
            r"(?i)(spring\.cloud|spring\.webflow)",
        ],
    },
    "xxe": {
        "label": "XML外部实体注入",
        "severity": "high",
        "patterns": [
            r"(?i)(<!DOCTYPE[^>]*\[)",
            r"(?i)(<!ENTITY\s+\w+\s+SYSTEM)",
            r"(?i)(<!ENTITY\s+\w+\s+PUBLIC)",
            r"(?i)(xmlns:xi=|xinclude)",
        ],
    },
    "ssti": {
        "label": "模板注入",
        "severity": "high",
        "patterns": [
            r"(?i)(\{\{.*\}\})",
            r"(?i)(\{\%.*\%\})",
            r"(?i)(\$\{.*\})",
            r"(?i)(#\{.*\})",
            r"(?i)(<%.*%>)",
            r"(?i)(__class__|__mro__|__subclasses__)",
            r"(?i)(config\.items|self\.data|request\.application)",
        ],
    },
    "dir_traversal": {
        "label": "目录遍历/敏感文件",
        "severity": "medium",
        "patterns": [
            r"(?i)(/admin(/|$)|/administrator(/|$)|/manage(/|$))",
            r"(?i)(/wp-admin|/wp-login|/wp-config)",
            r"(?i)(/phpmyadmin|/pma|/adminer)",
            r"(?i)(\.git/|\.svn/|\.hg/|\.env|\.DS_Store)",
            r"(?i)(\.bak$|\.sql$|\.log$|\.conf$|\.cfg$|\.ini$)",
            r"(?i)(/backup|/db_backup|/database|/dump)",
            r"(?i)(/test\.php|/info\.php|/phpinfo\.php)",
            r"(?i)(/console|/debug|/actuator|/swagger)",
            r"(?i)(/server-status|/server-info)",
        ],
    },
    "auth_bypass": {
        "label": "认证绕过",
        "severity": "high",
        "patterns": [
            r"(?i)(admin'--|admin'#|admin'/\*)",
            r"(?i)(' or 1=1--|' or 1=1#|' or 1=1/\*)",
            r"(?i)(\bor\b\s+true\b|--\s*$)",
            r"(?i)(jwt\s*=|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+)",
            r"(?i)(authorization:\s*bearer\s+)",
        ],
    },
    "cve_exploit": {
        "label": "已知漏洞利用",
        "severity": "critical",
        "patterns": [
            r"(?i)(CVE-\d{4}-\d{4,7})",
            r"(?i)(/actuator/gateway/routes|/actuator/env)",
            r"(?i)(/v2/_catalog|/v2/_internal)",
            r"(?i)(struts2|ognl=|%\{#context)",
            r"(?i)(thinkphp.*invokefunction|think\\app)",
            r"(?i)(/solr/admin/info|/solr/.*config)",
            r"(?i)(/cgi-bin/\.|/cgi-bin/login\.cgi)",
        ],
    },
    "webshell": {
        "label": "Webshell/后门",
        "severity": "critical",
        "patterns": [
            r"(?i)(eval\s*\(\s*\$_(POST|GET|REQUEST|COOKIE))",
            r"(?i)(assert\s*\(\s*\$_(POST|GET|REQUEST))",
            r"(?i)(system\s*\(\s*\$_(POST|GET|REQUEST))",
            r"(?i)(<\?php\s*@?eval)",
            r"(?i)(cmd\.asp|\.jspx?|webshell|c99\.php|r57\.php)",
            r"(?i)(b374k|wso\.php|filesman)",
        ],
    },
}

SEVERITY_SCORES = {"critical": 10, "high": 7, "medium": 4, "low": 2, "info": 1}


def _decode_payloads(text: str) -> List[str]:
    """尝试对载荷进行常见解码，返回原文+解码后的变体列表。"""
    variants = [text]
    try:
        decoded = urllib.parse.unquote(text)
        if decoded != text:
            variants.append(decoded)
    except Exception:
        pass
    try:
        decoded2 = urllib.parse.unquote_plus(text)
        if decoded2 not in variants:
            variants.append(decoded2)
    except Exception:
        pass
    try:
        if len(text) > 16:
            b64 = base64.b64decode(text + "==", validate=False).decode("utf-8", errors="ignore")
            if len(b64) > 4 and b64.isprintable():
                variants.append(b64)
    except Exception:
        pass
    try:
        import html
        decoded3 = html.unescape(text)
        if decoded3 != text and decoded3 not in variants:
            variants.append(decoded3)
    except Exception:
        pass
    return variants


def analyze_payload(payload: str, source: str = "") -> List[Dict]:
    """分析单个载荷字符串，返回匹配的攻击类别列表。

    Args:
        payload: 待分析的文本（URL、请求体、Header值等）
        source: 载荷来源标记（url/body/header/cookie/response）

    Returns:
        匹配结果列表，每个含 category/label/severity/matched/pattern
    """
    if not payload or len(payload) < 3:
        return []

    variants = _decode_payloads(str(payload))
    results = []
    seen_categories = set()

    for cat_id, cat in PAYLOAD_CATEGORIES.items():
        for pattern in cat["patterns"]:
            for variant in variants:
                try:
                    m = re.search(pattern, variant)
                    if m:
                        matched_text = m.group(0)[:120]
                        if cat_id not in seen_categories:
                            results.append({
                                "category": cat_id,
                                "label": cat["label"],
                                "severity": cat["severity"],
                                "matched": matched_text,
                                "pattern": pattern[:60],
                                "source": source,
                            })
                            seen_categories.add(cat_id)
                        break
                except Exception:
                    continue
            if cat_id in seen_categories:
                break

    return results


def analyze_request(
    url: str = "",
    method: str = "GET",
    headers: Optional[Dict] = None,
    body: str = "",
    cookies: Optional[Dict] = None,
) -> Dict:
    """分析完整HTTP请求，返回载荷分析汇总。

    Returns:
        {
            "findings": [...],
            "risk_score": int,
            "risk_level": "critical|high|medium|low|clean",
            "categories": [...],
        }
    """
    all_findings = []

    if url:
        all_findings.extend(analyze_payload(url, "url"))
    if body:
        all_findings.extend(analyze_payload(body, "body"))
    if headers:
        for hk, hv in headers.items():
            if hk.lower() in ("user-agent", "accept", "accept-language", "accept-encoding",
                              "connection", "host", "content-length", "cache-control",
                              "sec-fetch-", "sec-ch-ua"):
                continue
            all_findings.extend(analyze_payload(str(hv), f"header:{hk}"))
    if cookies:
        for ck, cv in cookies.items():
            all_findings.extend(analyze_payload(str(cv), f"cookie:{ck}"))

    risk_score = 0
    for f in all_findings:
        risk_score += SEVERITY_SCORES.get(f["severity"], 1)

    if risk_score >= 15:
        risk_level = "critical"
    elif risk_score >= 8:
        risk_level = "high"
    elif risk_score >= 4:
        risk_level = "medium"
    elif risk_score >= 1:
        risk_level = "low"
    else:
        risk_level = "clean"

    return {
        "findings": all_findings,
        "risk_score": risk_score,
        "risk_level": risk_level,
        "categories": list({f["category"] for f in all_findings}),
        "method": method,
        "url": url[:200] if url else "",
    }


def analyze_response(
    status_code: int = 0,
    headers: Optional[Dict] = None,
    body: str = "",
) -> Dict:
    """分析HTTP响应，检测拦截、报错、敏感信息泄露。

    Returns:
        {
            "blocked": bool,
            "blocked_by": str|None,
            "findings": [...],
            "error_disclosure": [...],
            "sensitive_info": [...],
        }
    """
    from libertas.security.legacy_security.waf_fingerprint import is_blocked_by_waf, detect_waf

    findings = []
    error_disclosure = []
    sensitive_info = []

    blocked_by = is_blocked_by_waf(status_code, headers, body)

    body_sample = body[:10000] if body else ""
    body_lower = body_sample.lower()

    error_patterns = [
        (r"(?i)sql syntax.*mysql", "MySQL错误"),
        (r"(?i)postgresql.*error", "PostgreSQL错误"),
        (r"(?i)microsoft sql server", "MSSQL错误"),
        (r"(?i)oracle error|ora-\d{5}", "Oracle错误"),
        (r"(?i)sqlite3?\.operationalerror", "SQLite错误"),
        (r"(?i)warning:.*\bon line \d+", "PHP Warning"),
        (r"(?i)fatal error:.*", "PHP Fatal Error"),
        (r"(?i)stack trace:|at \w+\.\w+\(", "Java堆栈"),
        (r"(?i)traceback \(most recent", "Python Traceback"),
        (r"(?i)undefined index|undefined variable", "PHP Notice"),
        (r"(?i)internal server error", "500内部错误"),
    ]
    for pat, label in error_patterns:
        if re.search(pat, body_lower):
            error_disclosure.append(label)

    sensitive_patterns = [
        (r"(?i)(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*['\"]?[a-zA-Z0-9]{16,}", "API密钥"),
        (r"(?i)(?:aws[_-]?secret|aws[_-]?access)", "AWS凭证"),
        (r"(?i)(?:password|passwd|pwd)\s*[:=]\s*['\"]?[^\s'\"]{4,}", "密码"),
        (r"(?i)(?:private[_-]?key|BEGIN RSA PRIVATE KEY)", "私钥"),
        (r"(?i)(?:token|auth)\s*[:=]\s*['\"]?[a-zA-Z0-9_\-\.]{20,}", "认证令牌"),
        (r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", "IP地址"),
        (r"(?i)(?:email|e-mail|邮箱)\s*[:=]?\s*[\w.+-]+@[\w-]+\.[\w.-]+", "邮箱地址"),
    ]
    for pat, label in sensitive_patterns:
        if re.search(pat, body_sample):
            sensitive_info.append(label)

    return {
        "blocked": blocked_by is not None,
        "blocked_by": blocked_by,
        "waf_detected": detect_waf(status_code, headers, body=body_sample),
        "findings": findings,
        "error_disclosure": error_disclosure,
        "sensitive_info": sensitive_info,
        "status_code": status_code,
    }
