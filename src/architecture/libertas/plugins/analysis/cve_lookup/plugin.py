"""查询CVE漏洞详情，支持从NVD API获取描述、CVSS评分、受影响产品、参考链接和弱点分类注册入口。"""

from .logic import cve_lookup

def register(registry):
    registry.register_tool(
        "cve_lookup",
        cve_lookup,
        params={"cve_id": "CVE编号（如CVE-2021-44228）"},
        category="信息收集",
        desc="CVE查询，支持描述、CVSS评分、受影响产品、CWE分类和参考链接"
    )
