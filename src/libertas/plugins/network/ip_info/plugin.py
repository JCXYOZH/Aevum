"""查询IP地址的地理位置、ASN、组织、时区、开放端口等信息，支持ip-api.com和ipinfo.io注册入口。"""

from .logic import ip_info

def register(registry):
    registry.register_tool(
        "ip_info",
        ip_info,
        params={"target": "IP地址或域名", "scan_ports": "是否扫描常见端口（默认true）"},
        category="信息收集",
        desc="IP信息查询，地理位置/ASN/组织/时区/ISP/端口扫描"
    )
