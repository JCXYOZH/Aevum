"""分析Apache/Nginx访问日志，统计攻击特征、扫描器IP、状态码分布、时间分布、地理分布实现。"""

import re

from collections import Counter, defaultdict

from urllib.parse import unquote

SCANNER_UAS = {
    "sqlmap": "SQL注入扫描",
    "nikto": "Web漏洞扫描",
    "nmap": "端口扫描",
    "masscan": "端口扫描",
    "nuclei": "漏洞扫描",
    "dirbuster": "目录爆破",
    "gobuster": "目录爆破",
    "ffuf": "模糊测试",
    "wpscan": "WordPress扫描",
    "acunetix": "漏洞扫描",
    "burpsuite": "代理测试",
    "hydra": "暴力破解",
    "metasploit": "渗透框架",
    "curl": "命令行请求",
    "python-requests": "脚本请求",
    "wget": "命令行下载",
    "zgrab": "批量扫描",
    "zmap": "批量扫描",
    "shodan": "搜索引擎扫描",
    "censys": "搜索引擎扫描",
    "binaryedge": "搜索引擎扫描",
    "fofa": "搜索引擎扫描",
    "quake": "搜索引擎扫描",
    "hunter": "搜索引擎扫描",
    "zoomeye": "搜索引擎扫描",
    "whatweb": "指纹识别",
    "wappalyzer": "指纹识别",
    "arachni": "漏洞扫描",
    "skipfish": "漏洞扫描",
    "w3af": "漏洞扫描",
    "openvas": "漏洞扫描",
    "nessus": "漏洞扫描",
    "retina": "漏洞扫描",
    "appscan": "漏洞扫描",
    "netsparker": "漏洞扫描",
    "insight": "漏洞扫描",
    "qualys": "漏洞扫描",
    "rapid7": "漏洞扫描",
    "tenable": "漏洞扫描",
}

ATTACK_PATTERNS = {
    "SQL注入": re.compile(r"(union\s+select|or\s+1=1|'\s*or\s*'|sleep\(|benchmark\(|information_schema|select\s+.*\s+from|insert\s+into|delete\s+from|drop\s+table|update\s+.*\s+set)", re.I),
    "XSS": re.compile(r"(<script|onerror=|onload=|javascript:|alert\(|document\.cookie|document\.write|eval\()", re.I),
    "路径遍历": re.compile(r"(\.\./|\.\.\\|/etc/passwd|/etc/shadow|boot\.ini|win\.ini|/proc/self|c:\\windows)", re.I),
    "命令注入": re.compile(r"(;\s*(cat|id|whoami|uname|ls|dir)|\|\s*(cat|id|whoami)|\$\(|\`|&&\s*(cat|id|whoami))", re.I),
    "敏感文件": re.compile(r"(\.env|\.git/config|wp-config|phpinfo|\.htaccess|web\.config|\.ssh/id_rsa|composer\.json|package\.json|\.DS_Store|backup|dump)", re.I),
    "LFI/RFI": re.compile(r"(php://|file://|data://|expect://|zip://|phar://)", re.I),
    "SSRF": re.compile(r"(http://127\.0\.0\.1|http://localhost|http://169\.254|http://10\.|http://192\.168|http://172\.(1[6-9]|2[0-9]|3[01]))", re.I),
    "XXE": re.compile(r"(<!ENTITY|<!DOCTYPE|SYSTEM|PUBLIC)", re.I),
    "反序列化": re.compile(r"(O:\d+:|__proto__|prototype\.constructor|java\.io|pickle|yaml)", re.I),
    "文件上传": re.compile(r"(\.php|\.jsp|\.asp|\.aspx|\.jspx|\.php5|\.phtml|\.shell)", re.I),
    "管理后台": re.compile(r"(/admin|/login|/wp-admin|/phpmyadmin|/manager|/console|/dashboard|/cpanel|/webadmin)", re.I),
    "API探测": re.compile(r"(/api/|/graphql|/swagger|/v1/|/v2/|/rest/|/json|/xmlrpc)", re.I),
}

LOG_RE = re.compile(
    r'(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) \S+" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)"'
)

LOG_RE_NGINX = re.compile(
    r'(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) \S+" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)"(?:\s+(\d+\.\d+))?'
)

def log_analyzer(log_text: str = "") -> dict:
    """分析访问日志"""
    if not log_text:
        return {"success": False, "error": "请粘贴日志内容"}
    lines = log_text.strip().split("\n")
    ips = Counter()
    status_codes = Counter()
    scanners = Counter()
    attacks = Counter()
    attack_ips = Counter()
    attack_details = defaultdict(list)
    paths = Counter()
    methods = Counter()
    user_agents = Counter()
    time_distribution = Counter()
    referers = Counter()
    total = 0
    parsed = 0
    failed_parse = 0

    for line in lines:
        total += 1
        line = line.strip()
        if not line:
            continue
        # 尝试多种日志格式
        m = LOG_RE_NGINX.match(line) or LOG_RE.match(line)
        if not m:
            failed_parse += 1
            continue
        parsed += 1
        groups = m.groups()
        ip, ts, method, path, status, size, referer, ua = groups[:8]
        ips[ip] += 1
        status_codes[status] += 1
        methods[method] += 1
        paths[unquote(path)[:100]] += 1
        user_agents[ua[:100]] += 1
        if referer and referer != "-":
            referers[referer[:100]] += 1

        # 时间分布（按小时）
        time_match = re.search(r":(\d{2}):", ts)
        if time_match:
            hour = time_match.group(1)
            time_distribution[hour] += 1

        # 扫描器UA识别
        ua_lower = ua.lower()
        for key, name in SCANNER_UAS.items():
            if key in ua_lower:
                scanners[f"{key} ({name})"] += 1

        # 攻击特征识别
        decoded_path = unquote(path).lower()
        decoded_ua = unquote(ua).lower()
        combined = decoded_path + " " + decoded_ua
        for atk_name, pattern in ATTACK_PATTERNS.items():
            if pattern.search(combined):
                attacks[atk_name] += 1
                attack_ips[ip] += 1
                attack_details[atk_name].append({
                    "ip": ip,
                    "method": method,
                    "path": unquote(path)[:100],
                    "status": status,
                    "time": ts,
                })
                break

    # 统计4xx/5xx错误
    error_4xx = sum(v for k, v in status_codes.items() if k.startswith("4"))
    error_5xx = sum(v for k, v in status_codes.items() if k.startswith("5"))
    success_2xx = sum(v for k, v in status_codes.items() if k.startswith("2"))
    redirect_3xx = sum(v for k, v in status_codes.items() if k.startswith("3"))

    # 高风险IP（攻击次数最多的）
    high_risk_ips = attack_ips.most_common(20)

    return {
        "success": True,
        "result": {
            "总行数": total,
            "成功解析": parsed,
            "解析失败": failed_parse,
            "解析率": f"{round(parsed/total*100, 1)}%" if total > 0 else "0%",
            "独立IP数": len(ips),
            "独立路径数": len(paths),
            "独立UA数": len(user_agents),
            "状态码分布": dict(status_codes.most_common(15)),
            "2xx成功": success_2xx,
            "3xx重定向": redirect_3xx,
            "4xx客户端错误": error_4xx,
            "5xx服务器错误": error_5xx,
            "请求方法分布": dict(methods.most_common(10)),
            "Top20 IP": dict(ips.most_common(20)),
            "扫描器UA": dict(scanners.most_common(15)),
            "攻击类型统计": dict(attacks),
            "攻击总次数": sum(attacks.values()),
            "攻击来源IP数": len(attack_ips),
            "高风险IP(攻击来源)": high_risk_ips,
            "攻击详情(每类前5条)": {k: v[:5] for k, v in attack_details.items()},
            "高频路径Top20": dict(paths.most_common(20)),
            "高频UATop10": dict(user_agents.most_common(10)),
            "时间分布(按小时)": dict(sorted(time_distribution.items())),
            "高频RefererTop10": dict(referers.most_common(10)),
        }
    }
