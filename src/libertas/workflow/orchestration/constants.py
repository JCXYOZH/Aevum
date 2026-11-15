"""职责模块：constants。"""

from __future__ import annotations

RISK_AUTO = "auto"

RISK_SUGGEST = "suggest"

ORCHESTRATION_RULES = [
    {
        "name": "http_from_port",
        "trigger_tool": ("port_scan", "nmap", "rustscan", "masscan", "naabu"),
        "condition": lambda p: any(
            pt.get("port") in (80, 8080, 8000, 8888, 8443, 8081) and pt.get("state") == "open"
            for pt in p.get("ports", [])
        ),
        "next_tool": "http_fingerprint",
        "target_from": "target",
        "risk": RISK_AUTO,
        "description": "发现HTTP端口，自动识别Web服务",
    },
    {
        "name": "https_from_port",
        "trigger_tool": ("port_scan", "nmap", "rustscan", "masscan", "naabu"),
        "condition": lambda p: any(
            pt.get("port") in (443, 8443) and pt.get("state") == "open"
            for pt in p.get("ports", [])
        ),
        "next_tool": "ssl_info",
        "target_from": "target",
        "risk": RISK_AUTO,
        "description": "发现HTTPS端口，自动检查SSL证书",
    },
    {
        "name": "ssh_from_port",
        "trigger_tool": ("port_scan", "nmap", "rustscan", "masscan", "naabu"),
        "condition": lambda p: any(
            pt.get("port") == 22 and pt.get("state") == "open"
            for pt in p.get("ports", [])
        ),
        "next_tool": "ssh_banner",
        "target_from": "target",
        "risk": RISK_AUTO,
        "description": "发现SSH端口，自动抓取Banner",
    },
    {
        "name": "cve_from_fingerprint",
        "trigger_tool": "http_fingerprint",
        "condition": lambda p: bool(p.get("technologies")) and bool(p.get("server")),
        "next_tool": "cve_search",
        "target_from": "server_product",
        "risk": RISK_AUTO,
        "description": "识别到服务版本，自动查询已知CVE",
    },
    {
        "name": "nuclei_after_http",
        "trigger_tool": "http_fingerprint",
        "condition": lambda p: p.get("status", 0) == 200,
        "next_tool": "nuclei",
        "target_from": "target",
        "risk": RISK_SUGGEST,
        "description": "发现Web服务，建议运行nuclei漏洞扫描",
    },
    {
        "name": "ffuf_after_http",
        "trigger_tool": "http_fingerprint",
        "condition": lambda p: p.get("status", 0) == 200,
        "next_tool": "ffuf",
        "target_from": "target",
        "risk": RISK_SUGGEST,
        "description": "发现Web服务，建议目录爆破",
    },
    {
        "name": "subdomain_enum_then_dns",
        "trigger_tool": "crt_sh",
        "condition": lambda p: p.get("count", 0) > 0,
        "next_tool": "dns_lookup",
        "target_from": "first_subdomain",
        "risk": RISK_AUTO,
        "description": "发现子域名，自动解析DNS",
    },
]
