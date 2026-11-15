"""检测目标网站的HTTP安全响应头配置，包括15+安全头检测、信息泄露头检测、头配置质量评估实现。"""

import urllib.request

import urllib.error

import ssl

SECURITY_HEADERS = {
    "strict-transport-security": {"desc": "HSTS强制HTTPS", "severity": "高", "weight": 15},
    "content-security-policy": {"desc": "内容安全策略", "severity": "高", "weight": 15},
    "x-frame-options": {"desc": "防止点击劫持", "severity": "中", "weight": 10},
    "x-content-type-options": {"desc": "防止MIME嗅探", "severity": "中", "weight": 10},
    "referrer-policy": {"desc": "引用来源策略", "severity": "低", "weight": 5},
    "permissions-policy": {"desc": "权限策略(原Feature-Policy)", "severity": "中", "weight": 10},
    "cross-origin-opener-policy": {"desc": "跨源打开策略", "severity": "低", "weight": 5},
    "cross-origin-embedder-policy": {"desc": "跨源嵌入策略", "severity": "低", "weight": 5},
    "cross-origin-resource-policy": {"desc": "跨源资源策略", "severity": "低", "weight": 5},
    "x-xss-protection": {"desc": "XSS过滤(已废弃但仍有价值)", "severity": "低", "weight": 3},
    "expect-ct": {"desc": "证书透明度强制", "severity": "低", "weight": 3},
    "x-download-options": {"desc": "IE下载选项(noopen)", "severity": "低", "weight": 2},
    "x-dns-prefetch-control": {"desc": "DNS预取控制", "severity": "低", "weight": 2},
    "access-control-allow-origin": {"desc": "CORS跨域配置", "severity": "中", "weight": 8},
    "access-control-allow-credentials": {"desc": "CORS凭证配置", "severity": "中", "weight": 5},
}

INFO_LEAK_HEADERS = [
    "server", "x-powered-by", "x-aspnet-version", "x-aspnetmvc-version",
    "x-drupal-cache", "x-generator", "x-note", "x-server", "x-host",
    "x-node", "x-backend-server", "x-served-by", "x-cache", "x-cache-hits",
    "x-amz-cf-id", "x-amz-request-id", "x-amz-id-2", "x-served-from",
    "x-varnish", "x-fastly-request-id", "x-cdn", "x-edge-location",
]

def _evaluate_header_quality(header_name, value):
    """评估安全头配置质量，返回问题列表"""
    issues = []
    value_lower = value.lower()
    if header_name == "strict-transport-security":
        if "max-age" not in value_lower:
            issues.append("缺少max-age指令")
        else:
            import re
            match = re.search(r"max-age=(\d+)", value_lower)
            if match:
                seconds = int(match.group(1))
                if seconds < 31536000:
                    issues.append(f"max-age={seconds}秒，建议至少31536000秒(1年)")
        if "includesubdomains" not in value_lower:
            issues.append("缺少includeSubDomains指令")
    elif header_name == "content-security-policy":
        if "unsafe-inline" in value_lower:
            issues.append("包含'unsafe-inline'，降低XSS防护效果")
        if "unsafe-eval" in value_lower:
            issues.append("包含'unsafe-eval'，允许eval执行")
        if "default-src *" in value_lower or "default-src 'none'" not in value_lower and "default-src" not in value_lower:
            if "default-src" not in value_lower:
                issues.append("缺少default-src回退策略")
    elif header_name == "x-frame-options":
        if value_lower not in ("deny", "sameorigin"):
            issues.append(f"值为'{value}'，建议使用DENY或SAMEORIGIN")
    elif header_name == "x-content-type-options":
        if value_lower != "nosniff":
            issues.append(f"值为'{value}'，建议使用nosniff")
    elif header_name == "referrer-policy":
        if value_lower in ("unsafe-url", ""):
            issues.append(f"值为'{value}'，可能泄露敏感URL")
    elif header_name == "access-control-allow-origin":
        if value == "*":
            issues.append("ACAO设为*，允许任意域跨域访问")
        elif "null" in value_lower:
            issues.append("允许null Origin，可被iframe沙箱利用")
    return issues

def http_headers_check(target: str = "") -> dict:
    """检测HTTP安全头"""
    if not target:
        return {"success": False, "error": "请输入目标URL"}
    if not target.startswith("http"):
        target = "http://" + target
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(target, headers={
            "User-Agent": "Libertas-Security-Scanner/2.0"
        })
        resp = urllib.request.urlopen(req, timeout=12, context=ctx)
        headers = {k.lower(): v for k, v in resp.headers.items()}

        present = []
        missing = []
        total_weight = 0
        earned_weight = 0
        header_issues = []

        for h, info in SECURITY_HEADERS.items():
            total_weight += info["weight"]
            if h in headers:
                value = headers[h]
                earned_weight += info["weight"]
                issues = _evaluate_header_quality(h, value)
                if issues:
                    header_issues.extend([f"{h}: {issue}" for issue in issues])
                present.append({"header": h, "value": value[:120], **info,
                                 "quality_issues": issues})
            else:
                missing.append({"header": h, **info})

        # 信息泄露头检测
        info_leaks = []
        for h in INFO_LEAK_HEADERS:
            if h in headers:
                info_leaks.append({"header": h, "value": headers[h][:100]})

        # 计算安全评分
        score = int((earned_weight / total_weight) * 100) if total_weight > 0 else 0
        if score >= 80:
            grade = "A (优秀)"
        elif score >= 60:
            grade = "B (良好)"
        elif score >= 40:
            grade = "C (一般)"
        elif score >= 20:
            grade = "D (较差)"
        else:
            grade = "F (危险)"

        # 高风险缺失项
        high_risk_missing = [m for m in missing if m["severity"] == "高"]

        return {
            "success": True,
            "result": {
                "目标": target,
                "状态码": resp.status,
                "安全评分": f"{score}/100",
                "安全等级": grade,
                "已配置安全头": f"{len(present)}/{len(SECURITY_HEADERS)}",
                "已配置": present,
                "缺失": missing,
                "高风险缺失": high_risk_missing,
                "配置问题": header_issues,
                "信息泄露头": info_leaks,
                "服务器": headers.get("server", "未知"),
                "X-Powered-By": headers.get("x-powered-by", "未设置"),
            }
        }
    except urllib.error.HTTPError as e:
        return {"success": False, "error": f"HTTP错误 {e.code}: {e.reason}"}
    except Exception as e:
        return {"success": False, "error": str(e)}
