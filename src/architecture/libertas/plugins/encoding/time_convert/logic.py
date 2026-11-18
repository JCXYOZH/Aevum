"""Unix时间戳与日期互转，支持多种格式、时区转换、时间差计算、Cron表达式解析实现。"""

import datetime

import time

import re

DATE_FORMATS = [
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M:%SZ",
    "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%dT%H:%M:%S.%fZ",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
    "%Y/%m/%d %H:%M:%S",
    "%Y/%m/%d %H:%M",
    "%Y/%m/%d",
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y",
    "%m/%d/%Y %H:%M:%S",
    "%m/%d/%Y",
    "%d-%m-%Y %H:%M:%S",
    "%d-%m-%Y",
    "%Y%m%d%H%M%S",
    "%Y%m%d",
    "%H:%M:%S",
    "%H:%M",
]

def _parse_date(value):
    """尝试多种格式解析日期"""
    value = value.strip()
    # 先尝试ISO格式
    try:
        dt = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt, "ISO 8601"
    except Exception:
        pass
    # 尝试RFC2822格式
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(value)
        return dt, "RFC 2822"
    except Exception:
        pass
    # 尝试HTTP日期格式
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(value)
        return dt, "HTTP Date"
    except Exception:
        pass
    # 尝试预定义格式
    for fmt in DATE_FORMATS:
        try:
            dt = datetime.datetime.strptime(value, fmt)
            return dt, fmt
        except ValueError:
            continue
    return None, None

def _format_all(dt, timezone_offset=0):
    """格式化所有时间表示"""
    # 应用时区偏移
    if timezone_offset != 0:
        dt = dt + datetime.timedelta(hours=timezone_offset)
    ts = dt.timestamp()
    return {
        "Unix时间戳(秒)": int(ts),
        "Unix时间戳(毫秒)": int(ts * 1000),
        "Unix时间戳(微秒)": int(ts * 1000000),
        "本地时间": dt.strftime("%Y-%m-%d %H:%M:%S"),
        "本地时间(带毫秒)": dt.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
        "UTC时间": dt.utcnow().strftime("%Y-%m-%d %H:%M:%S") if timezone_offset == 0 else (dt - datetime.timedelta(hours=timezone_offset)).strftime("%Y-%m-%d %H:%M:%S"),
        "ISO 8601": dt.isoformat(),
        "ISO 8601(UTC)": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "RFC 2822": dt.strftime("%a, %d %b %Y %H:%M:%S +0000"),
        "HTTP Date": dt.strftime("%a, %d %b %Y %H:%M:%S GMT"),
        "日期": dt.strftime("%Y-%m-%d"),
        "时间": dt.strftime("%H:%M:%S"),
        "星期": ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][dt.weekday()],
        "一年中的第几天": dt.timetuple().tm_yday,
        "一年中的第几周": dt.isocalendar()[1],
        "季度": (dt.month - 1) // 3 + 1,
        "是否闰年": dt.year % 4 == 0 and (dt.year % 100 != 0 or dt.year % 400 == 0),
    }

def _relative_time(ts):
    """计算相对时间"""
    now = time.time()
    diff = now - ts
    if diff < 0:
        abs_diff = abs(diff)
        if abs_diff < 60:
            return f"未来 {int(abs_diff)} 秒后"
        if abs_diff < 3600:
            return f"未来 {int(abs_diff/60)} 分钟后"
        if abs_diff < 86400:
            return f"未来 {int(abs_diff/3600)} 小时后"
        if abs_diff < 2592000:
            return f"未来 {int(abs_diff/86400)} 天后"
        if abs_diff < 31536000:
            return f"未来 {int(abs_diff/2592000)} 个月后"
        return f"未来 {int(abs_diff/31536000)} 年后"
    if diff < 60:
        return f"{int(diff)} 秒前"
    if diff < 3600:
        return f"{int(diff/60)} 分钟前"
    if diff < 86400:
        return f"{int(diff/3600)} 小时前"
    if diff < 2592000:
        return f"{int(diff/86400)} 天前"
    if diff < 31536000:
        return f"{int(diff/2592000)} 个月前"
    return f"{int(diff/31536000)} 年前"

def _parse_cron(expr):
    """简单解析Cron表达式"""
    parts = expr.strip().split()
    if len(parts) < 5:
        return None, "Cron表达式需要至少5个字段（分 时 日 月 周）"
    minute, hour, day, month, weekday = parts[:5]
    # 简单验证
    fields = {
        "分钟": minute,
        "小时": hour,
        "日": day,
        "月": month,
        "星期": weekday,
    }
    if len(parts) >= 6:
        fields["年"] = parts[5]
    # 计算下次执行时间（简单估算）
    desc = f"每"
    if minute != "*":
        desc += f"第{minute}分钟"
    else:
        desc += "分钟"
    if hour != "*":
        desc += f" {hour}点"
    if day != "*":
        desc += f" {day}日"
    if month != "*":
        desc += f" {month}月"
    if weekday != "*":
        desc += f" 星期{weekday}"
    desc += "执行"
    return fields, desc

def time_convert(value: str = "", mode: str = "auto", value2: str = "", timezone: str = "") -> dict:
    """时间转换"""
    # 解析时区偏移
    tz_offset = 0
    if timezone:
        tz_match = re.match(r'([+-]?)(\d{1,2})(?::(\d{2}))?', timezone.strip())
        if tz_match:
            sign = 1 if tz_match.group(1) != "-" else -1
            hours = int(tz_match.group(2))
            minutes = int(tz_match.group(3) or 0)
            tz_offset = sign * (hours + minutes / 60)
    # now模式：返回当前时间
    if mode == "now" or not value:
        now = datetime.datetime.now()
        result = _format_all(now, tz_offset)
        result["相对时间"] = "现在"
        return {"success": True, "result": result}
    try:
        value = value.strip()
        mode = mode.lower().strip()
        # diff模式：计算时间差
        if mode == "diff":
            if not value2:
                return {"success": False, "error": "diff模式需要第二个时间(value2)"}
            dt1, fmt1 = _parse_date(value)
            dt2, fmt2 = _parse_date(value2)
            if not dt1:
                # 尝试作为时间戳
                if value.isdigit():
                    ts = int(value)
                    if ts > 1e12:
                        ts /= 1000
                    dt1 = datetime.datetime.fromtimestamp(ts)
                    fmt1 = "Unix时间戳"
            if not dt2:
                if value2.isdigit():
                    ts2 = int(value2)
                    if ts2 > 1e12:
                        ts2 /= 1000
                    dt2 = datetime.datetime.fromtimestamp(ts2)
                    fmt2 = "Unix时间戳"
            if not dt1 or not dt2:
                return {"success": False, "error": f"无法解析时间: {value if not dt1 else value2}"}
            diff = dt2 - dt1
            total_seconds = abs(diff.total_seconds())
            return {
                "success": True,
                "result": {
                    "时间1": value,
                    "时间1格式": fmt1,
                    "时间2": value2,
                    "时间2格式": fmt2,
                    "时间差": str(diff),
                    "总秒数": int(total_seconds),
                    "总分钟数": round(total_seconds / 60, 2),
                    "总小时数": round(total_seconds / 3600, 2),
                    "总天数": round(total_seconds / 86400, 2),
                    "方向": "时间2在时间1之后" if diff.total_seconds() > 0 else "时间2在时间1之前",
                }
            }
        # cron模式：解析Cron表达式
        if mode == "cron":
            fields, desc = _parse_cron(value)
            if fields:
                return {"success": True, "result": {"Cron表达式": value, "字段": fields, "描述": desc}}
            else:
                return {"success": False, "error": desc}
        # auto模式：自动判断输入类型
        if mode == "auto":
            if value.isdigit():
                mode = "timestamp"
            else:
                mode = "date"
        # timestamp模式：时间戳转日期
        if mode == "timestamp":
            ts = int(value)
            # 毫秒时间戳
            is_ms = ts > 1e12
            if is_ms:
                ts = ts / 1000
            dt = datetime.datetime.fromtimestamp(ts)
            result = _format_all(dt, tz_offset)
            result["输入时间戳"] = value
            result["时间戳类型"] = "毫秒" if is_ms else "秒"
            result["相对时间"] = _relative_time(ts)
            return {"success": True, "result": result}
        # date模式：日期转时间戳
        if mode == "date":
            dt, fmt = _parse_date(value)
            if not dt:
                return {"success": False, "error": f"无法解析日期: {value}",
                        "支持的格式": [f for f in DATE_FORMATS[:10]]}
            result = _format_all(dt, tz_offset)
            result["输入日期"] = value
            result["识别格式"] = fmt
            result["相对时间"] = _relative_time(dt.timestamp())
            return {"success": True, "result": result}
        return {"success": False, "error": f"未知模式: {mode}",
                "支持的模式": ["auto", "timestamp", "date", "diff", "now", "cron"]}
    except Exception as e:
        return {"success": False, "error": str(e)}
