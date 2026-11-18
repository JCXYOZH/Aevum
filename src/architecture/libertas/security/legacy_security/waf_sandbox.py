"""WAF绕过测试沙箱 - 本地规则引擎，在打真实目标前验证payload是否会触发WAF。

内置一套轻量级规则（模拟主流WAF的OWASP CRS核心检测逻辑），
支持加载自定义规则，纯Python实现，零外部依赖。
"""

import re
import os
import json
import time
import threading
from typing import Dict, List, Optional, Any
from urllib.parse import unquote


class WAFSandbox:
    """本地WAF沙箱，模拟WAF检测逻辑。"""

    def __init__(self, rules_dir: str = ""):
        self._rules: List[Dict] = []
        self._custom_rules: List[Dict] = []
        self._lock = threading.Lock()
        self._stats = {"total_tested": 0, "total_blocked": 0, "total_passed": 0}
        self._load_builtin_rules()
        if rules_dir:
            self.load_rules(rules_dir)

    def _load_builtin_rules(self):
        """加载内置规则（模拟OWASP CRS核心规则集的关键检测）。"""
        self._rules = [
            {"id": "BX-1001", "name": "SQL注入-UNION查询", "severity": "critical",
             "patterns": [r"(?i)union\s+(all\s+)?select", r"(?i)'\s*union\s+select"]},
            {"id": "BX-1002", "name": "SQL注入-布尔盲注", "severity": "high",
             "patterns": [r"(?i)'\s*or\s+'?\d+'?\s*=\s*'?\d+", r"(?i)'\s*and\s+'?\d+'?\s*=\s*'?\d+"]},
            {"id": "BX-1003", "name": "SQL注入-时间盲注", "severity": "critical",
             "patterns": [r"(?i)sleep\s*\(\s*\d+\s*\)", r"(?i)benchmark\s*\(\s*\d+", r"(?i)waitfor\s+delay",
                          r"(?i)pg_sleep\s*\(", r"(?i)dbms_pipe\.receive_message"]},
            {"id": "BX-1004", "name": "SQL注入-堆叠/注释", "severity": "high",
             "patterns": [r";\s*(drop|insert|update|delete|create|alter)\s", r"(?i)/\*.*?\*/",
                          r"(?i)--\s*$", r"(?i)#\s*$"]},
            {"id": "BX-1005", "name": "SQL注入-信息架构", "severity": "high",
             "patterns": [r"(?i)information_schema", r"(?i)sysobjects", r"(?i)sqlite_master",
                          r"(?i)load_file\s*\(", r"(?i)into\s+(outfile|dumpfile)"]},
            {"id": "BX-2001", "name": "XSS-script标签", "severity": "high",
             "patterns": [r"(?i)<\s*script[^>]*>", r"(?i)</\s*script\s*>", r"(?i)javascript\s*:"]},
            {"id": "BX-2002", "name": "XSS-事件处理器", "severity": "high",
             "patterns": [r"(?i)on(load|error|click|mouseover|focus|submit|mouseout|keydown|keyup)\s*=",
                          r"(?i)<\s*img[^>]+onerror", r"(?i)<\s*svg[^>]*on\w+"]},
            {"id": "BX-2003", "name": "XSS-DOM操作", "severity": "medium",
             "patterns": [r"(?i)document\.(cookie|location|write|domain)",
                          r"(?i)window\.(location|open|name)", r"(?i)eval\s*\(",
                          r"(?i)String\.fromCharCode"]},
            {"id": "BX-3001", "name": "RCE-命令注入", "severity": "critical",
             "patterns": [r";\s*(ls|id|whoami|uname|cat|pwd|curl|wget|nc|bash|sh|ping|nslookup)\b",
                          r"\|\s*(ls|id|whoami|uname|cat|pwd|curl|wget|nc|bash|sh)\b",
                          r"`[^`]*(ls|id|whoami|uname|cat|pwd)`",
                          r"(?i)/bin/(bash|sh|dash|zsh)", r"(?i)nc\s+-e\s+/",
                          r"(?i)bash\s+-i\s+>&", r"(?i)/dev/tcp/"]},
            {"id": "BX-3002", "name": "RCE-代码执行", "severity": "critical",
             "patterns": [r"(?i)(system|exec|passthru|shell_exec|popen|proc_open)\s*\(",
                          r"(?i)python\s+-c\s+['\"]", r"(?i)perl\s+-e\s+['\"]",
                          r"(?i)php\s+-r\s+['\"]", r"(?i)\$\([^)]+\)"]},
            {"id": "BX-3003", "name": "JNDI/Log4j注入", "severity": "critical",
             "patterns": [r"(?i)\$\{jndi:", r"(?i)ldap://", r"(?i)rmi://", r"(?i)dns://"]},
            {"id": "BX-4001", "name": "路径遍历", "severity": "high",
             "patterns": [r"(?:\.\./){2,}", r"(?:\.\.\\){2,}",
                          r"(?i)/etc/passwd", r"(?i)/etc/shadow", r"(?i)boot\.ini",
                          r"(?i)c:\\windows\\", r"(?i)c:/windows/"]},
            {"id": "BX-4002", "name": "协议包装器", "severity": "high",
             "patterns": [r"(?i)php://(filter|input)", r"(?i)data://", r"(?i)file://",
                          r"(?i)gopher://", r"(?i)expect://"]},
            {"id": "BX-5001", "name": "XXE注入", "severity": "high",
             "patterns": [r"(?i)<!DOCTYPE[^>]*\[", r"(?i)<!ENTITY\s+\w+\s+SYSTEM",
                          r"(?i)<!ENTITY\s+\w+\s+PUBLIC"]},
            {"id": "BX-5002", "name": "SSTI模板注入", "severity": "high",
             "patterns": [r"\{\{.*?\}\}", r"\{%.*?%\}", r"(?i)__class__",
                          r"(?i)__mro__", r"(?i)__subclasses__", r"(?i)config\.items"]},
            {"id": "BX-6001", "name": "敏感文件访问", "severity": "medium",
             "patterns": [r"(?i)/\.git/", r"(?i)/\.env\b", r"(?i)/\.svn/",
                          r"(?i)/wp-config\.php", r"(?i)/\.htaccess",
                          r"(?i)/\.DS_Store", r"(?i)\.(bak|sql|log|conf|old|swp)$"]},
            {"id": "BX-6002", "name": "后台/管理路径", "severity": "low",
             "patterns": [r"(?i)/(admin|administrator|manage|manager|console|backend)(/|$)",
                          r"(?i)/phpmyadmin", r"(?i)/adminer", r"(?i)/actuator"]},
            {"id": "BX-7001", "name": "Webshell特征", "severity": "critical",
             "patterns": [r"(?i)eval\s*\(\s*\$_(POST|GET|REQUEST|COOKIE)",
                          r"(?i)assert\s*\(\s*\$_(POST|GET|REQUEST)",
                          r"(?i)<\?php\s*@?eval"]},
            {"id": "BX-8001", "name": "扫描器指纹", "severity": "low",
             "patterns": [r"(?i)(sqlmap|nmap|nikto|dirbuster|gobuster|wpscan|acunetix|nessus|burp|zgrab)",
                          r"(?i)(masscan|rustscan|naabu|httpx|ffuf|wfuzz)"]},
            {"id": "BX-9001", "name": "CVE利用特征", "severity": "critical",
             "patterns": [r"(?i)CVE-\d{4}-\d{4,7}",
                          r"(?i)/actuator/gateway/routes", r"(?i)thinkphp.*invokefunction",
                          r"(?i)struts2.*ognl", r"(?i)/solr/.*config",
                          r"(?i)/cgi-bin/\."]},
        ]

    def load_rules(self, rules_dir: str):
        """从目录加载自定义规则（JSON格式）。"""
        if not os.path.isdir(rules_dir):
            return
        for fname in os.listdir(rules_dir):
            if not fname.endswith(".json"):
                continue
            try:
                with open(os.path.join(rules_dir, fname), "r", encoding="utf-8") as f:
                    rules = json.load(f)
                if isinstance(rules, list):
                    self._custom_rules.extend(rules)
            except Exception:
                continue

    def add_rule(self, rule_id: str, name: str, patterns: List[str], severity: str = "medium"):
        """动态添加规则。"""
        with self._lock:
            self._custom_rules.append({
                "id": rule_id, "name": name, "patterns": patterns, "severity": severity,
            })

    def _check_payload(self, payload: str, rules: List[Dict]) -> List[Dict]:
        """检查payload是否命中规则。返回命中的规则列表。"""
        hits = []
        decoded_variants = [payload]
        try:
            d = unquote(payload)
            if d != payload:
                decoded_variants.append(d)
        except Exception:
            pass
        try:
            d2 = unquote(payload).replace("\\x", "%")
            if d2 not in decoded_variants:
                decoded_variants.append(d2)
        except Exception:
            pass

        for rule in rules:
            for pattern in rule.get("patterns", []):
                for variant in decoded_variants:
                    try:
                        if re.search(pattern, variant):
                            hits.append({
                                "rule_id": rule["id"],
                                "rule_name": rule["name"],
                                "severity": rule.get("severity", "medium"),
                                "matched": re.search(pattern, variant).group(0)[:100],
                            })
                            break
                    except Exception:
                        continue
                if hits and hits[-1]["rule_id"] == rule["id"]:
                    break
        return hits

    def test(self, payload: str, source: str = "url") -> Dict[str, Any]:
        """测试单个payload是否会被WAF拦截。

        Args:
            payload: 待测试的payload
            source: 来源（url/body/header/cookie）

        Returns:
            {
                "payload": str,
                "blocked": bool,
                "hits": [...],
                "severity": str,
                "suggestion": str,
            }
        """
        with self._lock:
            self._stats["total_tested"] += 1

        all_rules = self._rules + self._custom_rules
        hits = self._check_payload(str(payload), all_rules)

        blocked = len(hits) > 0
        if blocked:
            with self._lock:
                self._stats["total_blocked"] += 1
        else:
            with self._lock:
                self._stats["total_passed"] += 1

        severity = "clean"
        if hits:
            sev_order = {"critical": 4, "high": 3, "medium": 2, "low": 1}
            max_sev = max(sev_order.get(h["severity"], 0) for h in hits)
            severity = {v: k for k, v in sev_order.items()}.get(max_sev, "medium")

        suggestion = ""
        if blocked:
            if any(h["rule_id"].startswith("BX-1") for h in hits):
                suggestion = "SQLi被拦截：尝试大小写混合、内联注释/**/、编码、参数污染、HTTP方法变换"
            elif any(h["rule_id"].startswith("BX-2") for h in hits):
                suggestion = "XSS被拦截：尝试事件处理器变形、HTML实体编码、JSfuck、SVG/Img标签变体"
            elif any(h["rule_id"].startswith("BX-3") for h in hits):
                suggestion = "RCE被拦截：尝试空格替代(${IFS})、变量拼接、通配符、编码、反斜杠转义"
            elif any(h["rule_id"].startswith("BX-4") for h in hits):
                suggestion = "路径遍历被拦截：尝试双重编码、绝对路径、Unicode编码、空字节"
            else:
                suggestion = "被拦截：尝试编码变形、大小写混合、注释分割、Content-Type变换"

        return {
            "payload": payload[:200],
            "source": source,
            "blocked": blocked,
            "hits": hits,
            "severity": severity,
            "suggestion": suggestion,
            "timestamp": time.time(),
        }

    def test_batch(self, payloads: List[str], source: str = "url") -> List[Dict]:
        """批量测试payload。"""
        return [self.test(p, source) for p in payloads]

    def test_request(self, url: str = "", body: str = "", headers: Optional[Dict] = None) -> Dict:
        """测试完整请求的各个部分。"""
        all_hits = []
        parts = []
        if url:
            r = self.test(url, "url")
            all_hits.extend(r["hits"])
            parts.append(r)
        if body:
            r = self.test(body, "body")
            all_hits.extend(r["hits"])
            parts.append(r)
        if headers:
            for hk, hv in headers.items():
                if hk.lower() in ("user-agent", "accept", "accept-language", "connection",
                                  "host", "content-length", "cache-control"):
                    continue
                r = self.test(str(hv), f"header:{hk}")
                all_hits.extend(r["hits"])
                parts.append(r)

        blocked = len(all_hits) > 0
        return {
            "blocked": blocked,
            "hits": all_hits,
            "parts": parts,
            "hit_count": len(all_hits),
        }

    def get_stats(self) -> Dict:
        with self._lock:
            return dict(self._stats)

    def reset_stats(self):
        with self._lock:
            self._stats = {"total_tested": 0, "total_blocked": 0, "total_passed": 0}

    def list_rules(self) -> List[Dict]:
        return [{"id": r["id"], "name": r["name"], "severity": r.get("severity", "medium")}
                for r in self._rules + self._custom_rules]


_sandbox_instance: Optional[WAFSandbox] = None
_sandbox_lock = threading.Lock()


def get_waf_sandbox(rules_dir: str = "") -> WAFSandbox:
    """获取WAF沙箱单例。"""
    global _sandbox_instance
    if _sandbox_instance is None:
        with _sandbox_lock:
            if _sandbox_instance is None:
                _sandbox_instance = WAFSandbox(rules_dir)
    return _sandbox_instance
