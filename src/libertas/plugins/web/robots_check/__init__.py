"""获取并分析网站robots.txt和sitemap.xml，发现隐藏路径，支持路径可访问性验证插件。"""

from .logic import robots_check
from .plugin import register

__all__ = ["register", "robots_check"]
