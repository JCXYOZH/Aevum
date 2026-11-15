"""广域网通信模块公共入口。"""

import threading
from typing import Optional

from .base import *
from .room import RoomMixin
from .lifecycle import LifecycleMixin
from .handlers import HandlersMixin
from .messaging import MessagingMixin
from .mqtt import MQTTClient


class WANShare(RoomMixin, LifecycleMixin, HandlersMixin, MessagingMixin):
    """广域网房间共享：消息、文件与节点状态通过 MQTT 中继。"""


_wan_share_instance = None
_wan_share_lock = threading.Lock()


def get_wan_share() -> Optional["WANShare"]:
    global _wan_share_instance
    if _wan_share_instance is None:
        with _wan_share_lock:
            if _wan_share_instance is None:
                _wan_share_instance = WANShare()
    return _wan_share_instance
