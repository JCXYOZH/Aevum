"""获取并分析网站robots.txt和sitemap.xml，发现隐藏路径，支持路径可访问性验证注册入口。"""

from .logic import robots_check

def register(registry):
    registry.register_tool(
        "robots_check",
        robots_check,
        params={"target": "目标域名（如 example.com）",
                "verify_paths": "是否验证路径可访问性（默认false）"},
        category="Web安全",
        desc="robots.txt检查，sitemap解析，隐藏路径发现，可访问性验证"
    )
