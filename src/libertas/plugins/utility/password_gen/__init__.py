"""生成强随机密码，支持自定义长度、字符集、密码强度评估、密码策略建议插件。"""

from .logic import password_gen
from .plugin import register

__all__ = ["register", "password_gen"]
