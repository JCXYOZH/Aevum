"""通知中心单例与模块级入口。"""

from .center import NotificationCenter
from .models import Notification

_notification_center = NotificationCenter()

def get_notification_center() -> NotificationCenter:
    return _notification_center

def notify(title: str, message: str = "", **kwargs) -> str:
    return _notification_center.notify(title, message, **kwargs)
