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
from .crypto import _decode_msg, _encode_msg


class HandlersMixin:
    def _on_mqtt_message(self, topic: str, payload: bytes):
        # 解析消息来自哪个房间
        msg_room_id = ""
        room_key = self.key
        if topic.startswith("mrhua/wan/"):
            parts = topic[len("mrhua/wan/"):].split("/", 1)
            msg_room_id = parts[0]
            if msg_room_id in self.room_keys:
                room_key = self.room_keys[msg_room_id]
            elif msg_room_id == self.room_id:
                room_key = self.key

        if topic == "mrhua/global/stats":
            try:
                stats = json.loads(payload.decode("utf-8"))
                if self.governance and stats.get("peer_id") != self.peer_id:
                    self.governance.update_global_presence(stats["peer_id"], stats)
            except Exception:
                pass
            return  # 防止fallthrough到消息解码
        elif topic == "mrhua/global/registered":
            try:
                msg = json.loads(payload.decode("utf-8"))
                if msg.get("type") == "registered_contact":
                    from libertas.identity.auth_manager import AuthManager
                    am = AuthManager()
                    am.add_registered_contact_hash(
                        email_hash=msg.get("email_hash", ""),
                        phone_hash=msg.get("phone_hash", ""),
                        username=msg.get("username", ""),
                        source="global"
                    )
                    # 同步到社群引擎，确保累计注册统计包含WAN远端用户
                    try:
                        from ..community.engine import DualTrackCommunityEngine
                        import os as _os
                        _ce = DualTrackCommunityEngine(
                            storage_dir=_os.path.join(get_data_dir(), "community"))
                        _ce.add_registered_user(msg.get("username", ""), source="wan")
                    except Exception:
                        pass
            except Exception:
                pass
            return
        # /sync 主题的消息是明文 JSON（节点同步），不走加密通道
        if topic.endswith("/sync"):
            try:
                msg = json.loads(payload.decode("utf-8"))
                if msg.get("peer_id") == self.peer_id:
                    return
                msg["_room_id"] = msg_room_id
                self._handle_node_sync(msg)
            except Exception:
                pass
            return
        # /mirror/presence 和 /mirror/activity 是明文 JSON（镜像舱协作）
        if topic.endswith("/mirror/presence") or topic.endswith("/mirror/activity"):
            try:
                msg = json.loads(payload.decode("utf-8"))
                if msg.get("peer_id") == self.peer_id:
                    return
                msg["_room_id"] = msg_room_id
                if topic.endswith("/mirror/presence"):
                    self._handle_mirror_presence(msg)
                else:
                    self._handle_mirror_activity(msg)
            except Exception:
                pass
            return
        msg = _decode_msg(payload, room_key)
        if not msg:
            return
        msg["_room_id"] = msg_room_id  # 标记消息来源房间
        msg_type = msg.get("type", "")
        if msg.get("peer_id") == self.peer_id:
            return
        # 定向消息：如果指定了 target_peer_id 且不是自己，忽略
        _target = msg.get("target_peer_id", "")
        if _target and _target != self.peer_id and msg_type not in ("presence",):
            return
        if msg_type == "presence":
            self._handle_presence(msg)
        elif msg_type == "message":
            with self._lock:
                self.messages.append({**msg, "direction": "in", "msg_id": msg.get("msg_id") or uuid.uuid4().hex[:12]})
            if self.storage:
                try:
                    self.storage.store_message("wan", self.room_id, msg.get("peer_id",""),
                                               msg.get("nickname",""), "in", msg.get("text",""))
                except Exception:
                    pass
        elif msg_type == "file":
            self._handle_file(msg)
        elif msg_type == "version_release":
            self._handle_version_release(msg)
        elif msg_type == "version_request":
            self._handle_version_request(msg)
        elif msg_type == "plugin_announce":
            self._handle_plugin_announce(msg)
        elif msg_type == "plugin_chunk":
            self._handle_plugin_chunk(msg)
        elif msg_type == "plugin_request":
            self._handle_plugin_request(msg)
        elif msg_type == "node_status":
            self._handle_node_status(msg)
        elif msg_type == "node_command":
            self._handle_node_command(msg)
        elif msg_type == "whiteboard_sync":
            self._handle_whiteboard_sync(msg)
        elif msg_type == "node_sync":
            self._handle_node_sync(msg)

    def _handle_node_sync(self, msg: dict):
        """处理节点同步消息：缓存数据 + 在聊天中显示提示"""
        try:
            from libertas.network.node_sync import NodeSyncManager
            NodeSyncManager().receive(msg)
        except Exception:
            pass
        # 在聊天中显示一条系统消息
        type_labels = {
            "wordlists": "📚 字典",
            "tool_config": "🔧 配置",
            "rules": "📋 规则",
            "workflows": "🔄 工作流",
        }
        data_type = msg.get("data_type", "")
        label = type_labels.get(data_type, data_type)
        file_name = msg.get("file_name", "")
        nickname = msg.get("nickname", msg.get("peer_id", "未知"))
        title = msg.get("title", "")
        description = msg.get("description", "")
        tags = msg.get("tags", [])
        # 构建显示文本
        if title:
            text = f"📦 {nickname} 共享: {title}"
            if file_name:
                text += f"\n{label}: {file_name}"
        elif file_name:
            text = f"📦 {nickname} 共享了 {label}: {file_name}"
        else:
            data = msg.get("data")
            if isinstance(data, list):
                text = f"📦 {nickname} 共享了 {label}列表（{len(data)}项）"
            else:
                text = f"📦 {nickname} 共享了 {label}"
        text += "\n👉 打开「节点同步」可拉取保存"
        if description:
            text += f"\n💬 {description[:200]}"
        if tags:
            text += "\n🏷️ " + " ".join(f"#{t}" for t in tags[:5])
        with self._lock:
            self.messages.append({
                "type": "message",
                "msg_id": uuid.uuid4().hex[:12],
                "peer_id": msg.get("peer_id", ""),
                "nickname": nickname,
                "text": text,
                "timestamp": datetime.now().strftime("%H:%M:%S"),
                "direction": "in",
                "is_system": True,
                "sync_title": title,
                "sync_description": description,
                "sync_tags": tags,
                "sync_file": file_name,
                "sync_type": data_type,
            })
        if self.storage:
            try:
                self.storage.store_message("wan", self.room_id, msg.get("peer_id",""),
                                           nickname, "in", text)
            except Exception:
                pass

    def _broadcast_global_stats(self):
        if not self.client or not self.client.connected:
            return
        stats = {
            "peer_id": self.peer_id,
            "nickname": self.nickname,
            "role": self.role,
            "room_id": self.room_id,
            "version": self.version,
            "timestamp": time.time(),
        }
        try:
            self.client.publish("mrhua/global/stats", json.dumps(stats, ensure_ascii=False).encode("utf-8"))
        except Exception:
            pass

    def _handle_presence(self, msg: dict):
        pid = msg.get("peer_id", "")
        action = msg.get("action", "")
        if pid == self.peer_id:
            return
        room = msg.get("_room_id", self.room_id)
        with self._lock:
            key = f"{room}:{pid}"
            if action == "leave":
                self.peers.pop(key, None)
            else:
                self.peers[key] = {
                    "peer_id": pid,
                    "nickname": msg.get("nickname", "未知"),
                    "display_name": msg.get("display_name", "") or msg.get("nickname", "未知"),
                    "data_scope": str(msg.get("data_scope", "") or ""),
                    "last_seen": time.time(),
                    "room_id": room,
                }
        if action == "join":
            self._send_presence("welcome", room)

    def _handle_file(self, msg: dict):
        try:
            filename = msg.get("filename", "unknown")
            filedata = msg.get("data", "")
            from_name = msg.get("nickname", "未知")
            if not filedata:
                return
            safe_name = os.path.basename(filename)
            filepath = os.path.join(self.share_dir, safe_name)
            with open(filepath, "wb") as f:
                f.write(base64.b64decode(filedata))
            info = {
                "type": "file",
                "filename": safe_name,
                "size": len(base64.b64decode(filedata)),
                "from_name": from_name,
                "from_id": msg.get("peer_id", ""),
                "direction": "in",
                "timestamp": datetime.now().strftime("%H:%M:%S"),
            }
            with self._lock:
                self.file_transfers.append(info)
        except Exception:
            pass

    def _handle_version_release(self, msg: dict):
        """接收版本发布通知"""
        try:
            from libertas.release.version_release import VersionReleaseManager
            rm = VersionReleaseManager(project_root=os.path.dirname(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
            rm.receive_release(msg)
        except Exception:
            pass

    def _handle_version_request(self, msg: dict):
        """处理版本下载请求：如果本地有该版本包，发送回去"""
        try:
            version = msg.get("version", "")
            requester = msg.get("requester", "")
            if not version or not requester:
                return
            releases_dir = os.path.join(get_data_dir(), "releases")
            for fn in os.listdir(releases_dir):
                if version in fn and fn.endswith(".zip"):
                    filepath = os.path.join(releases_dir, fn)
                    with open(filepath, "rb") as f:
                        data = base64.b64encode(f.read()).decode()
                    # 分块发送大文件
                    chunk_size = 90000
                    chunks = [data[i:i+chunk_size] for i in range(0, len(data), chunk_size)]
                    for i, chunk in enumerate(chunks):
                        reply = {
                            "type": "file",
                            "peer_id": self.peer_id,
                            "nickname": self.nickname,
                            "filename": fn,
                            "data": chunk,
                            "chunk_index": i,
                            "chunk_total": len(chunks),
                            "timestamp": datetime.now().strftime("%H:%M:%S"),
                        }
                        self._publish(f"{self.topic_base}/file", _encode_msg(reply, self.key))
                        time.sleep(0.1)
                    break
        except Exception:
            pass

    def _handle_plugin_announce(self, msg: dict):
        """接收WAN插件发布公告"""
        try:
            from libertas.tools.plugin_system import PluginManager
            pm = PluginManager()
            pm.receive_plugin_announce(msg)
        except Exception:
            pass

    def _handle_plugin_chunk(self, msg: dict):
        """接收WAN插件代码分块"""
        try:
            from libertas.tools.plugin_system import PluginManager
            pm = PluginManager()
            pm.receive_plugin_chunk(msg)
        except Exception:
            pass

    def _handle_plugin_request(self, msg: dict):
        """处理插件代码请求"""
        try:
            from libertas.tools.plugin_system import PluginManager
            pm = PluginManager()
            pm.set_wan(self)
            pm.handle_plugin_request(msg)
        except Exception:
            pass

    def _handle_node_status(self, msg: dict):
        """接收节点状态"""
        try:
            from libertas.network.node_manager import NodeManager
            nm = NodeManager()
            nm.update_node(msg.get("peer_id",""), msg)
        except Exception:
            pass

    def _handle_node_command(self, msg: dict):
        """接收远程指令"""
        if msg.get("to") != self.peer_id:
            return
        cmd = msg.get("command", "")
        params = msg.get("params", {})
        try:
            if cmd == "ping":
                reply = {"type": "message", "peer_id": self.peer_id, "nickname": self.nickname,
                         "text": f"pong (v{self.version})", "timestamp": datetime.now().strftime("%H:%M:%S")}
                self._publish(f"{self.topic_base}/msg", _encode_msg(reply, self.key))
            elif cmd == "sync_feeds":
                from libertas.security.feed_sync import FeedSyncManager
                FeedSyncManager().sync_all()
            elif cmd == "update_wordlists":
                pass  # 触发字典更新
        except Exception:
            pass

    def _handle_whiteboard_sync(self, msg: dict):
        """接收白板同步"""
        try:
            from libertas.data.whiteboard import WhiteboardManager
            wb = WhiteboardManager()
            wb.receive_sync(msg)
        except Exception:
            pass

    def _handle_mirror_presence(self, msg: dict):
        """接收镜像舱在线状态"""
        try:
            if not hasattr(self, '_mirror_presence'):
                self._mirror_presence = {}
            room = msg.get("_room_id", self.room_id)
            key = f"{room}:{msg.get('peer_id', '')}"
            msg["_room_id"] = room
            self._mirror_presence[key] = msg
        except Exception:
            pass

    def _handle_mirror_activity(self, msg: dict):
        """接收镜像舱任务动态"""
        try:
            if not hasattr(self, '_mirror_activity'):
                self._mirror_activity = []
            room = msg.get("_room_id", self.room_id)
            msg["_room_id"] = room
            self._mirror_activity.append(msg)
            if len(self._mirror_activity) > 200:
                self._mirror_activity = self._mirror_activity[-200:]
        except Exception:
            pass
