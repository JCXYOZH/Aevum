"""验证邮件地址格式、MX记录、SMTP可达性，检测一次性邮箱、角色邮箱、免费邮箱插件。"""

from .logic import email_validate
from .plugin import register

__all__ = ["register", "email_validate"]
