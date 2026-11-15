"""多维度检测目标网站的CORS跨域配置安全性，包括Origin反射、凭证、预检请求、ACAH等插件。"""

from .logic import cors_check
from .plugin import register

__all__ = ["register", "cors_check"]
