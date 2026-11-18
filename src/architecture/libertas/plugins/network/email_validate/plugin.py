"""验证邮件地址格式、MX记录、SMTP可达性，检测一次性邮箱、角色邮箱、免费邮箱注册入口。"""

from .logic import email_validate

def register(registry):
    registry.register_tool(
        "email_validate",
        email_validate,
        params={"email": "邮件地址", "deep": "是否深度验证MX(true/false)"},
        category="工具",
        desc="邮箱验证，格式/MX/SMTP/一次性邮箱/角色邮箱/免费邮箱检测"
    )
