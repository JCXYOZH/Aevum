# tools/native_tools.py
"""
原生网络安全工具 - 纯Python标准库实现，不依赖外部工具安装
支持跨平台（Windows/macOS/Linux）

每个工具返回统一格式：
{
    "success": bool,
    "tool": str,
    "target": str,
    "data": Any,
    "raw_output": str,
    "scan_time": str,
    "error": str (可选)
}
"""
import os
import re
import ssl
import sys
import json
import time
import socket
import struct
import shutil
import platform
import inspect
import subprocess
import threading
import urllib.request
import urllib.error
from typing import Dict, List, Any, Optional, Callable
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeout
from datetime import datetime
from libertas.utils.text_decode import decode_output

from .constants import *


def native_ssl_info(host: str, port: int = 443, timeout: float = 10) -> Dict[str, Any]:
    """SSL/TLS证书信息获取（增强版：证书链/SAN/密钥算法/有效期/签名算法/弱密码套件）"""
    try:
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        with socket.create_connection((host, port), timeout=timeout) as sock:
            with context.wrap_socket(sock, server_hostname=host) as ssock:
                cert = ssock.getpeercert()
                cert_binary = ssock.getpeercert(binary_form=True)
                cipher = ssock.cipher()
                version = ssock.version()
                # 获取证书链
                try:
                    chain = ssock.get_unverified_chain()
                    chain_info = []
                    if chain:
                        for i, c in enumerate(chain):
                            c_dict = dict(x[0] for x in c.get("subject", []))
                            i_dict = dict(x[0] for x in c.get("issuer", []))
                            chain_info.append({
                                "position": i,
                                "subject": c_dict.get("commonName", str(c_dict)),
                                "issuer": i_dict.get("organizationName", i_dict.get("commonName", str(i_dict))),
                                "notAfter": c.get("notAfter", ""),
                            })
                except Exception:
                    chain_info = []

        cert_info = {}
        security_issues = []
        if cert:
            cert_info["subject"] = dict(x[0] for x in cert.get("subject", []))
            cert_info["issuer"] = dict(x[0] for x in cert.get("issuer", []))
            cert_info["version"] = cert.get("version")
            cert_info["serialNumber"] = cert.get("serialNumber")
            cert_info["notBefore"] = cert.get("notBefore")
            cert_info["notAfter"] = cert.get("notAfter")
            # SAN扩展（DNS和IP）
            san = cert.get("subjectAltName", [])
            cert_info["subjectAltName"] = [v for k, v in san if k == "DNS"]
            cert_info["subjectAltIP"] = [v for k, v in san if k == "IP Address"]
            cert_info["san_count"] = len(san)
            # 签名算法
            try:
                cert_info["signatureAlgorithm"] = cert.get("signatureAlgorithm", "")
            except Exception:
                pass
            # 密钥算法和长度（从证书二进制解析）
            try:
                if cert_binary:
                    # 简单检测RSA/ECDSA（通过证书OID）
                    cert_hex = cert_binary.hex()
                    if "2a864886f70d010101" in cert_hex:  # RSA OID
                        cert_info["keyAlgorithm"] = "RSA"
                    elif "2a8648ce3d0201" in cert_hex:  # EC OID
                        cert_info["keyAlgorithm"] = "ECDSA"
                    else:
                        cert_info["keyAlgorithm"] = "unknown"
            except Exception:
                cert_info["keyAlgorithm"] = "unknown"
            # 有效期计算
            try:
                from datetime import datetime as dt
                not_after = dt.strptime(cert.get("notAfter", ""), "%b %d %H:%M:%S %Y %Z")
                not_before = dt.strptime(cert.get("notBefore", ""), "%b %d %H:%M:%S %Y %Z")
                now = dt.utcnow()
                days_remaining = (not_after - now).days
                cert_info["daysRemaining"] = days_remaining
                cert_info["isExpired"] = days_remaining < 0
                cert_info["isExpiringSoon"] = 0 <= days_remaining <= 30
                if days_remaining < 0:
                    security_issues.append(f"证书已过期({abs(days_remaining)}天)")
                elif days_remaining <= 30:
                    security_issues.append(f"证书即将过期(剩余{days_remaining}天)")
            except Exception:
                pass
            # 证书透明度（CT）检查 - 简单检测
            try:
                cert_info["ctPrecertificate"] = False  # 简化，实际需要解析CT扩展
            except Exception:
                pass

        # 弱密码套件检测
        weak_ciphers = ["RC4", "DES", "3DES", "MD5", "NULL", "EXPORT", "anon", "CBC"]
        cipher_name = cipher[0] if cipher else ""
        is_weak_cipher = any(w in cipher_name.upper() for w in weak_ciphers)
        if is_weak_cipher:
            security_issues.append(f"使用弱密码套件: {cipher_name}")

        # 协议版本安全检查
        if version in ("SSLv3", "TLSv1", "TLSv1.1"):
            security_issues.append(f"使用过时协议: {version}")

        lines = [f"SSL/TLS for {host}:{port}"]
        lines.append(f"Protocol: {version}")
        lines.append(f"Cipher: {cipher_name} ({'弱' if is_weak_cipher else '安全'})")
        if cert_info.get("subject"):
            subj = cert_info['subject']
            lines.append(f"Subject: {subj.get('commonName', str(subj))}")
            lines.append(f"Issuer: {cert_info['issuer'].get('organizationName', cert_info['issuer'].get('commonName', str(cert_info['issuer'])))}")
            lines.append(f"Valid: {cert_info.get('notBefore')} ~ {cert_info.get('notAfter')}")
            if "daysRemaining" in cert_info:
                lines.append(f"剩余天数: {cert_info['daysRemaining']}天 {'(已过期!)' if cert_info.get('isExpired') else '(即将过期!)' if cert_info.get('isExpiringSoon') else ''}")
            lines.append(f"SAN: {cert_info.get('san_count', 0)}个域名")
            if cert_info.get("keyAlgorithm"):
                lines.append(f"密钥算法: {cert_info['keyAlgorithm']}")
        if chain_info:
            lines.append(f"证书链: {len(chain_info)}级")
            for c in chain_info:
                lines.append(f"  [{c['position']}] {c['subject']} (签发: {c['issuer']})")
        if security_issues:
            lines.append("\n安全问题:")
            for issue in security_issues:
                lines.append(f"  [!!] {issue}")

        return _result("native_ssl_info", host, True,
                       data={"host": host, "port": port, "protocol": version,
                             "cipher": cipher, "certificate": cert_info,
                             "chain": chain_info, "security_issues": security_issues,
                             "weak_cipher": is_weak_cipher},
                       raw="\n".join(lines))
    except Exception as e:
        return _result("native_ssl_info", host, False, error=str(e))

def native_cors_checker(url: str, origin: str = "https://evil.example.com",
                        timeout: float = 10) -> Dict[str, Any]:
    """检测CORS跨域配置是否安全（增强版：多Origin测试、预检请求、凭证检测、ACAH检测）"""
    if not url.startswith("http"):
        url = "http://" + url
    def _make_request(test_url, test_origin, method="GET", extra_headers=None):
        headers = {"User-Agent": "Mozilla/5.0 (MrHua Scanner/2.0)", "Origin": test_origin}
        if extra_headers:
            headers.update(extra_headers)
        try:
            req = urllib.request.Request(test_url, headers=headers, method=method)
            resp = urllib.request.urlopen(req, timeout=timeout)
            return {k.lower(): v for k, v in resp.headers.items()}, resp.status
        except urllib.error.HTTPError as e:
            return {k.lower(): v for k, v in e.headers.items()}, e.code
        except Exception:
            return {}, 0
    try:
        findings = []
        test_results = []
        # 测试1: 基础Origin反射
        h1, s1 = _make_request(url, origin)
        acao1 = h1.get("access-control-allow-origin", "")
        acac1 = h1.get("access-control-allow-credentials", "")
        test_results.append({"test": "基础Origin反射", "origin": origin, "acao": acao1, "acac": acac1})
        if acao1 == "*":
            findings.append("ACAO设为*，允许任意域跨域访问（中风险）")
        elif acao1 == origin:
            findings.append(f"反射任意Origin: {origin}（高风险，存在CORS劫持）")
        elif acao1 and "null" in acao1.lower():
            findings.append("允许null Origin，可被iframe沙箱利用（高风险）")
        if acac1.lower() == "true" and acao1 and acao1 != "*":
            findings.append("允许凭证(ACAC=true)且Origin反射，可窃取用户Cookie数据（严重风险）")
        # 测试2: null Origin
        h2, s2 = _make_request(url, "null")
        acao2 = h2.get("access-control-allow-origin", "")
        test_results.append({"test": "null Origin测试", "origin": "null", "acao": acao2})
        if acao2 == "null":
            findings.append("反射null Origin，可通过sandboxed iframe利用（高风险）")
        # 测试3: 预检请求(OPTIONS)
        preflight_headers = {"Access-Control-Request-Method": "POST",
                              "Access-Control-Request-Headers": "X-Custom-Header, Content-Type"}
        h3, s3 = _make_request(url, origin, method="OPTIONS", extra_headers=preflight_headers)
        acam = h3.get("access-control-allow-methods", "")
        acah = h3.get("access-control-allow-headers", "")
        acma = h3.get("access-control-max-age", "")
        test_results.append({"test": "预检请求(OPTIONS)", "acao": h3.get("access-control-allow-origin", ""),
                              "acam": acam, "acah": acah, "acma": acma})
        if acam and ("*" in acam or "PUT" in acam or "DELETE" in acam):
            findings.append(f"预检允许危险方法: {acam}（中风险）")
        if acah and "*" in acah:
            findings.append("预检允许任意请求头（中风险）")
        # 测试4: 暴露头(ACAE)检测
        acae = h1.get("access-control-expose-headers", "")
        if acae:
            test_results.append({"test": "暴露头检测", "acae": acae})
            sensitive = ["authorization", "set-cookie", "x-csrf-token", "x-api-key"]
            for sh in sensitive:
                if sh in acae.lower():
                    findings.append(f"暴露敏感头: {sh}（高风险）")
        # 风险评级
        risk_score = 0
        for f in findings:
            if "严重" in f: risk_score += 10
            elif "高风险" in f: risk_score += 5
            elif "中风险" in f: risk_score += 2
        if risk_score >= 10: risk_level = "严重"
        elif risk_score >= 5: risk_level = "高风险"
        elif risk_score >= 2: risk_level = "中风险"
        elif risk_score > 0: risk_level = "低风险"
        else: risk_level = "安全"
        raw = f"目标: {url}\nOrigin: {origin}\n风险等级: {risk_level}\nACAO: {acao1 or '(无)'}\nACAC: {acac1 or '(无)'}\n"
        if findings:
            raw += "\n发现问题:\n"
            for v in findings:
                raw += f"  - {v}\n"
        return _result("cors_checker", url, True,
                       data={"url": url, "acao": acao1, "acac": acac1, "risk": risk_level,
                             "risk_score": risk_score, "vulnerabilities": findings,
                             "test_results": test_results, "acam": acam, "acah": acah,
                             "acma": acma, "acae": acae},
                       raw=raw)
    except Exception as e:
        return _result("cors_checker", url, False, error=str(e))

def native_cookie_analyzer(url: str, timeout: float = 10) -> Dict[str, Any]:
    """分析Cookie的安全属性（增强版：Secure/HttpOnly/SameSite/Path/Domain/Expires/优先级）"""
    if not url.startswith("http"):
        url = "http://" + url
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (MrHua Scanner/2.0)"})
        resp = urllib.request.urlopen(req, timeout=timeout)
        cookies = resp.headers.get_all("Set-Cookie") or []
        results = []
        total_issues = 0
        for ck in cookies:
            parts = ck.split(";")
            name_val = parts[0].strip()
            name = name_val.split("=")[0].strip() if "=" in name_val else name_val
            value = name_val.split("=", 1)[1] if "=" in name_val else ""
            attrs = [p.strip().lower() for p in parts[1:]]
            attr_dict = {}
            for a in parts[1:]:
                a = a.strip()
                if "=" in a:
                    k, v = a.split("=", 1)
                    attr_dict[k.strip().lower()] = v.strip()
                else:
                    attr_dict[a.strip().lower()] = True
            issues = []
            secure = any(a.startswith("secure") for a in attrs)
            httponly = any(a.startswith("httponly") for a in attrs)
            samesite = next((a for a in attrs if a.startswith("samesite")), "")
            path = attr_dict.get("path", "/")
            domain = attr_dict.get("domain", "")
            expires = attr_dict.get("expires", "")
            max_age = attr_dict.get("max-age", "")
            priority = attr_dict.get("priority", "")
            if not secure:
                issues.append("缺少Secure属性（可通过HTTP明文传输）")
            if not httponly:
                issues.append("缺少HttpOnly属性（可被JavaScript读取，存在XSS窃取风险）")
            if not samesite:
                issues.append("缺少SameSite属性（存在CSRF风险）")
            elif "samesite=none" in samesite and not secure:
                issues.append("SameSite=None但缺少Secure（浏览器会拒绝此Cookie）")
            if path and path != "/":
                pass
            if domain:
                pass
            # 敏感Cookie名称检测
            sensitive_names = ["session", "token", "auth", "login", "user", "pass",
                               "csrf", "xsrf", "jwt", "sid", "phpsessid", "asp.net_sessionid"]
            is_sensitive = any(sn in name.lower() for sn in sensitive_names)
            if is_sensitive and not secure:
                issues.append("敏感Cookie缺少Secure（高风险）")
            if is_sensitive and not httponly:
                issues.append("敏感Cookie缺少HttpOnly（高风险）")
            if is_sensitive and not samesite:
                issues.append("敏感Cookie缺少SameSite（高风险）")
            total_issues += len(issues)
            results.append({"name": name, "value_length": len(value),
                            "attributes": attrs, "attr_dict": attr_dict,
                            "secure": secure, "httponly": httponly, "samesite": samesite or "(未设置)",
                            "path": path, "domain": domain or "(未设置)",
                            "expires": expires or "(会话Cookie)", "max_age": max_age or "(未设置)",
                            "priority": priority or "(未设置)", "is_sensitive": is_sensitive,
                            "issues": issues, "issue_count": len(issues)})
        # 总体评分
        if not cookies:
            score = 100
            grade = "N/A (无Cookie)"
        else:
            total_attrs = len(cookies) * 3  # Secure + HttpOnly + SameSite
            missing = sum(1 for r in results if not r["secure"]) +                       sum(1 for r in results if not r["httponly"]) +                       sum(1 for r in results if not r["samesite"] or r["samesite"] == "(未设置)")
            score = int((1 - missing / total_attrs) * 100) if total_attrs > 0 else 100
            if score >= 90: grade = "A (优秀)"
            elif score >= 70: grade = "B (良好)"
            elif score >= 50: grade = "C (一般)"
            elif score >= 30: grade = "D (较差)"
            else: grade = "F (危险)"
        raw = f"Cookie数量: {len(results)}\n安全评分: {score}/100 ({grade})\n总问题数: {total_issues}\n"
        for r in results:
            status = "安全" if not r["issues"] else f"{r['issue_count']}个问题"
            raw += f"\n{r['name']}: {status}\n"
            raw += f"  Secure: {'✅' if r['secure'] else '❌'} | HttpOnly: {'✅' if r['httponly'] else '❌'} | SameSite: {r['samesite']}\n"
            if r["issues"]:
                for issue in r["issues"]:
                    raw += f"  ⚠️ {issue}\n"
        return _result("cookie_analyzer", url, True,
                       data={"url": url, "cookies": results, "total": len(results),
                             "total_issues": total_issues, "score": score, "grade": grade}, raw=raw)
    except Exception as e:
        return _result("cookie_analyzer", url, False, error=str(e))

def native_jwt_decoder(token: str) -> Dict[str, Any]:
    """解码JWT Token的Header和Payload，增强安全分析（alg混淆/claim验证/敏感信息检测）"""
    try:
        parts = token.strip().split(".")
        if len(parts) < 2:
            return _result("jwt_decoder", token[:20], False, error="不是有效的JWT格式")
        import base64
        import time as _time
        def b64decode(s):
            s += "=" * (4 - len(s) % 4)
            return json.loads(base64.urlsafe_b64decode(s))
        header = b64decode(parts[0])
        payload = b64decode(parts[1])
        # 增强安全分析
        issues = []
        alg = header.get("alg", "").lower()
        # alg混淆检测
        if alg == "none":
            issues.append("alg=none：无签名算法，可直接伪造Token（严重）")
        if alg == "hs256" and "kid" in header:
            issues.append("HS256+kid：可能存在kid注入攻击，可读取任意文件或SQL注入（高风险）")
        if alg in ("rs256", "rs384", "rs512") and "jku" in header:
            issues.append("RSA+jku：可能存在jku注入，可指定公钥URL伪造签名（高风险）")
        if alg in ("rs256", "rs384", "rs512") and "x5u" in header:
            issues.append("RSA+x5u：可能存在x5u注入，可指定证书URL伪造签名（高风险）")
        if "x5c" in header:
            issues.append("包含x5c头：可能存在证书链注入攻击（中风险）")
        if header.get("cty") == "JWT":
            issues.append("嵌套JWT(cty=JWT)：可能存在内层JWT未验证（中风险）")
        # claim验证
        now = int(_time.time())
        if "exp" in payload:
            exp = payload["exp"]
            exp_time = datetime.fromtimestamp(exp)
            if exp < now:
                issues.append(f"Token已过期 ({exp_time})")
            elif exp - now < 3600:
                issues.append(f"Token将在1小时内过期（剩余{(exp-now)//60}分钟）")
            elif exp - now > 86400 * 30:
                issues.append(f"Token有效期过长（{(exp-now)//86400}天），建议缩短有效期")
        else:
            issues.append("缺少exp(过期时间)claim，Token永不过期（高风险）")
        if "iat" in payload:
            iat = payload["iat"]
            if iat > now + 60:
                issues.append("iat(签发时间)在未来，可能存在时钟问题或伪造")
        else:
            issues.append("缺少iat(签发时间)claim")
        if "nbf" in payload:
            nbf = payload["nbf"]
            if nbf > now:
                issues.append("nbf(生效时间)在未来，Token尚未生效")
        if "iss" not in payload:
            issues.append("缺少iss(签发者)claim")
        if "aud" not in payload:
            issues.append("缺少aud(受众)claim")
        if "jti" not in payload:
            issues.append("缺少jti(JWT ID)claim，无法防止重放攻击")
        # 敏感信息检测
        payload_str = json.dumps(payload).lower()
        sensitive_keys = ["password", "passwd", "pwd", "secret", "token", "key",
                          "api_key", "apikey", "private", "credential", "ssn",
                          "credit_card", "card_number", "cvv", "phone", "mobile",
                          "email", "id_card"]
        found_sensitive = []
        for key in payload.keys():
            for sk in sensitive_keys:
                if sk in key.lower():
                    found_sensitive.append(key)
        if found_sensitive:
            issues.append(f"Payload包含敏感字段: {', '.join(found_sensitive)}（高风险）")
        # 风险评级
        risk_score = 0
        for issue in issues:
            if "严重" in issue: risk_score += 10
            elif "高风险" in issue: risk_score += 5
            elif "中风险" in issue: risk_score += 2
            else: risk_score += 1
        if risk_score >= 15: risk_level = "严重"
        elif risk_score >= 8: risk_level = "高风险"
        elif risk_score >= 4: risk_level = "中风险"
        elif risk_score > 0: risk_level = "低风险"
        else: risk_level = "安全"
        raw = f"算法: {header.get('alg', 'unknown')} ({'对称' if alg.startswith('hs') else '非对称' if alg.startswith(('rs','es','ps')) else '无签名'})\n"
        raw += f"风险等级: {risk_level} (评分: {risk_score})\n"
        raw += f"Header: {json.dumps(header, indent=2, ensure_ascii=False)}\n"
        raw += f"Payload: {json.dumps(payload, indent=2, ensure_ascii=False)}\n"
        if len(parts) > 2:
            raw += f"Signature: {parts[2][:30]}...(已截断)\n"
        if issues:
            raw += f"\n安全问题 ({len(issues)}个):\n"
            for i in issues:
                raw += f"  ⚠️ {i}\n"
        return _result("jwt_decoder", token[:20] + "...", True,
                       data={"header": header, "payload": payload,
                             "signature_preview": parts[2][:30] if len(parts) > 2 else "",
                             "issues": issues, "issue_count": len(issues),
                             "risk_level": risk_level, "risk_score": risk_score,
                             "algorithm": header.get("alg", "unknown")}, raw=raw)
    except Exception as e:
        return _result("jwt_decoder", token[:20], False, error=str(e))
