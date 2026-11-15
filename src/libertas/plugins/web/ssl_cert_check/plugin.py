"""检查目标网站SSL证书的详细信息，包括证书链、弱密码套件、密钥算法、有效期等注册入口。"""

from .logic import ssl_cert_check

def register(registry):
    registry.register_tool(
        "ssl_cert_check",
        ssl_cert_check,
        params={"target": "域名", "port": "端口（默认443）"},
        category="信息收集",
        desc="SSL证书检查，支持证书链、弱密码套件、密钥算法检测"
    )
