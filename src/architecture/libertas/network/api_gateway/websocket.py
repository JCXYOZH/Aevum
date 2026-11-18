"""API 网关职责：websocket。"""

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


@dataclass
class WSConnection:
    """WebSocket连接"""
    conn_id: str = ""
    user_id: str = ""
    rooms: List[str] = field(default_factory=list)
    connected_at: float = 0.0
    last_active: float = 0.0
    metadata: Dict = field(default_factory=dict)

    def __post_init__(self):
        if not self.conn_id:
            self.conn_id = f"ws_{uuid.uuid4().hex[:16]}"
        if not self.connected_at:
            self.connected_at = time.time()
            self.last_active = self.connected_at

class WebSocketManager:
    """WebSocket连接管理器

    管理实时通信连接，支持广播、房间、点对点消息。
    用于实时日志、扫描进度、Agent对话流式输出等。
    """

    def __init__(self):
        self.connections: Dict[str, WSConnection] = {}
        self.rooms: Dict[str, set] = defaultdict(set)
        self.message_handlers: Dict[str, Callable] = {}
        self._lock = threading.RLock()

    def connect(self, user_id: str = "", metadata: Dict = None) -> WSConnection:
        """建立连接"""
        conn = WSConnection(user_id=user_id, metadata=metadata or {})
        with self._lock:
            self.connections[conn.conn_id] = conn
        return conn

    def disconnect(self, conn_id: str):
        """断开连接"""
        with self._lock:
            conn = self.connections.pop(conn_id, None)
            if conn:
                for room in conn.rooms:
                    if room in self.rooms:
                        self.rooms[room].discard(conn_id)

    def join_room(self, conn_id: str, room: str):
        """加入房间"""
        with self._lock:
            if conn_id in self.connections:
                self.connections[conn_id].rooms.append(room)
                self.rooms[room].add(conn_id)

    def leave_room(self, conn_id: str, room: str):
        """离开房间"""
        with self._lock:
            if conn_id in self.connections:
                if room in self.connections[conn_id].rooms:
                    self.connections[conn_id].rooms.remove(room)
            if room in self.rooms:
                self.rooms[room].discard(conn_id)

    def send_to(self, conn_id: str, event: str, data: Any) -> bool:
        """发送消息到指定连接"""
        with self._lock:
            conn = self.connections.get(conn_id)
            if conn:
                conn.last_active = time.time()
                # 实际发送逻辑由WebSocket框架处理
                return True
        return False

    def broadcast(self, event: str, data: Any, exclude: List[str] = None):
        """广播到所有连接"""
        exclude = exclude or []
        with self._lock:
            for conn_id, conn in self.connections.items():
                if conn_id not in exclude:
                    conn.last_active = time.time()

    def broadcast_to_room(self, room: str, event: str, data: Any,
                           exclude: List[str] = None):
        """广播到指定房间"""
        exclude = exclude or []
        with self._lock:
            for conn_id in self.rooms.get(room, set()):
                if conn_id not in exclude:
                    if conn_id in self.connections:
                        self.connections[conn_id].last_active = time.time()

    def send_to_user(self, user_id: str, event: str, data: Any) -> int:
        """发送消息到指定用户的所有连接"""
        count = 0
        with self._lock:
            for conn_id, conn in self.connections.items():
                if conn.user_id == user_id:
                    conn.last_active = time.time()
                    count += 1
        return count

    def register_handler(self, event: str, handler: Callable):
        """注册消息处理器"""
        self.message_handlers[event] = handler

    def handle_message(self, conn_id: str, event: str, data: Any) -> Any:
        """处理收到的消息"""
        handler = self.message_handlers.get(event)
        if handler:
            return handler(conn_id, data)
        return None

    def get_room_members(self, room: str) -> List[str]:
        """获取房间成员"""
        with self._lock:
            return list(self.rooms.get(room, set()))

    def cleanup_stale(self, timeout: int = 300) -> int:
        """清理超时连接"""
        now = time.time()
        stale = []
        with self._lock:
            for conn_id, conn in self.connections.items():
                if now - conn.last_active > timeout:
                    stale.append(conn_id)
            for conn_id in stale:
                self.disconnect(conn_id)
        return len(stale)

    def get_stats(self) -> Dict:
        with self._lock:
            return {
                "total_connections": len(self.connections),
                "total_rooms": len(self.rooms),
                "registered_handlers": len(self.message_handlers),
                "connections_by_user": dict(Counter(
                    c.user_id for c in self.connections.values() if c.user_id
                )),
            }
