"""解析URL各部分，跟踪重定向，检测短链接，钓鱼URL检测，参数分析，IDN处理插件。"""

from .logic import url_parser
from .plugin import register

__all__ = ["register", "url_parser"]
