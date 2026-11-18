"""生成强随机密码，支持自定义长度、字符集、密码强度评估、密码策略建议注册入口。"""

from .logic import password_gen

def register(registry):
    registry.register_tool(
        "password_gen",
        password_gen,
        params={"length": "密码长度（默认16）", "count": "生成数量（默认5）",
                "symbols": "是否包含特殊字符(true/false)", "digits": "是否包含数字(true/false)",
                "uppercase": "是否包含大写字母(true/false)", "lowercase": "是否包含小写字母(true/false)",
                "exclude": "要排除的字符（如容易混淆的字符）"},
        category="工具",
        desc="密码生成器，支持自定义字符集、强度评估、策略建议"
    )
