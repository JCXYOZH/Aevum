"""分析Apache/Nginx访问日志，统计攻击特征、扫描器IP、状态码分布、时间分布、地理分布插件。"""

from .logic import log_analyzer
from .plugin import register

__all__ = ["register", "log_analyzer"]
