"""MrHua 广域网 HTTP 适配层。

前端 `app-shell.js` 调用 `/api/wan/*`，这里把请求接到
`libertas.tools.legacy_tools.wan_share` 的真实 MQTT 房间实现。
默认公共房间是 ``my_era``；服务启动后会异步尝试自动加入，页面也可以再
显式调用 ``/api/wan/auto_join``。创建房间复用 MQTT 房间订阅：输入新的
房间号与密码即可建立独立房间，不需要服务端额外保存房间表。
"""

from __future__ import annotations

import email
import email.policy
import json
import os
import socket
import threading
import time
from pathlib import Path
from typing import Optional

from libertas.tools.legacy_tools.wan_share import get_wan_share

MAX_BODY = 1_000_000


class WANAPI:
    def __init__(self, auto_join: bool = True) -> None:
        self._wan = None
        self._connect_lock = threading.Lock()
        self._auto_state = "idle"
        if auto_join:
            self._auto_state = "connecting"
            threading.Thread(
                target=self._auto_join_worker,
                name="wan-auto-join",
                daemon=True,
            ).start()

    @property
    def wan(self):
        if self._wan is None:
            self._wan = get_wan_share()
        return self._wan

    @staticmethod
    def read_json(handler) -> Optional[dict]:
        try:
            length = int(handler.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                return None
            body = handler.rfile.read(length)
            return json.loads(body.decode("utf-8"))
        except (OSError, ValueError, TypeError):
            return None

    def _auto_join_worker(self) -> None:
        with self._connect_lock:
            try:
                result = self.wan.auto_join_default_room()
                self._auto_state = "connected" if result.get("success") else "failed"
            except Exception:
                self._auto_state = "failed"

    def _ensure_auto_join(self) -> dict:
        if self.wan.is_connected():
            self._auto_state = "connected"
            return {"success": True, "already_connected": True}
        # 启动线程可能正在连接，给它一点时间完成，避免用户立刻点“创建”
        # 时误报“未连接”。
        deadline = time.time() + 12
        while self._auto_state == "connecting" and time.time() < deadline:
            time.sleep(0.25)
        with self._connect_lock:
            if self.wan.is_connected():
                self._auto_state = "connected"
                return {"success": True, "already_connected": True}
            result = self.wan.auto_join_default_room()
            self._auto_state = "connected" if result.get("success") else "failed"
            return result

    # ---------------------------------------------------------------- GET
    def handle_get(self, handler, route: str) -> bool:
        if route == "/api/wan/status":
            try:
                status = self.wan.get_status()
                status["auto_state"] = self._auto_state
                handler._send_json({"success": True, **status})
            except Exception as error:
                handler._send_json({"success": False, "error": f"广域网状态获取失败: {error}"}, 500)
            return True
        if route == "/api/wan/rooms":
            if not self.wan.is_connected():
                handler._send_json({"success": True, "rooms": []})
                return True
            handler._send_json({"success": True, "rooms": self.wan.get_all_rooms_overview()})
            return True
        if route.startswith("/api/wan/rooms/") and route.endswith("/messages"):
            room_id = route[len("/api/wan/rooms/"):-len("/messages")].strip("/")
            if not self.wan.is_connected():
                handler._send_json({"success": False, "error": "未连接"}, 400)
                return True
            handler._send_json({
                "success": True,
                "messages": self.wan.get_room_messages(room_id),
                "peers": self.wan.get_room_peers(room_id),
            })
            return True
        if route.startswith("/api/wan/download/"):
            filename = os.path.basename(route[len("/api/wan/download/"):])
            path = Path(self.wan.share_dir) / filename
            if not path.is_file():
                handler._send_json({"success": False, "error": "文件不存在"}, 404)
                return True
            handler._send_file(path)
            return True
        if route == "/api/nat/status":
            local_ip = ""
            try:
                local_ip = socket.gethostbyname(socket.gethostname())
            except OSError:
                pass
            handler._send_json({
                "success": True,
                "local_ip": local_ip or "127.0.0.1",
                "public_ip": "",
                "nat_type": "未知（由 MQTT 中继转发的公网通信）",
                "upnp_available": False,
            })
            return True
        return False

    # --------------------------------------------------------------- POST
    def handle_post(self, handler, route: str) -> bool:
        if route == "/api/wan/auto_join":
            body = self.read_json(handler) or {}
            result = self._ensure_auto_join()
            handler._send_json(result, 200 if result.get("success") else 409)
            return True
        if route == "/api/wan/connect":
            body = self.read_json(handler) or {}
            room = str(body.get("room_id", "")).strip()
            password = str(body.get("password", ""))
            if not room or not password:
                handler._send_json({"success": False, "error": "房间号和密码不能为空"}, 400)
                return True
            with self._connect_lock:
                result = self.wan.connect_room(
                    room,
                    password,
                    str(body.get("nickname", "")).strip(),
                    str(body.get("broker", "")).strip(),
                    int(body.get("port", 0) or 0),
                    use_tls=bool(body.get("use_tls", True)),
                    display_name=str(body.get("display_name", "")).strip(),
                )
            if result.get("success"):
                self.wan.system_rooms.add(self.wan.DEFAULT_ROOM)
            handler._send_json(result)
            return True
        if route == "/api/wan/disconnect":
            self.wan.disconnect()
            self._auto_state = "disconnected"
            handler._send_json({"success": True})
            return True
        if route == "/api/wan/update_name":
            body = self.read_json(handler) or {}
            nickname = str(body.get("nickname", "")).strip()
            display_name = str(body.get("display_name", "")).strip()
            if not nickname and not display_name:
                handler._send_json({"success": False, "error": "昵称不能为空"}, 400)
                return True
            ok = self.wan.update_display_name(
                nickname=nickname or None,
                display_name=display_name or None,
            )
            handler._send_json({
                "success": ok,
                "nickname": self.wan.nickname,
                "display_name": self.wan.display_name,
            })
            return True
        if route == "/api/wan/send":
            if not self.wan.is_connected():
                handler._send_json({"success": False, "error": "未连接到房间"}, 400)
                return True
            body = self.read_json(handler) or {}
            text = str(body.get("text", "")).strip()
            if not text:
                handler._send_json({"success": False, "error": "消息不能为空"}, 400)
                return True
            ok = self.wan.send_message(
                text,
                str(body.get("room_id", "")).strip(),
                str(body.get("target_peer_id", "")).strip(),
            )
            handler._send_json({"success": ok})
            return True
        if route == "/api/wan/rooms/join":
            self._join(handler, create=False)
            return True
        if route == "/api/wan/rooms/create":
            self._join(handler, create=True)
            return True
        if route == "/api/wan/rooms/leave":
            body = self.read_json(handler) or {}
            rid = str(body.get("room_id", "")).strip()
            if rid == self.wan.DEFAULT_ROOM:
                handler._send_json({"success": False, "error": "公共社区房间不可离开"})
                return True
            handler._send_json(self.wan.leave_additional_room(rid))
            return True
        if route.startswith("/api/wan/rooms/") and route.endswith("/messages/delete"):
            room_id = route[len("/api/wan/rooms/"):-len("/messages/delete")].strip("/")
            body = self.read_json(handler) or {}
            msg_id = str(body.get("msg_id", "")).strip()
            if not msg_id:
                handler._send_json({"success": False, "error": "缺少msg_id"}, 400)
                return True
            handler._send_json({"success": self.wan.delete_message(room_id, msg_id)})
            return True
        if route == "/api/wan/send_file":
            self._send_file(handler)
            return True
        if route == "/api/wan/broker_ping":
            body = self.read_json(handler) or {}
            host = str(body.get("host", "")).strip()
            port = int(body.get("port", 8883) or 8883)
            if not host:
                handler._send_json({"success": False, "error": "缺少host"}, 400)
                return True
            started = time.time()
            try:
                sock = socket.create_connection((host, port), timeout=5)
                sock.close()
                handler._send_json({
                    "success": True,
                    "latency_ms": int((time.time() - started) * 1000),
                })
            except Exception as error:
                handler._send_json({"success": False, "error": str(error)})
            return True
        return False

    def _join(self, handler, create: bool) -> None:
        body = self.read_json(handler) or {}
        room_id = str(body.get("room_id", "")).strip()
        password = str(body.get("password", ""))
        if not room_id:
            handler._send_json({"success": False, "error": "房间ID不能为空"}, 400)
            return
        if not self.wan.is_connected():
            auto = self._ensure_auto_join()
            if not auto.get("success"):
                handler._send_json({"success": False, "error": auto.get("error") or "未连接到MQTT中继"}, 400)
                return
        result = self.wan.join_additional_room(room_id, password)
        if result.get("success"):
            result["created"] = bool(create)
        handler._send_json(result)

    def _send_file(self, handler) -> None:
        if not self.wan.is_connected():
            handler._send_json({"success": False, "error": "未连接到房间"}, 400)
            return
        try:
            length = int(handler.headers.get("Content-Length", "0"))
            if length <= 0 or length > 8 * 1024 * 1024:
                handler._send_json({"success": False, "error": "文件为空或超过 8MB"}, 400)
                return
            content_type = handler.headers.get("Content-Type", "")
            body = handler.rfile.read(length)
            message = email.parser.BytesParser(policy=email.policy.default).parsebytes(
                b"Content-Type: " + content_type.encode("latin-1") + b"\r\n"
                b"MIME-Version: 1.0\r\n\r\n" + body
            )
            upload = None
            if message.is_multipart():
                for part in message.iter_parts():
                    if part.get_filename():
                        upload = part
                        break
            if upload is None:
                handler._send_json({"success": False, "error": "未收到文件"}, 400)
                return
            payload = upload.get_payload(decode=True) or b""
            filename = os.path.basename(upload.get_filename() or "upload.bin")
            target = Path(self.wan.share_dir) / filename
            target.write_bytes(payload)
            try:
                result = self.wan.send_file(str(target))
            finally:
                try:
                    target.unlink()
                except OSError:
                    pass
            handler._send_json(result)
        except Exception as error:
            handler._send_json({"success": False, "error": f"文件发送失败: {error}"}, 500)
