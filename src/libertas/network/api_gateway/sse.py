"""API 网关职责：sse。"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import threading
import time
import uuid
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse


class SSEManager:
    """Server-Sent Events管理器

    用于Agent对话流式输出、扫描进度实时推送等。
    比WebSocket更轻量，适合单向流式数据。
    """

    def __init__(self):
        self.streams: Dict[str, deque] = defaultdict(deque)
        self.stream_meta: Dict[str, Dict] = {}
        self._lock = threading.Lock()

    def create_stream(self, stream_id: str = None, metadata: Dict = None) -> str:
        """创建SSE流"""
        if not stream_id:
            stream_id = f"sse_{uuid.uuid4().hex[:16]}"
        with self._lock:
            self.streams[stream_id] = deque()
            self.stream_meta[stream_id] = {
                "created_at": time.time(),
                "status": "active",
                "metadata": metadata or {},
                "event_count": 0,
            }
        return stream_id

    def push_event(self, stream_id: str, event: str, data: Any,
                   event_id: str = None) -> bool:
        """推送事件到流"""
        with self._lock:
            if stream_id not in self.streams:
                return False
            if not event_id:
                event_id = str(self.stream_meta[stream_id]["event_count"])
            self.streams[stream_id].append({
                "id": event_id,
                "event": event,
                "data": data,
                "timestamp": time.time(),
            })
            self.stream_meta[stream_id]["event_count"] += 1
        return True

    def get_events(self, stream_id: str, last_id: str = None) -> List[Dict]:
        """获取流中的事件（非阻塞）"""
        with self._lock:
            if stream_id not in self.streams:
                return []
            events = list(self.streams[stream_id])
            if last_id:
                try:
                    idx = int(last_id)
                    events = events[idx + 1:]
                except (ValueError, IndexError):
                    pass
            return events

    def format_sse(self, event: Dict) -> str:
        """格式化为SSE协议格式"""
        lines = []
        if event.get("id"):
            lines.append(f"id: {event['id']}")
        if event.get("event"):
            lines.append(f"event: {event['event']}")
        data_str = json.dumps(event["data"], ensure_ascii=False, default=str)
        for line in data_str.split("\n"):
            lines.append(f"data: {line}")
        lines.append("")
        return "\n".join(lines)

    def close_stream(self, stream_id: str):
        """关闭流"""
        with self._lock:
            if stream_id in self.stream_meta:
                self.stream_meta[stream_id]["status"] = "closed"
                self.stream_meta[stream_id]["closed_at"] = time.time()

    def cleanup(self, max_age: int = 3600) -> int:
        """清理过期流"""
        now = time.time()
        removed = 0
        with self._lock:
            for stream_id in list(self.streams.keys()):
                meta = self.stream_meta.get(stream_id, {})
                if now - meta.get("created_at", now) > max_age:
                    del self.streams[stream_id]
                    self.stream_meta.pop(stream_id, None)
                    removed += 1
        return removed

    def get_stats(self) -> Dict:
        with self._lock:
            active = sum(1 for m in self.stream_meta.values() if m.get("status") == "active")
            return {
                "total_streams": len(self.streams),
                "active_streams": active,
                "total_events": sum(m.get("event_count", 0) for m in self.stream_meta.values()),
            }
