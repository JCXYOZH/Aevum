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
from .crypto import _decode_msg, _derive_key, _encode_msg
from .mqtt import MQTTClient


class RoomMixin:
    DEFAULT_BROKER = "broker.hivemq.com"
    DEFAULT_PORT = 8883
    DEFAULT_TLS_PORT = 8883
    FALLBACK_BROKERS = [
        ("broker.hivemq.com", 8883, True),
        ("broker.emqx.io", 8883, True),
        ("test.mosquitto.org", 8883, True),
        ("broker.hivemq.com", 1883, False),
        ("broker.emqx.io", 1883, False),
        ("test.mosquitto.org", 1883, False),
    ]
    DEFAULT_ROOM = "my_era"
    DEFAULT_ROOM_PASSWORD = "my_era_public_2026"
    MAX_FILE_SIZE = 5 * 1024 * 1024
    PRESENCE_INTERVAL = 20
    PEER_TIMEOUT = 60

    def __init__(self, storage=None, rate_limiter=None, governance=None):
        self.client: Optional[MQTTClient] = None
        self.room_id = ""
        self.nickname = ""
        self.display_name = ""
        self.data_scope = ""
        self.peer_id = self._load_or_create_peer_id()
        self.key = b""
        self.topic_base = ""
        self.joined_rooms: Dict[str, str] = {}  # room_id -> topic_base（额外加入的房间）
        self.room_keys: Dict[str, bytes] = {}  # room_id -> key（每个房间独立密钥）
        self.system_rooms: set = set()  # 系统房间（如my_era社区统计），不可离开
        self.peers: Dict[str, Dict] = {}
        self.messages: List[Dict] = []
        self.file_transfers: List[Dict] = []
        self._running = False
        self._reconnecting = False
        self._last_password = ""
        self._presence_thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self.broker_host = self.DEFAULT_BROKER
        self.broker_port = self.DEFAULT_PORT
        self.use_tls = True
        self.share_dir = os.path.join(os.path.expanduser("~"), "MrHuaWorkspace", "WANFiles")
        os.makedirs(self.share_dir, exist_ok=True)
        self.storage = storage
        self.rate_limiter = rate_limiter
        self.governance = governance
        self.password_hash = ""
        self.version = "1.0.0"
        self._saved_rooms_file = os.path.join(get_data_dir(), "wan_joined_rooms.json"
        )

    def _save_joined_rooms(self):
        """持久化已加入的额外房间（含密码），重启后自动重新加入"""
        try:
            data = []
            for rid in self.joined_rooms:
                if rid in self.system_rooms:
                    continue
                key = self.room_keys.get(rid, b"")
                pwd = ""
                if key:
                    import base64
                    pwd = base64.b64encode(key).decode("ascii")
                data.append({"room_id": rid, "key_b64": pwd})
            os.makedirs(os.path.dirname(self._saved_rooms_file), exist_ok=True)
            with open(self._saved_rooms_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def _load_saved_rooms(self) -> list:
        """加载持久化的房间列表"""
        try:
            if os.path.exists(self._saved_rooms_file):
                with open(self._saved_rooms_file, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass
        return []

    def rejoin_saved_rooms(self):
        """连接主房间后，重新加入之前保存的房间"""
        if not self._running:
            return
        saved = self._load_saved_rooms()
        for entry in saved:
            rid = entry.get("room_id", "")
            if not rid or rid in self.joined_rooms or rid == self.room_id:
                continue
            if rid in self.system_rooms:
                continue
            key_b64 = entry.get("key_b64", "")
            try:
                import base64, hashlib
                raw_key = base64.b64decode(key_b64) if key_b64 else None
                topic_base = f"mrhua/wan/{rid}"
                subtopics = ["msg", "presence", "file", "release", "release_req",
                             "plugin", "plugin_data", "plugin_req", "sync", "whiteboard",
                             "mirror/presence", "mirror/activity", "node_status", "node_cmd"]
                for sub in subtopics:
                    try:
                        self.client.subscribe(f"{topic_base}/{sub}")
                    except Exception:
                        pass
                self.joined_rooms[rid] = topic_base
                if raw_key:
                    self.room_keys[rid] = raw_key
            except Exception:
                pass

    @property
    def role(self) -> str:
        activated = False
        try:
            from libertas.identity.auth_manager import get_auth_manager
            am = get_auth_manager()
            if am:
                info = am.get_info()
                if info and info.get("activated"):
                    activated = True
        except Exception:
            pass
        if not activated:
            return "guest"
        effective = "member"
        if self.governance:
            try:
                info = self.governance.get_role(self.peer_id)
                gov_role = info.get("role", "guest") if info else "guest"
                hierarchy = ["guest", "muted", "member", "contributor",
                             "reviewer", "maintainer", "moderator",
                             "arbitrator", "admin", "owner"]
                if hierarchy.index(gov_role) > hierarchy.index("member"):
                    effective = gov_role
            except Exception:
                pass
        return effective

    @role.setter
    def role(self, value):
        pass

    def _load_or_create_peer_id(self) -> str:
        """加载或创建持久化的peer_id，防止每次重启产生新ID导致累计注册数虚高"""
        peer_file = os.path.join(get_data_dir(), ".peer_id")
        try:
            if os.path.isfile(peer_file):
                with open(peer_file, "r", encoding="utf-8") as f:
                    pid = f.read().strip()
                    if pid and len(pid) >= 8:
                        return pid[:12]
        except Exception:
            pass
        pid = uuid.uuid4().hex[:12]
        try:
            os.makedirs(os.path.dirname(peer_file), exist_ok=True)
            with open(peer_file, "w", encoding="utf-8") as f:
                f.write(pid)
        except Exception:
            pass
        return pid

    def connect_room(self, room_id: str, password: str, nickname: str = "",
                     broker: str = "", port: int = 0, use_tls: bool = True,
                     display_name: str = "") -> Dict:
        if self._running:
            self.disconnect()
        # 防暴力破解
        if self.rate_limiter:
            allowed, reason = self.rate_limiter.check(f"wan_connect:{room_id}")
            if not allowed:
                return {"success": False, "error": f"连接受限: {reason}"}
        self.room_id = room_id.strip()
        self.display_name = display_name.strip() if display_name.strip() else ""
        # nickname 只存短昵称，display_name 存完整显示名
        self.nickname = nickname.strip() if nickname.strip() else (self.display_name or f"用户_{self.peer_id[:6]}")
        self.key = _derive_key(password)
        self._last_password = password
        self.topic_base = f"mrhua/wan/{self.room_id}"
        if broker:
            self.broker_host = broker
        self.use_tls = use_tls
        if port:
            self.broker_port = port
        elif use_tls:
            self.broker_port = self.DEFAULT_TLS_PORT
        else:
            self.broker_port = self.DEFAULT_PORT
        # 构建要尝试的中继列表：用户指定的优先，然后备用
        brokers_to_try = [(self.broker_host, self.broker_port, use_tls)]
        for fb_host, fb_port, fb_tls in self.FALLBACK_BROKERS:
            if (fb_host, fb_port, fb_tls) not in brokers_to_try:
                brokers_to_try.append((fb_host, fb_port, fb_tls))

        connected = False
        last_error = ""
        import time as _time_conn
        _conn_start = _time_conn.monotonic()
        _MAX_CONNECT_TIME = 12  # 最多尝试12秒
        for b_host, b_port, b_tls in brokers_to_try:
            if _time_conn.monotonic() - _conn_start > _MAX_CONNECT_TIME:
                break
            self.broker_host = b_host
            self.broker_port = b_port
            self.use_tls = b_tls
            self.client = MQTTClient(b_host, b_port, use_tls=b_tls)
            self.client._on_message = self._on_mqtt_message
            self.client._on_disconnect = self._on_disconnect
            if self.client.connect(client_id=f"mrhua_{self.peer_id}"):
                connected = True
                break
            last_error = f"{b_host}:{b_port}{' (TLS)' if b_tls else ''}"
            self.client = None

        if not connected:
            if self.rate_limiter:
                self.rate_limiter.record(f"wan_connect:{room_id}", False)
            return {"success": False, "error": f"无法连接到任何中继服务器（最后尝试: {last_error}），请检查网络或防火墙"}
        if self.rate_limiter:
            self.rate_limiter.record(f"wan_connect:{room_id}", True)
        self.client.subscribe(f"{self.topic_base}/msg")
        self.client.subscribe(f"{self.topic_base}/presence")
        self.client.subscribe(f"{self.topic_base}/file")
        self.client.subscribe(f"{self.topic_base}/release")
        self.client.subscribe(f"{self.topic_base}/release_req")
        self.client.subscribe(f"{self.topic_base}/plugin")
        self.client.subscribe(f"{self.topic_base}/plugin_data")
        self.client.subscribe(f"{self.topic_base}/plugin_req")
        self.client.subscribe(f"{self.topic_base}/sync")
        self.client.subscribe(f"{self.topic_base}/whiteboard")
        self.client.subscribe(f"{self.topic_base}/mirror/presence")
        self.client.subscribe(f"{self.topic_base}/mirror/activity")
        self.client.subscribe(f"{self.topic_base}/node_status")
        self.client.subscribe(f"{self.topic_base}/node_cmd")
        self.client.subscribe("mrhua/global/stats")
        self.client.subscribe("mrhua/global/registered")
        self._running = True
        self._send_presence("join")
        self._broadcast_global_stats()
        self._presence_thread = threading.Thread(target=self._presence_loop, daemon=True)
        self._presence_thread.start()
        # 重新加入之前保存的房间
        self.rejoin_saved_rooms()
        # 存储房间信息
        if self.storage:
            try:
                from .chat_security import hash_password
                self.storage.store_room("wan", self.room_id, owner_id=self.peer_id,
                                        password_hash=hash_password(password))
                self.storage.upsert_peer("wan", self.room_id, self.peer_id, self.nickname, role="member")
            except Exception:
                pass
        return {"success": True, "room": self.room_id, "peer_id": self.peer_id,
                "broker": self.broker_host, "tls": use_tls}

    def auto_join_default_room(self, nickname: str = "", display_name: str = "") -> Dict:
        """注册/登录后自动加入默认公共房间 my_era，用于全局在线统计。
        如果用户已连接到其他主房间，则把 my_era 作为后台系统房间加入，不断开主房间。"""
        if self._running and self.room_id == self.DEFAULT_ROOM:
            self.system_rooms.add(self.DEFAULT_ROOM)
            return {"success": True, "already_connected": True, "room": self.DEFAULT_ROOM}
        if self._running and self.DEFAULT_ROOM in self.joined_rooms:
            self.system_rooms.add(self.DEFAULT_ROOM)
            return {"success": True, "already_connected": True, "room": self.DEFAULT_ROOM}
        if self._running and self.room_id and self.room_id != self.DEFAULT_ROOM:
            result = self.join_additional_room(self.DEFAULT_ROOM, self.DEFAULT_ROOM_PASSWORD)
            if result.get("success"):
                self.system_rooms.add(self.DEFAULT_ROOM)
            result["auto_joined"] = True
            return result
        try:
            result = self.connect_room(
                room_id=self.DEFAULT_ROOM,
                password=self.DEFAULT_ROOM_PASSWORD,
                nickname=nickname,
                display_name=display_name,
                use_tls=True,
            )
            if result.get("success"):
                self.system_rooms.add(self.DEFAULT_ROOM)
            result["auto_joined"] = True
            return result
        except Exception as e:
            return {"success": False, "error": str(e), "auto_joined": False}

    def join_additional_room(self, room_id: str, password: str) -> Dict:
        """在不断开当前房间的情况下，额外加入另一个房间（同时接收多个房间的消息）"""
        room_id = room_id.strip()
        if not room_id:
            return {"success": False, "error": "房间ID不能为空"}
        import re as _re
        if not _re.match(r'^[a-zA-Z0-9_-]{1,64}$', room_id):
            return {"success": False, "error": "房间ID只能包含字母、数字、下划线和横线（1-64字符）"}
        if room_id == self.room_id:
            return {"success": False, "error": "已在主房间中"}
        if room_id in self.joined_rooms:
            return {"success": False, "error": "已加入该房间"}
        if not self.client or not self._running:
            return {"success": False, "error": "未连接到MQTT中继，请先加入主房间"}
        # 派生房间密钥
        room_key = hashlib.sha256((room_id + ":" + password).encode("utf-8")).digest()[:16]
        topic_base = f"mrhua/wan/{room_id}"
        # 订阅该房间的所有子主题
        subtopics = ["msg", "presence", "file", "release", "release_req",
                     "plugin", "plugin_data", "plugin_req", "sync", "whiteboard",
                     "mirror/presence", "mirror/activity", "node_status", "node_cmd"]
        for sub in subtopics:
            try:
                self.client.subscribe(f"{topic_base}/{sub}")
            except Exception:
                pass
        self.joined_rooms[room_id] = topic_base
        self.room_keys[room_id] = room_key
        self._save_joined_rooms()
        # 广播加入presence到新房间
        try:
            join_msg = {"type": "presence", "peer_id": self.peer_id,
                        "nickname": self.nickname, "action": "join",
                        "timestamp": time.time()}
            self.client.publish(f"{topic_base}/presence",
                                _encode_msg(join_msg, room_key))
        except Exception:
            pass
        return {"success": True, "room": room_id, "total_rooms": len(self.joined_rooms) + 1}

    def leave_additional_room(self, room_id: str) -> Dict:
        """离开一个额外加入的房间"""
        if room_id in self.system_rooms:
            return {"success": False, "error": "社区系统房间不可离开"}
        if room_id not in self.joined_rooms:
            return {"success": False, "error": "未加入该房间"}
        topic_base = self.joined_rooms[room_id]
        # 取消订阅
        subtopics = ["msg", "presence", "file", "release", "release_req",
                     "plugin", "plugin_data", "plugin_req", "sync", "whiteboard",
                     "mirror/presence", "mirror/activity", "node_status", "node_cmd"]
        for sub in subtopics:
            try:
                self.client._sock.sendall(b"")  # no-op, unsubscribe not in minimal client
            except Exception:
                pass
        del self.joined_rooms[room_id]
        self.room_keys.pop(room_id, None)
        self._save_joined_rooms()
        return {"success": True, "room": room_id}

    def list_joined_rooms(self) -> List[Dict]:
        """列出所有已加入的房间"""
        result = [{"room_id": self.room_id, "topic_base": self.topic_base,
                    "is_primary": True, "nickname": self.nickname}]
        for rid, tb in self.joined_rooms.items():
            result.append({"room_id": rid, "topic_base": tb,
                           "is_primary": False, "nickname": self.nickname})
        return result

    def get_room_messages(self, room_id: str, limit: int = 100) -> List[Dict]:
        """获取指定房间的消息"""
        with self._lock:
            msgs = [m for m in self.messages if m.get("_room_id", self.room_id) == room_id]
            return msgs[-limit:]

    def delete_message(self, room_id: str, msg_id: str) -> bool:
        """删除指定房间的一条消息（本地删除）"""
        with self._lock:
            before = len(self.messages)
            self.messages = [m for m in self.messages
                             if not (m.get("msg_id") == msg_id and m.get("_room_id", self.room_id) == room_id)]
            return len(self.messages) < before

    def get_room_peers(self, room_id: str) -> List[Dict]:
        """获取指定房间的在线成员"""
        now = time.time()
        prefix = f"{room_id}:"
        result = []
        with self._lock:
            for key, p in self.peers.items():
                if key.startswith(prefix) and now - p.get("last_seen", 0) < self.PEER_TIMEOUT:
                    result.append(p)
        return result

    def get_room_last_message(self, room_id: str) -> Optional[Dict]:
        """获取指定房间最后一条消息（用于列表预览）"""
        msgs = self.get_room_messages(room_id, 1)
        return msgs[-1] if msgs else None

    def get_all_rooms_overview(self) -> List[Dict]:
        """获取所有房间的概览（用于聊天列表）"""
        rooms = self.list_joined_rooms()
        for r in rooms:
            rid = r["room_id"]
            peers = self.get_room_peers(rid)
            last = self.get_room_last_message(rid)
            r["peer_count"] = len(peers) + 1  # +1 for self
            r["last_message"] = last.get("text", "")[:40] if last else ""
            r["last_from"] = last.get("nickname", "") if last else ""
            r["last_time"] = last.get("timestamp", "") if last else ""
            r["is_system"] = rid in self.system_rooms
            r["is_main"] = (rid == self.room_id)
            r["room_uid"] = hashlib.sha256((rid + ":" + self.broker_host).encode()).hexdigest()[:6]
        return rooms
