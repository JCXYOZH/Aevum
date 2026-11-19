# ============================================================
# server.py — 中继的 HTTP 面（标准库实现，无第三方依赖）
#
# 端点：
#   GET    /v1/health
#   GET    /v1/stats                    只读计数，不含内容
#   GET    /v1/presence                 交流房间的在线/浏览计数
#   POST   /v1/presence                 进房心跳（只记 client 与时间）
#   GET    /v1/sessions                 当前会话列表（不含内容）
#   POST   /v1/sessions                 新建会话
#   GET    /v1/sessions/{sid}/context   取上下文（发给模型的正是这一份）
#   POST   /v1/sessions/{sid}/messages  追加一条消息
#   DELETE /v1/sessions/{sid}           立刻焚毁
#   POST   /v1/transfers                新建一条文件传输，返回 token
#   PUT    /v1/transfers/{token}/chunks 追加一个分片（原始字节）
#   POST   /v1/transfers/{token}/end    声明发送完毕
#   GET    /v1/transfers/{token}        流式取走（取完即销毁）
#   GET    /v1/transfers/{token}/info   传输状态
#   DELETE /v1/transfers/{token}        中止
#
# 约定：
#   * 所有错误都返回 contracts/errors.json 里的 0xRRFFTT，形状见 codes.as_dict；
#   * 不写访问日志到磁盘，只打到 stderr，且不含路径与内容；
#   * GET /v1/transfers/{token} 用 Connection: close 划界，边收边发。
# ============================================================
from __future__ import annotations

import json
import logging
import math
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional, Tuple
from urllib.parse import parse_qs, urlsplit

from relay.codes import (
    CONTRACT_VERSION,
    MAGIC,
    VERSION,
    ERR_OK,
    ERR_R2_MSG_EMPTY,
    ERR_R5_TRANSFER_MISSING,
    ERR_R6_AUTH_DENIED,
    ERR_R6_AUTH_MISSING,
    ERR_R9_INTERNAL,
    ERR_R9_PATH_MISSING,
    as_dict,
    http_status,
)
from relay.errors import RelayFault
from relay.memory import EphemeralMemory, error_hex
from relay.transfer import TransferRelay

logger = logging.getLogger(__name__)

MAX_BODY = 8 * 1024 * 1024      # 单次请求体上限（分片按 1 MiB 设计，留足余量）
MAX_JSON = 1 * 1024 * 1024      # JSON 体上限

ROOM_ID = "lobby"               # 服务端自己开的交流房间，固定 id
ROOM_NOTICE = "房间已开：这里的每条消息只存在内存里，房间关闭或冷却到期就一起消失。"
ROOM_MAX_TURNS = 200            # 房间单独放大窗口：200 轮 = 400 条，够撑一场讨论
PRESENCE_WINDOW = 45.0          # 心跳窗口：超过这个秒数没心跳就算离线
MAX_VISITORS = 10_000           # 浏览计数的内存上限，超了按最早记录淘汰


class RelayApp:
    """把记忆与传输装配在一起，HTTP 层只做参数搬运。"""

    def __init__(
        self,
        memory: Optional[EphemeralMemory] = None,
        transfers: Optional[TransferRelay] = None,
        token: str = "",
        room: str = ROOM_ID,
        presence_window: float = PRESENCE_WINDOW,
    ) -> None:
        self.memory = memory or EphemeralMemory()
        self.transfers = transfers or TransferRelay()
        self.token = token.strip()
        self.room = room
        self._presence_window = presence_window
        self._presence_lock = threading.Lock()
        self._heartbeats: Dict[str, float] = {}     # client -> 最后一次心跳
        self._seen: Dict[str, float] = {}           # client -> 第一次进房（浏览人数）
        self._lock = threading.Lock()
        self._world_lock = threading.Lock()
        self._world_players: Dict[str, Dict[str, Any]] = {}
        self._world_window = 5.0
        self._world_max_players = 64
        self._rooms_lock = threading.Lock()
        self._rooms: Dict[str, Dict[str, Any]] = {}
        self._room_window = 8.0
        self._room_max_messages = 200

        # 房间由服务端自己开：第一条消息是系统说明，不是用户内容
        code, created = self.memory.ensure_session(self.room, ROOM_MAX_TURNS * 2)
        if code == ERR_OK and created:
            self.memory.add_message(self.room, "system", ROOM_NOTICE)
            logger.info("交流房间已开 id=%s（内容只在内存）", self.room)

    # 认证：设置了 token 才校验，空 token 等于“只监听本机”的开发模式
    def authorized(self, header_token: str, bearer: str) -> bool:
        if not self.token:
            return True
        return header_token == self.token or bearer == self.token

    def heartbeat(self, client: str) -> int:
        """客户端进房/保活。只记 client 与时间，不记任何人做过什么。"""
        client = client.strip()
        if not client or len(client) > 64:
            return ERR_R2_MSG_EMPTY
        now = time.time()
        with self._presence_lock:
            self._heartbeats[client] = now
            if client not in self._seen:
                self._seen[client] = now
            for cid, ts in list(self._heartbeats.items()):
                if now - ts > self._presence_window:
                    del self._heartbeats[cid]
            if len(self._seen) > MAX_VISITORS:      # 浏览集合也有上限，按最早淘汰
                for cid, _ in sorted(self._seen.items(), key=lambda kv: kv[1])[: len(self._seen) // 2]:
                    del self._seen[cid]
        self.memory.ensure_session(self.room, ROOM_MAX_TURNS * 2)
        self.memory.touch(self.room)
        return ERR_OK

    def presence(self) -> Dict[str, Any]:
        now = time.time()
        with self._presence_lock:
            online = sum(1 for ts in self._heartbeats.values()
                         if now - ts <= self._presence_window)
            views = len(self._seen)
        return {
            "room": self.room,
            "online": online,
            "views": views,
            "window": int(self._presence_window),
            "persisted": False,
        }

    def stats(self) -> Dict[str, Any]:
        return {
            "memory": self.memory.stats(),
            "transfer": self.transfers.stats(),
            "presence": self.presence(),
            "world": self.world_snapshot(),
        }

    def world_snapshot(self) -> Dict[str, Any]:
        now = time.time()
        with self._world_lock:
            self._purge_world(now)
            players = [dict(p) for p in self._world_players.values()]
        players.sort(key=lambda p: p["id"])
        return {"players": players, "online": len(players), "window": int(self._world_window)}

    def _purge_world(self, now: float) -> None:
        stale = [pid for pid, p in self._world_players.items()
                 if now - p["seen"] > self._world_window]
        for pid in stale:
            del self._world_players[pid]

    def world_state(self, body: Dict[str, Any]) -> Dict[str, Any]:
        """联机位置通道：只保留最近 5 秒的角色状态，不落盘、不记历史。

        客户端约 8Hz 上报一次，响应里带回同一房间的全部在线角色；这是
        广域网中继上的最小状态同步面，后续可替换为 WebSocket 而不改语义。
        """
        pid = str(body.get("id", "")).strip()
        if not pid or len(pid) > 64:
            raise RelayFault(ERR_R2_MSG_EMPTY, "id 必填，1–64 字符")
        values = []
        for key in ("x", "y", "z", "yaw"):
            value = body.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise RelayFault(ERR_R2_MSG_EMPTY, key + " 必须是数字")
            if not math.isfinite(float(value)):
                raise RelayFault(ERR_R2_MSG_EMPTY, key + " 必须是有限数字")
            values.append(round(float(value), 3))
        clip = str(body.get("clip", "walk"))
        if clip not in ("idle", "walk", "run"):
            clip = "walk"
        room = str(body.get("room", "world-lobby")).strip()
        room = room if self._ROOM_RE.match(room) else "world-lobby"
        name = str(body.get("name", ""))[:24]
        name = "".join(ch for ch in name if ch.isprintable())
        now = time.time()
        with self._world_lock:
            self._purge_world(now)
            if pid not in self._world_players and len(self._world_players) >= self._world_max_players:
                oldest = min(self._world_players.items(), key=lambda kv: kv[1]["seen"])[0]
                del self._world_players[oldest]
            self._world_players[pid] = {
                "id": pid,
                "name": name,
                "room": room,
                "x": values[0], "y": values[1], "z": values[2], "yaw": values[3],
                "clip": clip,
                "seen": now,
            }
            players = [dict(p) for p in self._world_players.values()]
        players = [p for p in players if p.get("room") == room]
        players.sort(key=lambda p: p["id"])
        out = []
        for p in players:
            p["age"] = round(now - p["seen"], 3)
            p.pop("seen", None)
            out.append(p)
        return {"players": out, "online": len(out), "self": pid}

    # ------------------------- 联机房间（聊天 + 成员） -------------------------
    _ROOM_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")

    def _room_id(self, room: str) -> str:
        room = str(room).strip()
        if not self._ROOM_RE.match(room):
            raise RelayFault(ERR_R2_MSG_EMPTY, "房间号只能包含字母、数字、下划线和短横线，1–32 字符")
        return room

    def _purge_room_members(self, room: Dict[str, Any], now: float) -> None:
        stale = [pid for pid, m in room["members"].items()
                 if now - m["seen"] > self._room_window]
        for pid in stale:
            del room["members"][pid]

    def _room_snapshot(self, room_id: str, now: float) -> Dict[str, Any]:
        room = self._rooms.get(room_id)
        if not room:
            return {"room": room_id, "exists": False, "members": [], "messages": []}
        self._purge_room_members(room, now)
        if not room["members"]:
            # 最后一个人也完全下机：房间和聊天记录一起消失。
            del self._rooms[room_id]
            return {"room": room_id, "exists": False, "members": [], "messages": []}
        members = [
            {"id": pid, "name": m["name"], "age": round(now - m["seen"], 2)}
            for pid, m in room["members"].items()
        ]
        members.sort(key=lambda m: m["name"])
        return {
            "room": room_id,
            "exists": True,
            "members": members,
            "messages": list(room["messages"]),
        }

    def room_join(self, room_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
        pid = str(body.get("id", "")).strip()
        if not pid or len(pid) > 64:
            raise RelayFault(ERR_R2_MSG_EMPTY, "id 必填，1–64 字符")
        name = "".join(ch for ch in str(body.get("name", ""))[:24] if ch.isprintable()) or "旅人"
        rid = self._room_id(room_id)
        now = time.time()
        with self._rooms_lock:
            room = self._rooms.get(rid)
            if not room:
                room = self._rooms[rid] = {"members": {}, "messages": [], "created": now}
            self._purge_room_members(room, now)
            room["members"][pid] = {"name": name, "seen": now}
            return self._room_snapshot(rid, now)

    def room_leave(self, room_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
        pid = str(body.get("id", "")).strip()
        rid = self._room_id(room_id)
        now = time.time()
        with self._rooms_lock:
            room = self._rooms.get(rid)
            if not room:
                return {"room": rid, "exists": False, "members": [], "messages": []}
            room["members"].pop(pid, None)
            return self._room_snapshot(rid, now)

    def room_snapshot(self, room_id: str) -> Dict[str, Any]:
        rid = self._room_id(room_id)
        with self._rooms_lock:
            return self._room_snapshot(rid, time.time())

    def room_post(self, room_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
        pid = str(body.get("id", "")).strip()
        if not pid or len(pid) > 64:
            raise RelayFault(ERR_R2_MSG_EMPTY, "id 必填，1–64 字符")
        text = "".join(ch for ch in str(body.get("text", ""))[:200]
                       if ch.isprintable() or ch == " ")
        text = text.strip()
        if not text:
            raise RelayFault(ERR_R2_MSG_EMPTY, "消息不能为空")
        rid = self._room_id(room_id)
        now = time.time()
        with self._rooms_lock:
            room = self._rooms.get(rid)
            if not room:
                room = self._rooms[rid] = {"members": {}, "messages": [], "created": now}
            self._purge_room_members(room, now)
            member = room["members"].get(pid)
            if not member:
                raise RelayFault(ERR_R2_MSG_EMPTY, "先加入房间再发言")
            room["members"][pid]["seen"] = now
            room["messages"].append({
                "id": pid,
                "name": member["name"],
                "text": text,
                "ts": int(now * 1000),
            })
            if len(room["messages"]) > self._room_max_messages:
                del room["messages"][: len(room["messages"]) - self._room_max_messages]
            return self._room_snapshot(rid, now)

    def shutdown(self) -> None:
        self.memory.shutdown()
        self.transfers.shutdown()


class RelayHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    # Windows 的 SO_REUSEADDR 允许两个进程绑同一端口，旧实例会继续接管请求，
    # 内存里的在线/浏览计数也就不会随重启清零；这里只在非 Windows 上启用。
    allow_reuse_address = os.name != "nt"

    def __init__(self, address: Tuple[str, int], app: RelayApp) -> None:
        self.app = app
        super().__init__(address, _Handler)

    @property
    def port(self) -> int:
        return int(self.server_address[1])


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "memory-relay/1.0"

    # 请求体只读一次并缓存：HTTP/1.1 连接是复用的，没读完的字节会粘到下一条请求行上
    _body: Optional[bytes] = None

    def handle_one_request(self) -> None:
        # 一条连接会连续处理多条请求，每条必须重新取体，否则会把上一条的 JSON 当成本条的
        self._body = None
        super().handle_one_request()

    @property
    def app(self) -> RelayApp:
        return self.server.app  # type: ignore[attr-defined]

    # 不落盘、不带内容、不带 token：访问日志只留“方法 + 状态”
    def log_request(self, code: Any = "-", size: Any = "-") -> None:
        logger.info("%s %s", self.command, code)

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        # BaseHTTPRequestHandler 的兜底消息可能含请求行，降到 debug 且不展开
        logger.debug("http: %s", fmt)

    # ------------------------- 基础 -------------------------
    def _send(self, code: int, payload: Optional[Dict[str, Any]] = None) -> None:
        status = http_status(code) if code != ERR_OK else 200
        body = json.dumps(
            {"ok": code == ERR_OK, "magic": MAGIC, "v": VERSION, **(payload or {})},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Relay-Contract", CONTRACT_VERSION)
        self._cors()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, code: int, **extra: Any) -> None:
        payload = as_dict(code)
        payload.update(extra)
        payload.pop("ok", None)
        self._send(code, payload)

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Relay-Token, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        # 跨域下自定义响应头默认对 JS 不可见，契约版本要显式暴露，否则页面只能显示"未知"。
        self.send_header("Access-Control-Expose-Headers", "X-Relay-Contract")

    def _read_body(self, limit: int = MAX_BODY) -> Optional[bytes]:
        if self._body is not None:
            # 已缓存：超过本路由上限就当作不合规，但不再重复读流
            return self._body if len(self._body) <= limit else None
        raw_len = self.headers.get("Content-Length")
        if raw_len is None:
            self._body = b""
            return b""
        try:
            length = int(raw_len)
        except ValueError:
            self.close_connection = True
            return None
        if length <= 0:
            self._body = b""
            return b""
        if length > MAX_BODY:
            # 超上限时不读走私连接的数据，直接断开，避免把残包当成下一条请求
            self.close_connection = True
            return None
        self._body = self.rfile.read(length)
        return self._body if length <= limit else None

    def _json_body(self) -> Optional[Dict[str, Any]]:
        raw = self._read_body(MAX_JSON)
        if raw is None:
            return None
        if not raw:
            return {}
        try:
            obj = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        return obj if isinstance(obj, dict) else None

    def _auth_ok(self) -> bool:
        bearer = ""
        auth = self.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            bearer = auth[7:].strip()
        return self.app.authorized(self.headers.get("X-Relay-Token", ""), bearer)

    # ------------------------- 方法 -------------------------
    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("POST")

    def do_PUT(self) -> None:  # noqa: N802
        self._dispatch("PUT")

    def do_DELETE(self) -> None:  # noqa: N802
        self._dispatch("DELETE")

    def _dispatch(self, method: str) -> None:
        # 先把请求体收干净：即使后面这条路由不需要体，也不能把字节留给下一条请求
        if method in ("POST", "PUT") or self.headers.get("Content-Length"):
            self._read_body()
        if not self._auth_ok():
            token_header = self.headers.get("X-Relay-Token") or self.headers.get("Authorization")
            self._error(ERR_R6_AUTH_MISSING if not token_header else ERR_R6_AUTH_DENIED)
            return
        url = urlsplit(self.path)
        parts = [p for p in url.path.strip("/").split("/") if p]
        query = parse_qs(url.query)

        try:
            routed = self._route(method, parts, query)
        except RelayFault as exc:
            logger.error("%s", exc.render())
            try:
                self._error(exc.code, detail=exc.detail)
            except Exception:
                pass
            return
        except Exception:
            logger.exception("[HTTP] 处理失败 %s", method)
            if not self.wfile.closed:
                try:
                    self._error(ERR_R9_INTERNAL)
                except Exception:
                    pass
            return
        if not routed:
            self._error(ERR_R9_PATH_MISSING)

    def _route(self, method: str, parts: list, query: Dict[str, list]) -> bool:
        mem = self.app.memory
        tr = self.app.transfers

        if parts == ["v1", "health"] and method == "GET":
            self._send(ERR_OK, {"alive": True, "persisted": False})
            return True

        if parts == ["v1", "stats"] and method == "GET":
            self._send(ERR_OK, self.app.stats())
            return True

        if parts == ["v1", "presence"]:
            if method == "GET":
                self._send(ERR_OK, self.app.presence())
                return True
            if method == "POST":
                body = self._json_body()
                if body is None:
                    self._error(ERR_R2_MSG_EMPTY, hint="请求体必须是 JSON 对象")
                    return True
                code = self.app.heartbeat(str(body.get("client", "")))
                if code == ERR_OK:
                    self._send(ERR_OK, self.app.presence())
                else:
                    self._error(code, hint="client 必填，1–64 字符")
                return True

        if parts == ["v1", "world", "state"]:
            if method == "GET":
                self._send(ERR_OK, self.app.world_snapshot())
                return True
            if method == "POST":
                body = self._json_body()
                if body is None:
                    self._error(ERR_R2_MSG_EMPTY, hint="请求体必须是 JSON 对象")
                    return True
                self._send(ERR_OK, self.app.world_state(body))
                return True

        if len(parts) >= 4 and parts[:3] == ["v1", "world", "rooms"]:
            rid = parts[3]
            if len(parts) == 4 and method == "GET":
                self._send(ERR_OK, self.app.room_snapshot(rid))
                return True
            if len(parts) == 5 and parts[4] == "join" and method == "POST":
                body = self._json_body()
                if body is None:
                    self._error(ERR_R2_MSG_EMPTY, hint="请求体必须是 JSON 对象")
                    return True
                self._send(ERR_OK, self.app.room_join(rid, body))
                return True
            if len(parts) == 5 and parts[4] == "leave" and method == "POST":
                body = self._json_body()
                if body is None:
                    self._error(ERR_R2_MSG_EMPTY, hint="请求体必须是 JSON 对象")
                    return True
                self._send(ERR_OK, self.app.room_leave(rid, body))
                return True
            if len(parts) == 5 and parts[4] == "messages" and method == "POST":
                body = self._json_body()
                if body is None:
                    self._error(ERR_R2_MSG_EMPTY, hint="请求体必须是 JSON 对象")
                    return True
                self._send(ERR_OK, self.app.room_post(rid, body))
                return True

        if parts == ["v1", "sessions"]:
            if method == "GET":
                self._send(ERR_OK, {"sessions": mem.list_sessions()})
                return True
            if method == "POST":
                code, sid = mem.create_session()
                if code != ERR_OK or sid is None:
                    self._error(code)
                else:
                    self._send(ERR_OK, {"id": sid, "ttl": mem.stats()["ttl"]})
                return True

        if len(parts) == 3 and parts[:2] == ["v1", "sessions"] and method == "DELETE":
            code = mem.clear_session(parts[2])
            if code == ERR_OK:
                self._send(ERR_OK, {"closed": True})
            else:
                self._error(code)
            return True

        if len(parts) == 4 and parts[:2] == ["v1", "sessions"] and parts[3] == "messages" and method == "POST":
            body = self._json_body()
            if body is None:
                self._error(0x020101, hint="请求体必须是 JSON 对象")
                return True
            code = mem.add_message(parts[2], str(body.get("role", "")), body.get("content", ""))
            if code == ERR_OK:
                self._send(ERR_OK, {"accepted": True})
            else:
                self._error(code)
            return True

        if len(parts) == 4 and parts[:2] == ["v1", "sessions"] and parts[3] == "context" and method == "GET":
            limit = 0
            if query.get("limit"):
                try:
                    limit = int(query["limit"][0])
                except ValueError:
                    limit = 0
            code, turns = mem.get_context(parts[2], limit)
            if code == ERR_OK:
                self._send(ERR_OK, {"id": parts[2], "messages": turns})
            else:
                self._error(code)
            return True

        if parts == ["v1", "transfers"] and method == "POST":
            body = self._json_body()
            if body is None:
                self._error(0x050102, hint="请求体必须是 JSON 对象")
                return True
            code, token, info = tr.create(str(body.get("session_id", "")), str(body.get("name", "file")))
            if code == ERR_OK:
                self._send(ERR_OK, {"token": token, "transfer": info})
            else:
                self._error(code)
            return True

        if len(parts) == 4 and parts[:2] == ["v1", "transfers"] and parts[3] == "chunks" and method == "PUT":
            raw = self._read_body(MAX_BODY)
            if raw is None:
                self._error(0x050203)
                return True
            code = tr.put(parts[2], raw)
            if code == ERR_OK:
                self._send(ERR_OK, {"accepted": len(raw)})
            else:
                self._error(code)
            return True

        if len(parts) == 4 and parts[:2] == ["v1", "transfers"] and parts[3] == "end" and method == "POST":
            code = tr.end(parts[2])
            if code == ERR_OK:
                self._send(ERR_OK, {"sealed": True})
            else:
                self._error(code)
            return True

        if len(parts) == 4 and parts[:2] == ["v1", "transfers"] and parts[3] == "info" and method == "GET":
            code, info = tr.info(parts[2])
            if code == ERR_OK:
                self._send(ERR_OK, {"transfer": info})
            else:
                self._error(code)
            return True

        if len(parts) == 3 and parts[:2] == ["v1", "transfers"]:
            if method == "DELETE":
                code = tr.close(parts[2], reason="client delete")
                if code == ERR_OK:
                    self._send(ERR_OK, {"closed": True})
                else:
                    self._error(code)
                return True
            if method == "GET":
                self._stream_transfer(parts[2])
                return True

        return False

    # ------------------------- 流式下载 -------------------------
    def _stream_transfer(self, token: str) -> None:
        tr = self.app.transfers
        code, _info = tr.info(token)
        if code != ERR_OK:
            self._error(ERR_R5_TRANSFER_MISSING)
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "close")
        self._cors()
        self.end_headers()
        self.close_connection = True

        received = 0
        try:
            while True:
                code, chunk = tr.take(token, timeout=30.0)
                if code != ERR_OK:
                    # 超时 / 已被取走 / 不存在：直接断流，不补写错误体
                    logger.info("[R5] 流中断 %s… code=%s", token[:6], error_hex(code))
                    break
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
                received += len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            tr.close(token, reason="receiver disconnected")
        finally:
            logger.info("[R5] 流结束 %s… bytes=%s", token[:6], received)


def build_server(app: RelayApp, host: str = "127.0.0.1", port: int = 8790) -> RelayHTTPServer:
    return RelayHTTPServer((host, port), app)
