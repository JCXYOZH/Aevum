"""Unix时间戳与日期互转，支持多种格式、时区转换、时间差计算、Cron表达式解析注册入口。"""

from .logic import time_convert

def register(registry):
    registry.register_tool(
        "time_convert",
        time_convert,
        params={"value": "时间戳或日期字符串", "mode": "模式(auto/timestamp/date/diff/now/cron)",
                "value2": "第二个时间（diff模式）", "timezone": "时区偏移（如 +8, -5, UTC）"},
        category="工具",
        desc="时间转换，多格式/时区/时间差/Cron解析"
    )
