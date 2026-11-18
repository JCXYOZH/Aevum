"""Unix时间戳与日期互转，支持多种格式、时区转换、时间差计算、Cron表达式解析插件。"""

from .logic import time_convert
from .plugin import register

__all__ = ["register", "time_convert"]
