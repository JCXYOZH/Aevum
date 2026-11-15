"""查询CVE漏洞详情，支持从NVD API获取描述、CVSS评分、受影响产品、参考链接和弱点分类插件。"""

from .logic import cve_lookup
from .plugin import register

__all__ = ["register", "cve_lookup"]
