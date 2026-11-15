"""职责模块：time_utils。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, TypeVar, Generic, Union
import datetime
import re
import time

class TimeUtils:
    """时间日期工具"""

    @staticmethod
    def now() -> float:
        return time.time()

    @staticmethod
    def now_iso() -> str:
        return datetime.datetime.now().isoformat()

    @staticmethod
    def now_str(format: str = "%Y-%m-%d %H:%M:%S") -> str:
        return datetime.datetime.now().strftime(format)

    @staticmethod
    def timestamp_to_str(timestamp: float,
                         format: str = "%Y-%m-%d %H:%M:%S") -> str:
        return datetime.datetime.fromtimestamp(timestamp).strftime(format)

    @staticmethod
    def str_to_timestamp(date_str: str,
                         format: str = "%Y-%m-%d %H:%M:%S") -> float:
        return datetime.datetime.strptime(date_str, format).timestamp()

    @staticmethod
    def format_duration(seconds: float) -> str:
        if seconds < 0:
            return "0秒"
        days = int(seconds // 86400)
        hours = int((seconds % 86400) // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        parts = []
        if days > 0:
            parts.append(f"{days}天")
        if hours > 0:
            parts.append(f"{hours}小时")
        if minutes > 0:
            parts.append(f"{minutes}分钟")
        if secs > 0 or not parts:
            parts.append(f"{secs}秒")
        return "".join(parts)

    @staticmethod
    def parse_duration(duration_str: str) -> float:
        """解析时长字符串，如 '1d2h30m' -> 95400.0"""
        total = 0.0
        matches = re.findall(r'(\d+(?:\.\d+)?)\s*([dhms])', duration_str.lower())
        multipliers = {'d': 86400, 'h': 3600, 'm': 60, 's': 1}
        for value, unit in matches:
            total += float(value) * multipliers[unit]
        return total

    @staticmethod
    def is_weekend(timestamp: float = 0.0) -> bool:
        dt = datetime.datetime.fromtimestamp(timestamp or time.time())
        return dt.weekday() >= 5

    @staticmethod
    def start_of_day(timestamp: float = 0.0) -> float:
        dt = datetime.datetime.fromtimestamp(timestamp or time.time())
        return datetime.datetime(dt.year, dt.month, dt.day).timestamp()

    @staticmethod
    def end_of_day(timestamp: float = 0.0) -> float:
        return TimeUtils.start_of_day(timestamp) + 86400 - 0.001

    @staticmethod
    def days_between(ts1: float, ts2: float) -> int:
        return abs(int((TimeUtils.start_of_day(ts2) - TimeUtils.start_of_day(ts1)) / 86400))

    @staticmethod
    def add_days(timestamp: float, days: int) -> float:
        return timestamp + days * 86400

    @staticmethod
    def add_hours(timestamp: float, hours: int) -> float:
        return timestamp + hours * 3600

    @staticmethod
    def add_minutes(timestamp: float, minutes: int) -> float:
        return timestamp + minutes * 60

    @staticmethod
    def get_age(birth_date: str, format: str = "%Y-%m-%d") -> int:
        birth = datetime.datetime.strptime(birth_date, format)
        today = datetime.datetime.now()
        age = today.year - birth.year
        if (today.month, today.day) < (birth.month, birth.day):
            age -= 1
        return age

    @staticmethod
    def countdown(target_timestamp: float) -> Dict[str, Any]:
        remaining = target_timestamp - time.time()
        if remaining <= 0:
            return {"expired": True, "remaining": 0}
        return {
            "expired": False,
            "remaining": remaining,
            "formatted": TimeUtils.format_duration(remaining),
            "days": int(remaining // 86400),
            "hours": int((remaining % 86400) // 3600),
            "minutes": int((remaining % 3600) // 60),
            "seconds": int(remaining % 60),
        }
