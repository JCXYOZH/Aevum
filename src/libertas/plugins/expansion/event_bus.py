"""插件扩展基础设施: 插件通信总线。"""

from __future__ import annotations

import os
import sys
import json
import time
import uuid
import math
import hashlib
import threading
import importlib
import importlib.util
import traceback
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter, defaultdict
from enum import Enum

from libertas.foundation.config import get_data_dir
from libertas.foundation.byte_stream import safe_decode
from libertas.foundation.terminal import terminal

from .state import PluginState
from .plugin_type import PluginType
from .manifest import PluginManifest
from .instance import PluginInstance



class PluginEventBus:
    """插件通信总线"""

    def __init__(self):
        self.bus_id = f"bus_{uuid.uuid4().hex[:8]}"
        self.subscribers: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        self.event_history: deque = deque(maxlen=1000)
        self._lock = threading.RLock()

    def subscribe(self, event: str, callback: Callable,
                  plugin_id: str = "", priority: int = 0) -> str:
        subscription_id = f"sub_{uuid.uuid4().hex[:6]}"
        subscriber = {
            "subscription_id": subscription_id,
            "event": event,
            "callback": callback,
            "plugin_id": plugin_id,
            "priority": priority,
            "created_at": time.time(),
            "call_count": 0,
        }
        with self._lock:
            self.subscribers[event].append(subscriber)
            self.subscribers[event].sort(key=lambda s: s["priority"], reverse=True)
        return subscription_id

    def unsubscribe(self, subscription_id: str) -> bool:
        with self._lock:
            for event, subs in self.subscribers.items():
                for sub in subs:
                    if sub["subscription_id"] == subscription_id:
                        subs.remove(sub)
                        return True
        return False

    def publish(self, event: str, data: Optional[Dict] = None,
                sender: str = "") -> Dict[str, Any]:
        """发布事件"""
        event_id = f"evt_{uuid.uuid4().hex[:8]}"
        event_data = data or {}
        result = {
            "event_id": event_id,
            "event": event,
            "sender": sender,
            "data": event_data,
            "timestamp": time.time(),
            "subscribers_notified": 0,
            "results": [],
            "errors": [],
        }

        with self._lock:
            subscribers = list(self.subscribers.get(event, []))
            # 也通知通配符订阅者
            subscribers.extend(self.subscribers.get("*", []))

        for subscriber in subscribers:
            try:
                subscriber["call_count"] += 1
                callback_result = subscriber["callback"](event, event_data, sender)
                result["results"].append({
                    "subscription_id": subscriber["subscription_id"],
                    "plugin_id": subscriber["plugin_id"],
                    "result": callback_result,
                })
                result["subscribers_notified"] += 1
            except Exception as e:
                result["errors"].append({
                    "subscription_id": subscriber["subscription_id"],
                    "plugin_id": subscriber["plugin_id"],
                    "error": str(e),
                })

        with self._lock:
            self.event_history.append(result)

        return result

    def get_event_history(self, event: str = "", limit: int = 50) -> List[Dict]:
        history = list(reversed(self.event_history))
        if event:
            history = [h for h in history if h["event"] == event]
        return history[:limit]

    def list_subscribers(self, event: str = "") -> List[Dict]:
        if event:
            return [dict(s) for s in self.subscribers.get(event, [])]
        all_subs = []
        for event, subs in self.subscribers.items():
            for sub in subs:
                item = dict(sub)
                item["event"] = event
                all_subs.append(item)
        return all_subs

    def get_stats(self) -> Dict[str, Any]:
        total_subs = sum(len(subs) for subs in self.subscribers.values())
        return {
            "bus_id": self.bus_id,
            "event_types": len(self.subscribers),
            "total_subscribers": total_subs,
            "total_events_published": len(self.event_history),
            "avg_subscribers_per_event": round(total_subs / max(len(self.subscribers), 1), 2),
        }
