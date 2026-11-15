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


class MessagingMixin:
    def send_message(self, text: str, room_id: str = "", target_peer_id: str = "") -> bool:
        if not self.is_connected():
            return False
        from .chat_security import has_permission
        if not has_permission(self.role, "can_send"):
            return False
        msg = {
            "type": "message",
            "msg_id": uuid.uuid4().hex[:12],
            "peer_id": self.peer_id,
            "nickname": self.nickname,
            "text": text,
            "timestamp": datetime.now().strftime("%H:%M:%S"),
        }
        if target_peer_id:
            msg["target_peer_id"] = target_peer_id
        target_room = room_id or self.room_id
        msg["_room_id"] = target_room
        if room_id and room_id != self.room_id:
            tb = self.joined_rooms.get(room_id)
            rk = self.room_keys.get(room_id, self.key)
            if not tb:
                return False
            try:
                self.client.publish(f"{tb}/msg", _encode_msg(msg, rk))
            except Exception:
                return False
        else:
            self._publish("msg", msg)
        with self._lock:
            self.messages.append({**msg, "direction": "out"})
        if self.storage:
            try:
                self.storage.store_message("wan", target_room, self.peer_id,
                                           self.nickname, "out", text)
            except Exception:
                pass
        return True

    def broadcast_registered_contact(self, email_hash: str, phone_hash: str, username: str):
        """广播已注册的邮箱/手机号哈希到全局，其他设备收到后记录，防止重复注册。"""
        if not self.client or not self.client.connected:
            return
        msg = {
            "type": "registered_contact",
            "email_hash": email_hash,
            "phone_hash": phone_hash,
            "username": username,
            "timestamp": time.time(),
        }
        try:
            self.client.publish("mrhua/global/registered", json.dumps(msg, ensure_ascii=False).encode("utf-8"))
        except Exception:
            pass

    def send_file(self, file_path: str) -> Dict:
        if not self.is_connected():
            return {"success": False, "error": "未连接"}
        if not os.path.isfile(file_path):
            return {"success": False, "error": "文件不存在"}
        size = os.path.getsize(file_path)
        if size > self.MAX_FILE_SIZE:
            return {"success": False, "error": f"文件过大，限制 {self.MAX_FILE_SIZE // 1024 // 1024}MB"}
        try:
            with open(file_path, "rb") as f:
                data = base64.b64encode(f.read()).decode("ascii")
            msg = {
                "type": "file",
                "peer_id": self.peer_id,
                "nickname": self.nickname,
                "filename": os.path.basename(file_path),
                "data": data,
                "timestamp": datetime.now().strftime("%H:%M:%S"),
            }
            self._publish("file", msg)
            with self._lock:
                self.file_transfers.append({
                    "filename": os.path.basename(file_path),
                    "size": size,
                    "from_name": self.nickname,
                    "direction": "out",
                    "timestamp": datetime.now().strftime("%H:%M:%S"),
                })
            return {"success": True, "filename": os.path.basename(file_path), "size": size}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_status(self) -> Dict:
        with self._lock:
            # 过滤掉自己，防止重复显示（同时过滤peer_id相同和昵称相同的残留连接）
            peers_list = [p for p in self.peers.values()
                          if p.get("peer_id") != self.peer_id
                          and p.get("nickname") != self.nickname]
            # 获取本地用户名
            username = ""
            try:
                from libertas.identity.auth_manager import get_auth_manager
                am = get_auth_manager()
                if am:
                    info = am.get_info()
                    if info:
                        username = info.get("username", "")
            except Exception:
                pass
            status = {
                "connected": self.is_connected(),
                "room_id": self.room_id,
                "nickname": self.nickname,
                "username": username,
                "peer_id": self.peer_id,
                "broker": self.broker_host,
                "tls": self.use_tls,
                "role": self.role,
                "display_name": self.display_name,
                "peers": peers_list,
                "messages": self.messages[-100:],
                "transfers": self.file_transfers[-30:],
            }
        if self.storage:
            try:
                status["history_count"] = len(self.storage.get_messages(network="wan", room_id=self.room_id, limit=500))
            except Exception:
                status["history_count"] = 0
        return status
