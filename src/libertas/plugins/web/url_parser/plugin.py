"""解析URL各部分，跟踪重定向，检测短链接，钓鱼URL检测，参数分析，IDN处理注册入口。"""

from .logic import url_parser

def register(registry):
    registry.register_tool(
        "url_parser",
        url_parser,
        params={"url": "URL地址", "follow_redirects": "是否跟踪重定向(true/false)",
                "analyze": "是否进行安全分析(true/false)"},
        category="工具",
        desc="URL解析，重定向跟踪，钓鱼检测，参数分析"
    )
