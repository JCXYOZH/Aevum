"""查询IP地址的地理位置、ASN、组织、时区、开放端口等信息，支持ip-api.com和ipinfo.io插件。"""

from .logic import ip_info
from .plugin import register

__all__ = ["register", "ip_info"]
