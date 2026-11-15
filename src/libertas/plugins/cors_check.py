"""插件: 增强版CORS配置检测
版本: 2.0.0
分类: Web安全
描述: 多维度检测目标网站的CORS跨域配置安全性，包括Origin反射、凭证、预检请求、ACAH等
"""
import urllib.request
import urllib.error
import ssl


def register(registry):
    registry.register_tool(
        "cors_check",
        cors_check,
        params={"target": "目标URL", "origin": "测试用Origin（默认https://evil.example.com）"},
        category="Web安全",
        desc="增强版CORS检测，多Origin测试、凭证检测、预检请求、ACAH/ACAM检测"
    )


def _make_request(url, origin, method="GET", extra_headers=None):
    """发送HTTP请求并返回响应头"""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    headers = {"User-Agent": "Libertas-CORS-Scanner/2.0", "Origin": origin}
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=10, context=ctx)
        return {k.lower(): v for k, v in resp.headers.items()}, resp.status
    except urllib.error.HTTPError as e:
        return {k.lower(): v for k, v in e.headers.items()}, e.code
    except Exception as e:
        return {"error": str(e)}, 0


def cors_check(target: str = "", origin: str = "https://evil.example.com") -> dict:
    """增强版CORS检测"""
    if not target:
        return {"success": False, "error": "请输入目标URL"}
    if not target.startswith("http"):
        target = "http://" + target

    findings = []
    test_results = []

    # 测试1: 基础Origin反射测试
    headers1, status1 = _make_request(target, origin)
    acao1 = headers1.get("access-control-allow-origin", "")
    acac1 = headers1.get("access-control-allow-credentials", "")
    test_results.append({"test": "基础Origin反射", "origin": origin,
                          "acao": acao1, "acac": acac1, "status": status1})

    if acao1 == "*":
        findings.append("ACAO设为*，允许任意域跨域访问（中风险）")
    elif acao1 == origin:
        findings.append(f"反射任意Origin: {origin}（高风险，存在CORS劫持）")
    elif acao1 and "null" in acao1.lower():
        findings.append("允许null Origin，可被iframe沙箱利用（高风险）")
    if acac1.lower() == "true" and acao1 and acao1 != "*":
        findings.append("允许凭证(ACAC=true)且Origin反射，可窃取用户Cookie数据（严重风险）")

    # 测试2: null Origin测试
    headers2, status2 = _make_request(target, "null")
    acao2 = headers2.get("access-control-allow-origin", "")
    test_results.append({"test": "null Origin测试", "origin": "null",
                          "acao": acao2, "status": status2})
    if acao2 == "null":
        findings.append("反射null Origin，可通过sandboxed iframe利用（高风险）")

    # 测试3: 子域名前缀测试（如 evil.target.com）
    from urllib.parse import urlparse
    parsed = urlparse(target)
    host = parsed.hostname or ""
    if host and "." in host:
        # 测试前缀匹配
        prefix_origin = f"https://evil{host}"
        headers3, status3 = _make_request(target, prefix_origin)
        acao3 = headers3.get("access-control-allow-origin", "")
        test_results.append({"test": "前缀匹配测试", "origin": prefix_origin,
                              "acao": acao3, "status": status3})
        if acao3 == prefix_origin:
            findings.append(f"前缀匹配漏洞: evil{host} 被允许（高风险）")

        # 测试后缀匹配
        suffix_origin = f"https://{host}.evil.com"
        headers4, status4 = _make_request(target, suffix_origin)
        acao4 = headers4.get("access-control-allow-origin", "")
        test_results.append({"test": "后缀匹配测试", "origin": suffix_origin,
                              "acao": acao4, "status": status4})
        if acao4 == suffix_origin:
            findings.append(f"后缀匹配漏洞: {host}.evil.com 被允许（高风险）")

    # 测试4: 预检请求(OPTIONS)测试
    preflight_headers = {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "X-Custom-Header, Content-Type",
    }
    headers5, status5 = _make_request(target, origin, method="OPTIONS",
                                       extra_headers=preflight_headers)
    acam = headers5.get("access-control-allow-methods", "")
    acah = headers5.get("access-control-allow-headers", "")
    acma = headers5.get("access-control-max-age", "")
    test_results.append({"test": "预检请求(OPTIONS)", "origin": origin,
                          "acao": headers5.get("access-control-allow-origin", ""),
                          "acam": acam, "acah": acah, "acma": acma, "status": status5})

    if acam and ("*" in acam or "PUT" in acam or "DELETE" in acam):
        findings.append(f"预检允许危险方法: {acam}（中风险）")
    if acah and "*" in acah:
        findings.append("预检允许任意请求头（中风险）")

    # 测试5: ACAH(暴露头)检测
    acae = headers1.get("access-control-expose-headers", "")
    if acae:
        test_results.append({"test": "暴露头检测", "acae": acae})
        sensitive_headers = ["authorization", "set-cookie", "x-csrf-token", "x-api-key"]
        for sh in sensitive_headers:
            if sh in acae.lower():
                findings.append(f"暴露敏感头: {sh}（高风险）")

    # 风险评级
    risk_level = "安全"
    risk_score = 0
    for f in findings:
        if "严重" in f:
            risk_score += 10
        elif "高风险" in f:
            risk_score += 5
        elif "中风险" in f:
            risk_score += 2
    if risk_score >= 10:
        risk_level = "严重"
    elif risk_score >= 5:
        risk_level = "高风险"
    elif risk_score >= 2:
        risk_level = "中风险"
    elif risk_score > 0:
        risk_level = "低风险"

    return {
        "success": True,
        "result": {
            "目标": target,
            "测试Origin": origin,
            "风险等级": risk_level,
            "风险评分": risk_score,
            "发现问题": findings,
            "测试详情": test_results,
            "ACAO(基础)": acao1 or "(未设置)",
            "ACAC(基础)": acac1 or "(未设置)",
            "预检允许方法": acam or "(未设置)",
            "预检允许头": acah or "(未设置)",
            "预检缓存时间": acma or "(未设置)",
            "暴露头": acae or "(未设置)",
        }
    }
