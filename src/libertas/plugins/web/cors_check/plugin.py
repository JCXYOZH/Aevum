"""多维度检测目标网站的CORS跨域配置安全性，包括Origin反射、凭证、预检请求、ACAH等注册入口。"""

from .logic import cors_check

def register(registry):
    registry.register_tool(
        "cors_check",
        cors_check,
        params={"target": "目标URL", "origin": "测试用Origin（默认https://evil.example.com）"},
        category="Web安全",
        desc="CORS检测，多Origin测试、凭证检测、预检请求、ACAH/ACAM检测"
    )
