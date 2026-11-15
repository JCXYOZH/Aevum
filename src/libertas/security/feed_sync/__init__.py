"""外部漏洞源同步公共入口。"""

from .models import Severity, Vulnerability, FeedSource
from .manager import FeedSyncManager
from .singleton import get_feed_sync_manager, get_feed_sync, sync_vulnerability_feeds

__all__ = [
    "Severity", "Vulnerability", "FeedSource", "FeedSyncManager",
    "get_feed_sync_manager", "get_feed_sync", "sync_vulnerability_feeds",
]
