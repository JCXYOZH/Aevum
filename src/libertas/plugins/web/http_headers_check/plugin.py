"""检测目标网站的HTTP安全响应头配置，包括15+安全头检测、信息泄露头检测、头配置质量评估注册入口。"""

from .logic import http_headers_check

def register(registry):
    registry.register_tool(
        "http_headers_check",
        http_headers_check,
        params={"target": "目标URL（如 https://example.com）"},
        category="Web安全",
        desc="HTTP安全头检测，15+安全头、信息泄露头检测、配置质量评分"
    )
