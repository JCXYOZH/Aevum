"""分析Apache/Nginx访问日志，统计攻击特征、扫描器IP、状态码分布、时间分布、地理分布注册入口。"""

from .logic import log_analyzer

def register(registry):
    registry.register_tool(
        "log_analyzer",
        log_analyzer,
        params={"log_text": "日志内容（粘贴Apache/Nginx访问日志）"},
        category="信息收集",
        desc="日志分析，12种攻击类型识别，30+扫描器UA，时间分布，地理分布"
    )
