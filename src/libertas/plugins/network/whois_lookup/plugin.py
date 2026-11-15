"""查询域名注册信息、注册商、到期时间、DNSSEC、域名年龄等，支持whois命令和在线API注册入口。"""

from .logic import whois_lookup

def register(registry):
    registry.register_tool(
        "whois_lookup",
        whois_lookup,
        params={"target": "域名"},
        category="信息收集",
        desc="WHOIS查询，注册商/注册人/到期时间/DNSSEC/域名年龄/状态码分析"
    )
