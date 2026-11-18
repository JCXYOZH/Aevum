"""检测目标网站的HTTP安全响应头配置，包括15+安全头检测、信息泄露头检测、头配置质量评估插件。"""

from .logic import http_headers_check
from .plugin import register

__all__ = ["register", "http_headers_check"]
