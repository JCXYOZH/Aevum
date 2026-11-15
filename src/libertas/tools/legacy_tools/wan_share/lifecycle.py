"""
广域网通信模块（MQTT 中继）
- 通过公共 MQTT  broker 中继消息，跨互联网通信
- 房间制：用户输入房间号+密码加入同一房间
- 消息加密：密码派生密钥，XOR 流加密 + Base64
- 支持文字消息和文件传输（base64编码，限制大小）
- 纯标准库实现，无外部依赖
"""
import os
import json
import time
import socket
import struct
import hashlib
import base64
import threading
import uuid
from typing import Dict, List, Optional, Callable
from datetime import datetime

from .base import *
from .crypto import _encode_msg


class LifecycleMixin:
    def update_display_name(self, nickname: Optional[str] = None, display_name: Optional[str] = None) -> bool:
        """更新昵称和显示名并重新广播presence"""
        if display_name is not None:
            self.display_name = display_name.strip()
        if nickname is not None:
            self.nickname = nickname.strip()
        elif not self.nickname:
            self.nickname = f"用户_{self.peer_id[:6]}"
        if self._running:
            self._send_presence("update")
        return True

    def disconnect(self):
        self._running = False
        if self.client:
            try:
                self._send_presence("leave")
                time.sleep(0.3)
            except Exception:
                pass
            self.client.disconnect()
            self.client = None
        with self._lock:
            self.peers.clear()
        self.system_rooms.clear()

    def is_connected(self) -> bool:
        return self._running and self.client is not None and self.client.connected

    def _send_presence(self, action: str, room_id: str = ""):
        msg = {
            "type": "presence",
            "action": action,
            "peer_id": self.peer_id,
            "nickname": self.nickname,
            "display_name": self.display_name or self.nickname,
            "role": self.role,
            "timestamp": datetime.now().strftime("%H:%M:%S"),
        }
        if room_id and room_id != self.room_id:
            # 发送到额外房间
            tb = self.joined_rooms.get(room_id)
            rk = self.room_keys.get(room_id, self.key)
            if tb:
                try:
                    self.client.publish(f"{tb}/presence", _encode_msg(msg, rk))
                except Exception:
                    pass
        else:
            self._publish("presence", msg)

    def _presence_loop(self):
        while self._running:
            time.sleep(self.PRESENCE_INTERVAL)
            if not self._running:
                break
            self._send_presence("ping")
            # 向所有额外房间也发送presence
            for rid in list(self.joined_rooms.keys()):
                self._send_presence("ping", rid)
            self._broadcast_global_stats()
            self._cleanup_peers()

    def _cleanup_peers(self):
        now = time.time()
        with self._lock:
            for pid, peer in list(self.peers.items()):
                if now - peer["last_seen"] > self.PEER_TIMEOUT:
                    del self.peers[pid]

    def _publish(self, subtopic: str, msg: dict):
        if not self.client or not self.client.connected:
            return
        topic = f"{self.topic_base}/{subtopic}"
        payload = _encode_msg(msg, self.key)
        try:
            self.client.publish(topic, payload)
        except Exception:
            pass

    def _on_disconnect(self):
        """连接断开时的回调：标记断开，后台自动重连"""
        was_running = self._running
        self._running = False
        if was_running and self.room_id and not getattr(self, '_reconnecting', False):
            self._reconnecting = True
            def _do_reconnect():
                import time as _t
                for attempt in range(5):
                    _t.sleep(min(3 * (attempt + 1), 15))
                    try:
                        result = self.connect_room(
                            self.room_id,
                            self._last_password or self.DEFAULT_ROOM_PASSWORD,
                            nickname=self.nickname,
                            display_name=self.display_name,
                            use_tls=True,
                        )
                        if result.get("success"):
                            self._reconnecting = False
                            return
                    except Exception:
                        pass
                self._reconnecting = False
            threading.Thread(target=_do_reconnect, daemon=True, name="wan-reconnect").start()
