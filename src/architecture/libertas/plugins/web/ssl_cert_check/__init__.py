"""检查目标网站SSL证书的详细信息，包括证书链、弱密码套件、密钥算法、有效期等插件。"""

from .logic import ssl_cert_check
from .plugin import register

__all__ = ["register", "ssl_cert_check"]
