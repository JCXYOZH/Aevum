"""通知中心。"""

import json
import os
import queue
import threading
import time
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal
from .models import Notification, NotificationLevel
from .channels import (
    NotificationChannel, ConsoleChannel, DesktopChannel, WebhookChannel,
    EmailChannel, FeishuChannel, SoundChannel,
)

class NotificationCenter:
    """通知中心"""

    LEVEL_ORDER = {"info": 0, "success": 1, "warning": 2, "error": 3, "critical": 4}

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "notifications")
        os.makedirs(self.data_dir, exist_ok=True)
        self._channels: Dict[str, NotificationChannel] = {}
        self._history: List[Notification] = []
        self._max_history = 1000
        self._lock = threading.RLock()
        self._queue: "queue.Queue[Optional[Notification]]" = queue.Queue(maxsize=5000)
        self._worker_thread: Optional[threading.Thread] = None
        self._running = False
        self._preferences: Dict[str, Any] = {
            "do_not_disturb": False,
            "dnd_start": "22:00",
            "dnd_end": "08:00",
            "min_level": "info",
            "aggregate_similar": True,
            "aggregate_window": 60,
        }
        self._aggregation_cache: Dict[str, List[Notification]] = {}
        self._init_default_channels()
        self._load_history()

    def _init_default_channels(self):
        self.register_channel(ConsoleChannel())
        self.register_channel(DesktopChannel())
        self.register_channel(WebhookChannel())
        self.register_channel(EmailChannel())
        self.register_channel(FeishuChannel())
        self.register_channel(SoundChannel())

    def register_channel(self, channel: NotificationChannel):
        with self._lock:
            self._channels[channel.name] = channel

    def get_channel(self, name: str) -> Optional[NotificationChannel]:
        return self._channels.get(name)

    def configure_channel(self, name: str, **kwargs) -> bool:
        channel = self._channels.get(name)
        if not channel:
            return False
        for k, v in kwargs.items():
            if hasattr(channel, k):
                setattr(channel, k, v)
        if "enabled" in kwargs:
            channel.enabled = kwargs["enabled"]
        return True

    def set_preference(self, key: str, value: Any):
        self._preferences[key] = value

    def get_preferences(self) -> Dict[str, Any]:
        return dict(self._preferences)

    def _is_dnd_time(self) -> bool:
        if not self._preferences.get("do_not_disturb", False):
            return False
        now = datetime.now().strftime("%H:%M")
        dnd_start = self._preferences.get("dnd_start", "22:00")
        dnd_end = self._preferences.get("dnd_end", "08:00")
        if dnd_start <= dnd_end:
            return dnd_start <= now <= dnd_end
        else:
            return now >= dnd_start or now <= dnd_end

    def notify(self, title: str, message: str = "", level: str = "info",
               source: str = "", category: str = "general",
               channels: Optional[List[str]] = None,
               metadata: Optional[Dict[str, Any]] = None) -> str:
        """发送通知"""
        notification = Notification(
            title=title, message=message, level=level, source=source,
            category=category, channels=channels or [], metadata=metadata or {},
        )

        # 检查最小级别
        min_level = self._preferences.get("min_level", "info")
        if self.LEVEL_ORDER.get(level, 0) < self.LEVEL_ORDER.get(min_level, 0):
            return notification.id

        # 免打扰
        if self._is_dnd_time() and level not in ("critical", "error"):
            with self._lock:
                self._history.append(notification)
            return notification.id

        # 聚合相似通知
        if self._preferences.get("aggregate_similar", True):
            agg_key = f"{level}:{title}:{category}"
            now = time.time()
            window = self._preferences.get("aggregate_window", 60)
            if agg_key in self._aggregation_cache:
                recent = [n for n in self._aggregation_cache[agg_key] if now - n.timestamp < window]
                if recent:
                    # 合并到最近的通知
                    recent[0].metadata["aggregate_count"] = recent[0].metadata.get("aggregate_count", 1) + 1
                    return recent[0].id
                self._aggregation_cache[agg_key] = []
            self._aggregation_cache.setdefault(agg_key, []).append(notification)

        # 异步发送
        try:
            self._queue.put(notification, block=False)
        except queue.Full:
            self._send_sync(notification)

        with self._lock:
            self._history.append(notification)
            if len(self._history) > self._max_history:
                self._history = self._history[-self._max_history:]

        return notification.id

    def _send_sync(self, notification: Notification):
        """同步发送通知"""
        target_channels = notification.channels or list(self._channels.keys())
        for ch_name in target_channels:
            channel = self._channels.get(ch_name)
            if channel and channel.enabled:
                if self.LEVEL_ORDER.get(notification.level, 0) >= self.LEVEL_ORDER.get(channel.min_level, 0):
                    success = channel.send(notification)
                    if success:
                        notification.delivered_channels.append(ch_name)
                    else:
                        notification.failed_channels.append(ch_name)

    def start_worker(self):
        """启动异步发送工作线程"""
        if self._running:
            return
        self._running = True
        self._worker_thread = threading.Thread(
            target=self._worker_loop, daemon=True, name="NotificationWorker"
        )
        self._worker_thread.start()

    def stop_worker(self):
        self._running = False
        if self._worker_thread:
            self._queue.put(None)
            self._worker_thread.join(timeout=5)

    def _worker_loop(self):
        while self._running:
            try:
                notification = self._queue.get(timeout=1.0)
                if notification is None:
                    break
                self._send_sync(notification)
                self._queue.task_done()
            except queue.Empty:
                continue
            except Exception as e:
                terminal.error(f"通知发送异常: {e}", "notifications")

    def get_history(self, level: str = "", category: str = "",
                    unread_only: bool = False, limit: int = 50) -> List[Dict[str, Any]]:
        with self._lock:
            history = list(reversed(self._history))
        if level:
            history = [n for n in history if n.level == level]
        if category:
            history = [n for n in history if n.category == category]
        if unread_only:
            history = [n for n in history if not n.read]
        return [n.to_dict() for n in history[:limit]]

    def mark_read(self, notification_id: str) -> bool:
        for n in self._history:
            if n.id == notification_id:
                n.read = True
                return True
        return False

    def mark_all_read(self):
        with self._lock:
            for n in self._history:
                n.read = True

    def get_unread_count(self) -> int:
        return sum(1 for n in self._history if not n.read)

    def clear_history(self, older_than_days: int = 0):
        with self._lock:
            if older_than_days > 0:
                cutoff = time.time() - older_than_days * 86400
                self._history = [n for n in self._history if n.timestamp >= cutoff]
            else:
                self._history.clear()

    def _load_history(self):
        try:
            history_file = os.path.join(self.data_dir, "history.json")
            if os.path.exists(history_file):
                with open(history_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for item in data.get("notifications", [])[-500:]:
                    n = Notification(
                        title=item.get("title", ""), message=item.get("message", ""),
                        level=item.get("level", "info"), source=item.get("source", ""),
                        category=item.get("category", "general"),
                    )
                    n.id = item.get("id", n.id)
                    n.timestamp = item.get("timestamp", n.timestamp)
                    n.read = item.get("read", False)
                    self._history.append(n)
        except Exception:
            pass

    def _save_history(self):
        try:
            history_file = os.path.join(self.data_dir, "history.json")
            data = {
                "version": "1.0",
                "updated_at": time.time(),
                "notifications": [n.to_dict() for n in self._history[-500:]],
            }
            with open(history_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def get_stats(self) -> Dict[str, Any]:
        by_level = {}
        by_category = {}
        for n in self._history:
            by_level[n.level] = by_level.get(n.level, 0) + 1
            by_category[n.category] = by_category.get(n.category, 0) + 1

        return {
            "total": len(self._history),
            "unread": self.get_unread_count(),
            "by_level": by_level,
            "by_category": by_category,
            "channels": {name: ch.get_stats() for name, ch in self._channels.items()},
            "preferences": self._preferences,
            "worker_running": self._running,
        }
