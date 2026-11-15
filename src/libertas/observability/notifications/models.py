"""通知级别与数据模型。"""

import time
import uuid
from typing import Any, Dict, List, Optional

class NotificationLevel:
    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"

class Notification:
    """通知对象"""

    def __init__(self, title: str, message: str = "", level: str = "info",
                 source: str = "", category: str = "general",
                 channels: Optional[List[str]] = None,
                 metadata: Optional[Dict[str, Any]] = None):
        self.id = f"notif_{uuid.uuid4().hex[:8]}"
        self.title = title
        self.message = message
        self.level = level
        self.source = source
        self.category = category
        self.channels = channels or []
        self.metadata = metadata or {}
        self.timestamp = time.time()
        self.time = datetime.fromtimestamp(self.timestamp).strftime("%Y-%m-%d %H:%M:%S")
        self.read = False
        self.delivered_channels: List[str] = []
        self.failed_channels: List[str] = []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id, "title": self.title, "message": self.message,
            "level": self.level, "source": self.source, "category": self.category,
            "channels": self.channels, "metadata": self.metadata,
            "timestamp": self.timestamp, "time": self.time, "read": self.read,
            "delivered_channels": self.delivered_channels,
            "failed_channels": self.failed_channels,
        }
