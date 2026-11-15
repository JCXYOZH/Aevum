"""插件: 增强版URL解析与分析
版本: 2.0.0
分类: 工具
描述: 解析URL各部分，跟踪重定向，检测短链接，钓鱼URL检测，参数分析，IDN处理
"""
import urllib.request
import urllib.error
import ssl
from urllib.parse import urlparse, parse_qs, urlunparse, urlencode, quote, unquote
import re


def register(registry):
    registry.register_tool(
        "url_parser",
        url_parser,
        params={"url": "URL地址", "follow_redirects": "是否跟踪重定向(true/false)",
                "analyze": "是否进行安全分析(true/false)"},
        category="工具",
        desc="增强版URL解析，重定向跟踪，钓鱼检测，参数分析"
    )


# 常见短链接域名
SHORT_URL_DOMAINS = [
    "bit.ly", "tinyurl.com", "goo.gl", "t.co", "ow.ly", "is.gd", "buff.ly",
    "rebrand.ly", "shorturl.at", "cutt.ly", "rb.gy", "lnkd.in", "fb.me",
    "youtu.be", "amzn.to", "ebay.to", "wp.me", "j.mp", "qr.ae", "s.id",
    "kutt.it", "short.cm", "bl.ink", "linklyhq.com", "switchy.io",
]

# 钓鱼URL常见特征
PHISHING_PATTERNS = [
    (r'(?:login|signin|account|verify|secure|update|confirm|password|wallet|banking|paypal|apple|microsoft|google|facebook|instagram|twitter|amazon|netflix|whatsapp|telegram)\.[a-z0-9-]+\.[a-z]{2,}', "仿冒知名品牌子域名"),
    (r'(?:login|signin|account|verify|secure|update|confirm|password|wallet)[-_]', "包含敏感关键词"),
    (r'@', "URL中包含@符号，可能隐藏真实域名"),
    (r'%[0-9a-fA-F]{2}', "包含URL编码字符，可能隐藏恶意内容"),
    (r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}', "使用IP地址而非域名"),
    (r'[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+\.[a-z]{2,}', "多级子域名（可能用于钓鱼）"),
]


def _detect_phishing(url, parsed):
    """检测钓鱼URL特征"""
    findings = []
    risk_score = 0
    url_lower = url.lower()
    host = parsed.hostname or ""
    # 检查短链接
    is_short_url = any(domain in host for domain in SHORT_URL_DOMAINS)
    if is_short_url:
        findings.append("短链接服务，可能隐藏真实目标")
        risk_score += 10
    # 检查钓鱼模式
    for pattern, desc in PHISHING_PATTERNS:
        if re.search(pattern, url_lower):
            findings.append(desc)
            risk_score += 15
    # 检查域名长度异常
    if len(host) > 30:
        findings.append("域名过长，可能包含仿冒关键词")
        risk_score += 5
    # 检查连字符数量
    if host.count('-') > 2:
        findings.append("域名包含过多连字符，常见于钓鱼网站")
        risk_score += 5
    # 检查非标准端口
    if parsed.port and parsed.port not in (80, 443):
        findings.append(f"使用非标准端口 {parsed.port}")
        risk_score += 5
    # 风险等级
    if risk_score >= 40:
        risk_level = "高危"
    elif risk_score >= 20:
        risk_level = "中危"
    elif risk_score >= 10:
        risk_level = "低危"
    else:
        risk_level = "安全"
    return {"risk_score": risk_score, "risk_level": risk_level,
            "findings": findings, "is_short_url": is_short_url}


def _analyze_params(query):
    """分析URL参数"""
    params = parse_qs(query)
    sensitive_params = ["token", "password", "passwd", "pwd", "secret", "key",
                        "api_key", "apikey", "access_token", "refresh_token",
                        "session", "cookie", "auth", "credential", "ssn",
                        "credit_card", "card_number", "cvv", "phone", "mobile",
                        "email", "id_card", "身份证", "手机号", "密码"]
    found_sensitive = []
    for param in params.keys():
        for sp in sensitive_params:
            if sp in param.lower():
                found_sensitive.append(param)
    return {
        "参数总数": len(params),
        "参数列表": {k: v[0] if len(v) == 1 else v for k, v in params.items()},
        "敏感参数": found_sensitive,
        "警告": "URL中包含敏感参数，可能通过Referer泄露" if found_sensitive else "",
    }


def url_parser(url: str = "", follow_redirects: str = "true", analyze: str = "true") -> dict:
    """解析URL（增强版）"""
    if not url:
        return {"success": False, "error": "请输入URL"}
    if not url.startswith("http"):
        url = "http://" + url
    result = {"原始URL": url}
    # 解析各部分
    parsed = urlparse(url)
    result["解析"] = {
        "协议": parsed.scheme,
        "主机": parsed.hostname,
        "端口": parsed.port or ("443" if parsed.scheme == "https" else "80"),
        "路径": parsed.path or "/",
        "查询参数": {k: v[0] if len(v) == 1 else v for k, v in parse_qs(parsed.query).items()},
        "锚点": parsed.fragment or None,
        "用户名": parsed.username,
        "完整路径": parsed.path + ("?" + parsed.query if parsed.query else ""),
    }
    # 参数分析
    if str(analyze).lower() not in ("false", "0", "no", ""):
        result["参数分析"] = _analyze_params(parsed.query)
        result["安全分析"] = _detect_phishing(url, parsed)
    # 跟踪重定向
    if str(follow_redirects).lower() not in ("false", "0", "no", ""):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        redirect_chain = []
        try:
            class RedirectHandler(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, req, fp, code, msg, headers, newurl):
                    redirect_chain.append({"from": req.full_url, "to": newurl, "status": code})
                    return urllib.request.HTTPRedirectHandler.redirect_request(
                        self, req, fp, code, msg, headers, newurl)
            opener = urllib.request.build_opener(RedirectHandler)
            req = urllib.request.Request(url, headers={"User-Agent": "Libertas-Scanner/2.0"})
            resp = opener.open(req, timeout=10)
            final_url = resp.url
            result["最终URL"] = final_url
            result["状态码"] = resp.status
            result["服务器"] = resp.headers.get("Server", "未知")
            result["内容类型"] = resp.headers.get("Content-Type", "未知")
            result["内容长度"] = resp.headers.get("Content-Length", "未知")
            result["重定向链"] = redirect_chain
            result["重定向次数"] = len(redirect_chain)
            # 安全检测
            if final_url != url:
                result["重定向警告"] = "URL发生了重定向，请确认最终地址可信"
            final_parsed = urlparse(final_url)
            if parsed.scheme == "http" and final_parsed.scheme == "http":
                result["安全警告"] = "使用明文HTTP，数据可能被窃听"
            if final_parsed.scheme == "https":
                result["HTTPS"] = "已启用（加密传输）"
        except urllib.error.HTTPError as e:
            result["状态码"] = e.code
            result["最终URL"] = e.url
            result["重定向链"] = redirect_chain
        except Exception as e:
            result["错误"] = str(e)
    return {"success": True, "result": result}
