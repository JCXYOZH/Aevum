"""
core/diary.py - 生日记时系统

记录重要日期、生日、纪念日、倒计时、年龄计算、周期性提醒。
"""
import os
import json
import time
import uuid
import threading
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


# ================================================================
# 事件类型
# ================================================================
class DiaryEventType(Enum):
    BIRTHDAY = "birthday"
    ANNIVERSARY = "anniversary"
    COUNTDOWN = "countdown"
    REMINDER = "reminder"
    HOLIDAY = "holiday"
    CUSTOM = "custom"


# ================================================================
# 重复频率
# ================================================================
class RepeatFrequency(Enum):
    NONE = "none"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


# ================================================================
# 日记事件
# ================================================================
class DiaryEvent:
    """日记事件"""

    def __init__(self, title: str = "", event_type: str = "custom",
                 date: str = "",  # YYYY-MM-DD
                 time_str: str = "00:00",
                 description: str = "",
                 repeat: str = "none",
                 remind_days_before: List[int] = None,
                 tags: Optional[List[str]] = None,
                 importance: int = 3,  # 1-5
                 person_name: str = "",
                 birth_year: int = 0):
        self.event_id = f"diary_{uuid.uuid4().hex[:8]}"
        self.title = title
        self.event_type = event_type
        self.date = date
        self.time_str = time_str
        self.description = description
        self.repeat = repeat
        self.remind_days_before = remind_days_before or [0, 1, 7]
        self.tags = tags or []
        self.importance = importance
        self.person_name = person_name
        self.birth_year = birth_year
        self.created_at = time.time()
        self.updated_at = time.time()
        self.last_reminded = 0.0
        self.completed = False
        self.completed_at = 0.0
        self.notes: List[Dict[str, Any]] = []

    def get_datetime(self) -> Optional[datetime]:
        try:
            return datetime.strptime(f"{self.date} {self.time_str}", "%Y-%m-%d %H:%M")
        except (ValueError, TypeError):
            return None

    def get_next_occurrence(self, from_date: Optional[datetime] = None) -> Optional[datetime]:
        """获取下一次发生时间"""
        from_date = from_date or datetime.now()
        event_dt = self.get_datetime()
        if not event_dt:
            return None

        if self.repeat == "none":
            return event_dt if event_dt > from_date else None
        elif self.repeat == "yearly":
            next_dt = event_dt.replace(year=from_date.year)
            if next_dt < from_date:
                next_dt = next_dt.replace(year=from_date.year + 1)
            return next_dt
        elif self.repeat == "monthly":
            next_dt = event_dt.replace(year=from_date.year, month=from_date.month)
            if next_dt < from_date:
                if from_date.month == 12:
                    next_dt = next_dt.replace(year=from_date.year + 1, month=1)
                else:
                    next_dt = next_dt.replace(month=from_date.month + 1)
            return next_dt
        elif self.repeat == "weekly":
            days_ahead = (event_dt.weekday() - from_date.weekday()) % 7
            next_dt = (from_date + timedelta(days=days_ahead)).replace(
                hour=event_dt.hour, minute=event_dt.minute
            )
            if next_dt < from_date:
                next_dt += timedelta(weeks=1)
            return next_dt
        elif self.repeat == "daily":
            next_dt = from_date.replace(hour=event_dt.hour, minute=event_dt.minute)
            if next_dt < from_date:
                next_dt += timedelta(days=1)
            return next_dt
        return None

    def get_days_until(self) -> Optional[int]:
        """获取距离下一次发生的天数"""
        next_occ = self.get_next_occurrence()
        if not next_occ:
            return None
        return (next_occ.date() - datetime.now().date()).days

    def get_age(self) -> Optional[int]:
        """获取年龄（仅生日事件）"""
        if self.event_type != "birthday" or not self.birth_year:
            return None
        today = datetime.now()
        birth_date = self.get_datetime()
        if not birth_date:
            return None
        age = today.year - birth_date.year
        if (today.month, today.day) < (birth_date.month, birth_date.day):
            age -= 1
        return age

    def add_note(self, content: str, author: str = ""):
        self.notes.append({
            "note_id": f"note_{uuid.uuid4().hex[:6]}",
            "content": content,
            "author": author,
            "timestamp": time.time(),
        })
        self.updated_at = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_id": self.event_id,
            "title": self.title,
            "event_type": self.event_type,
            "date": self.date,
            "time_str": self.time_str,
            "description": self.description,
            "repeat": self.repeat,
            "remind_days_before": self.remind_days_before,
            "tags": self.tags,
            "importance": self.importance,
            "person_name": self.person_name,
            "birth_year": self.birth_year,
            "created_at": self.created_at,
            "completed": self.completed,
            "notes": self.notes,
            "days_until": self.get_days_until(),
            "age": self.get_age(),
        }


# ================================================================
# 日记管理器
# ================================================================
class DiaryManager:
    """生日记时系统"""

    def __init__(self, data_dir: str = "", memory_system=None, user_manager=None):
        # 智能识别：如果第一个参数是 MemorySystem 对象，则调整参数映射
        if not isinstance(data_dir, str) and data_dir is not None:
            # 调用方式: DiaryManager(memory_system, user_manager)
            user_manager = memory_system
            memory_system = data_dir
            data_dir = ""
        self.data_dir = data_dir or os.path.join(get_data_dir(), "diary")
        self.memory_system = memory_system
        self.user_manager = user_manager
        os.makedirs(self.data_dir, exist_ok=True)
        self._events: Dict[str, DiaryEvent] = {}
        self._lock = threading.RLock()
        self._reminder_callbacks: List[Any] = []
        self._load()
        self._init_holidays()

    def _init_holidays(self):
        """初始化常见节日"""
        holidays = [
            ("元旦", "01-01", "holiday"),
            ("情人节", "02-14", "holiday"),
            ("妇女节", "03-08", "holiday"),
            ("劳动节", "05-01", "holiday"),
            ("儿童节", "06-01", "holiday"),
            ("建党节", "07-01", "holiday"),
            ("建军节", "08-01", "holiday"),
            ("国庆节", "10-01", "holiday"),
            ("平安夜", "12-24", "holiday"),
            ("圣诞节", "12-25", "holiday"),
        ]
        current_year = datetime.now().year
        for name, date_str, etype in holidays:
            full_date = f"{current_year}-{date_str}"
            exists = any(e.title == name and e.date == full_date for e in self._events.values())
            if not exists:
                event = DiaryEvent(title=name, event_type=etype, date=full_date,
                                  repeat="yearly", importance=2)
                self._events[event.event_id] = event

    def _load(self):
        events_file = os.path.join(self.data_dir, "diary_events.json")
        try:
            if os.path.exists(events_file):
                with open(events_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for e_data in data.get("events", []):
                    event = DiaryEvent(
                        title=e_data.get("title", ""),
                        event_type=e_data.get("event_type", "custom"),
                        date=e_data.get("date", ""),
                        time_str=e_data.get("time_str", "00:00"),
                        description=e_data.get("description", ""),
                        repeat=e_data.get("repeat", "none"),
                        remind_days_before=e_data.get("remind_days_before", [0, 1, 7]),
                        tags=e_data.get("tags", []),
                        importance=e_data.get("importance", 3),
                        person_name=e_data.get("person_name", ""),
                        birth_year=e_data.get("birth_year", 0),
                    )
                    event.event_id = e_data.get("event_id", event.event_id)
                    event.completed = e_data.get("completed", False)
                    event.notes = e_data.get("notes", [])
                    self._events[event.event_id] = event
        except Exception as e:
            terminal.warn(f"加载日记事件失败: {e}", "diary")

    def _save(self):
        events_file = os.path.join(self.data_dir, "diary_events.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                "events": [e.to_dict() for e in self._events.values()],
            }
            with open(events_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def add_event(self, title: str, date: str, event_type: str = "custom",
                  **kwargs) -> DiaryEvent:
        event = DiaryEvent(title=title, date=date, event_type=event_type, **kwargs)
        with self._lock:
            self._events[event.event_id] = event
            self._save()
        terminal.info(f"添加日记事件: {title} ({date})", "diary")
        return event

    def add_birthday(self, person_name: str, birth_date: str,
                     description: str = "") -> DiaryEvent:
        """添加生日"""
        try:
            birth_dt = datetime.strptime(birth_date, "%Y-%m-%d")
            birth_year = birth_dt.year
        except ValueError:
            birth_year = 0
        event = DiaryEvent(
            title=f"{person_name}的生日",
            event_type="birthday",
            date=birth_date,
            repeat="yearly",
            description=description,
            person_name=person_name,
            birth_year=birth_year,
            importance=4,
            remind_days_before=[0, 1, 3, 7],
        )
        with self._lock:
            self._events[event.event_id] = event
            self._save()
        terminal.info(f"添加生日: {person_name} ({birth_date})", "diary")
        return event

    def add_anniversary(self, title: str, date: str,
                        description: str = "") -> DiaryEvent:
        """添加纪念日"""
        event = DiaryEvent(
            title=title, event_type="anniversary",
            date=date, repeat="yearly",
            description=description, importance=4,
            remind_days_before=[0, 1, 7],
        )
        with self._lock:
            self._events[event.event_id] = event
            self._save()
        return event

    def add_countdown(self, title: str, target_date: str,
                      description: str = "") -> DiaryEvent:
        """添加倒计时"""
        event = DiaryEvent(
            title=title, event_type="countdown",
            date=target_date, repeat="none",
            description=description, importance=3,
        )
        with self._lock:
            self._events[event.event_id] = event
            self._save()
        return event

    def remove_event(self, event_id: str) -> bool:
        with self._lock:
            if event_id in self._events:
                del self._events[event_id]
                self._save()
                return True
            return False

    def get_event(self, event_id: str) -> Optional[DiaryEvent]:
        return self._events.get(event_id)

    def list_events(self, event_type: str = "", tag: str = "",
                    upcoming_only: bool = False,
                    limit: int = 50) -> List[DiaryEvent]:
        events = list(self._events.values())
        if event_type:
            events = [e for e in events if e.event_type == event_type]
        if tag:
            events = [e for e in events if tag in e.tags]
        if upcoming_only:
            events = [e for e in events if e.get_days_until() is not None and e.get_days_until() >= 0]
        # 按下次发生时间排序
        def sort_key(e):
            next_occ = e.get_next_occurrence()
            return next_occ.timestamp() if next_occ else float("inf")
        events.sort(key=sort_key)
        return events[:limit]

    def get_upcoming(self, days: int = 30) -> List[DiaryEvent]:
        """获取未来N天内的事件"""
        upcoming = []
        for event in self._events.values():
            days_until = event.get_days_until()
            if days_until is not None and 0 <= days_until <= days:
                upcoming.append(event)
        upcoming.sort(key=lambda e: e.get_days_until() or 0)
        return upcoming

    def get_today_events(self) -> List[DiaryEvent]:
        """获取今天的事件"""
        today = datetime.now().strftime("%Y-%m-%d")
        today_events = []
        for event in self._events.values():
            next_occ = event.get_next_occurrence()
            if next_occ and next_occ.strftime("%Y-%m-%d") == today:
                today_events.append(event)
        return today_events

    def get_birthdays(self) -> List[DiaryEvent]:
        return [e for e in self._events.values() if e.event_type == "birthday"]

    def get_age_summary(self) -> List[Dict[str, Any]]:
        """获取年龄汇总"""
        summary = []
        for event in self.get_birthdays():
            age = event.get_age()
            if age is not None:
                summary.append({
                    "name": event.person_name or event.title,
                    "birth_date": event.date,
                    "age": age,
                    "days_until_birthday": event.get_days_until(),
                    "next_age": age + 1 if event.get_days_until() and event.get_days_until() > 0 else age,
                })
        summary.sort(key=lambda x: x["days_until_birthday"] or 365)
        return summary

    def complete_event(self, event_id: str) -> bool:
        event = self._events.get(event_id)
        if event:
            event.completed = True
            event.completed_at = time.time()
            event.updated_at = time.time()
            self._save()
            return True
        return False

    def add_note(self, event_id: str, content: str, author: str = "") -> bool:
        event = self._events.get(event_id)
        if event:
            event.add_note(content, author)
            self._save()
            return True
        return False

    def check_reminders(self) -> List[DiaryEvent]:
        """检查需要提醒的事件"""
        reminders = []
        now = time.time()
        for event in self._events.values():
            days_until = event.get_days_until()
            if days_until is None:
                continue
            if days_until in event.remind_days_before:
                # 检查今天是否已经提醒过
                today = datetime.now().strftime("%Y-%m-%d")
                last_reminded_day = datetime.fromtimestamp(event.last_reminded).strftime("%Y-%m-%d") if event.last_reminded else ""
                if last_reminded_day != today:
                    reminders.append(event)
                    event.last_reminded = now
        if reminders:
            self._save()
            for callback in self._reminder_callbacks:
                try:
                    callback(reminders)
                except Exception:
                    pass
        return reminders

    def on_reminder(self, callback: Any):
        self._reminder_callbacks.append(callback)

    def generate_calendar(self, year: int, month: int) -> Dict[str, Any]:
        """生成月历"""
        import calendar
        cal = calendar.monthcalendar(year, month)
        events_by_day = {}
        for event in self._events.values():
            next_occ = event.get_next_occurrence()
            if next_occ and next_occ.year == year and next_occ.month == month:
                day = next_occ.day
                events_by_day.setdefault(day, []).append({
                    "title": event.title,
                    "type": event.event_type,
                    "time": event.time_str,
                    "importance": event.importance,
                })
        return {
            "year": year, "month": month,
            "calendar": cal,
            "events": events_by_day,
        }

    def get_stats(self) -> Dict[str, Any]:
        by_type = {}
        for event in self._events.values():
            by_type[event.event_type] = by_type.get(event.event_type, 0) + 1
        upcoming = self.get_upcoming(30)
        today = self.get_today_events()
        return {
            "total_events": len(self._events),
            "by_type": by_type,
            "birthdays": len(self.get_birthdays()),
            "upcoming_30d": len(upcoming),
            "today": len(today),
            "completed": sum(1 for e in self._events.values() if e.completed),
        }


# 全局日记管理器
_diary_manager = DiaryManager()


def get_diary_manager() -> DiaryManager:
    return _diary_manager


def add_birthday(person_name: str, birth_date: str, **kwargs) -> DiaryEvent:
    return _diary_manager.add_birthday(person_name, birth_date, **kwargs)


# 向后兼容：旧版类名别名
TheDiarySystem = DiaryManager
