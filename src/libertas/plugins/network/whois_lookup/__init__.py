"""查询域名注册信息、注册商、到期时间、DNSSEC、域名年龄等，支持whois命令和在线API插件。"""

from .logic import whois_lookup
from .plugin import register

__all__ = ["register", "whois_lookup"]
