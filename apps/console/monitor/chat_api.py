"""MrHua 对话 HTTP 适配层。

前端 `app-shell.js` 发送的是 `POST /api/chat/stream_token`（SSE）与
`POST /api/chat/with_file`（普通 JSON）。这里把消息接到桌面监控服务已经实现的
本地模型生成函数，不再假设旧项目里的 `/api/chat` 后端仍然存在。
"""

from __future__ import annotations

import json
import threading
from typing import Any, Callable, Dict, Optional

try:
    from .api.visitor import (
        chat_history_path,
        consume_quota,
        new_guest_id,
        quota_status,
        read_json_file,
        scope_for_guest,
        scope_for_user,
        visitor_cookie_header,
        visitor_id_from_handler,
        write_json_file,
    )
except ImportError:  # 以脚本方式启动 desktop_server 时的兼容路径
    from api.visitor import (
        chat_history_path,
        consume_quota,
        new_guest_id,
        quota_status,
        read_json_file,
        scope_for_guest,
        scope_for_user,
        visitor_cookie_header,
        visitor_id_from_handler,
        write_json_file,
    )

MAX_BODY = 1_000_000
MAX_FILE_CHARS = 120_000
MAX_HISTORY_TURNS = 6


class ChatAPI:
    def __init__(self, auth_api, generate: Callable[..., tuple[dict, int]],
                 on_scope: Optional[Callable[[str], None]] = None) -> None:
        self.auth = auth_api
        self.generate = generate
        self.on_scope = on_scope
        self._lock = threading.Lock()
        self._histories: Dict[str, list[dict]] = {}
        self._cancelled: Dict[str, threading.Event] = {}

    def _notify_scope(self, scope: str) -> None:
        if self.on_scope is not None and scope:
            try:
                self.on_scope(scope)
            except Exception:
                pass

    # ---------------------------------------------------------------- 工具
    @staticmethod
    def read_json(handler) -> Optional[dict]:
        try:
            length = int(handler.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                return None
            return json.loads(handler.rfile.read(length).decode("utf-8"))
        except (OSError, ValueError, TypeError):
            return None

    def _actor(self, handler, create_guest: bool = False) -> tuple[str, Any, str, bool]:
        """返回 (data_scope, user, set_cookie, is_guest)。

        data_scope 是唯一的会话键，也是本机目录名；它不含路径。访客没有 Cookie
        时由服务端签发，前端传来的 user_id 不再作为身份依据。
        """
        user = self.auth.current_user(handler)
        if user is not None:
            return scope_for_user(user.user_id), user, "", False
        visitor_id = visitor_id_from_handler(handler)
        if not visitor_id and create_guest:
            visitor_id = new_guest_id()
            return scope_for_guest(visitor_id), None, visitor_cookie_header(visitor_id), True
        if visitor_id:
            return scope_for_guest(visitor_id), None, "", True
        return "", None, "", True

    def _conversation_id(self, handler, user) -> str:
        if user is not None:
            return scope_for_user(user.user_id)
        return scope_for_guest(visitor_id_from_handler(handler) or new_guest_id())

    def _history(self, conversation: str) -> list[dict]:
        with self._lock:
            history = self._histories.get(conversation)
        if history is None:
            raw = read_json_file(chat_history_path(conversation), [])
            history = [
                {"role": str(item.get("role", "")), "text": str(item.get("text", ""))}
                for item in raw if isinstance(item, dict)
            ][-MAX_HISTORY_TURNS * 2:]
            with self._lock:
                history = self._histories.setdefault(conversation, history)
        return list(history)

    def _remember(self, conversation: str, role: str, text: str) -> None:
        with self._lock:
            history = self._histories.setdefault(conversation, [])
            history.append({"role": role, "text": text})
            if len(history) > MAX_HISTORY_TURNS * 2:
                del history[: len(history) - MAX_HISTORY_TURNS * 2]
            snapshot = list(history)
        try:
            write_json_file(chat_history_path(conversation), snapshot)
        except OSError:
            pass

    def _clear_history(self, conversation: str) -> None:
        with self._lock:
            self._histories.pop(conversation, None)
        try:
            chat_history_path(conversation).unlink(missing_ok=True)
        except OSError:
            pass

    def _prompt(self, conversation: str, message: str, file_context: str = "") -> str:
        history = self._history(conversation)
        lines = []
        for turn in history[-MAX_HISTORY_TURNS:]:
            lines.append(f"{'用户' if turn['role'] == 'user' else '助手'}: {turn['text']}")
        if file_context:
            lines.append(f"用户提供的文件内容:\n{file_context[:MAX_FILE_CHARS]}")
        lines.append(f"用户: {message}")
        lines.append("助手:")
        return "\n".join(lines)

    @staticmethod
    def _sse(handler, payload: dict) -> None:
        body = ("data: " + json.dumps(payload, ensure_ascii=False) + "\n\n").encode("utf-8")
        handler.wfile.write(body)
        handler.wfile.flush()

    def _start_sse(self, handler, cookie: str = "") -> None:
        handler.send_response(200)
        handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
        handler.send_header("Cache-Control", "no-cache")
        handler.send_header("Connection", "close")
        handler.send_header("X-Accel-Buffering", "no")
        if cookie:
            handler.send_header("Set-Cookie", cookie)
        handler.end_headers()

    # ---------------------------------------------------------------- 路由
    def handle_post(self, handler, route: str) -> bool:
        if route == "/api/chat/stream_token":
            self.stream(handler)
            return True
        if route == "/api/chat/with_file":
            self.with_file(handler)
            return True
        if route == "/api/chat/new_session":
            self.new_session(handler)
            return True
        if route == "/api/chat/cancel":
            self.cancel(handler)
            return True
        return False

    def stream(self, handler) -> None:
        scope, user, cookie, is_guest = self._actor(handler, create_guest=True)
        if not scope:
            handler._send_json({"success": False, "error": "请先登录", "message": "请先登录"}, 401)
            return
        self._notify_scope(scope)
        body = self.read_json(handler) or {}
        message = str(body.get("message", "")).strip()
        if not message:
            handler._send_json({"success": False, "error": "消息不能为空", "message": "消息不能为空"}, 400)
            return
        if is_guest:
            quota = quota_status(scope)
            if quota["exhausted"]:
                handler._send_json({
                    "success": False,
                    "error": "今日访客额度已用完，登录后继续",
                    "message": "今日访客额度已用完，登录后继续",
                    "quota": quota,
                    "login_url": "/mrhua/",
                }, 429)
                return
            quota = consume_quota(scope)
        else:
            quota = {"limit": None, "used": 0, "remaining": None, "exhausted": False}
        conversation = scope
        cancel = threading.Event()
        with self._lock:
            self._cancelled[conversation] = cancel

        self._start_sse(handler, cookie)
        self._sse(handler, {
            "type": "session",
            "data_scope": scope,
            "role": "guest" if is_guest else str(getattr(user, "role", "member") or "member"),
            "quota": quota,
        })
        self._sse(handler, {"type": "tool_status", "content": "正在调用模型…"})
        prompt = self._prompt(conversation, message)
        payload, status = self.generate({
            "prompt": prompt,
            "max_new_tokens": min(512, max(24, int(body.get("max_new_tokens", 512))) if not is_guest else 128),
            "temperature": float(body.get("temperature", 0.8)),
            "device": str(body.get("device", "cpu")),
        }, scope=scope)
        if cancel.is_set():
            self._sse(handler, {"type": "done"})
            return
        if not payload.get("ok"):
            error = str(payload.get("message") or payload.get("stderr") or "本地模型生成失败")
            self._sse(handler, {"type": "error", "content": error[-1200:]})
            return
        text = str(payload.get("text", ""))
        # 本地生成器一次返回整段文本；按小段推送，前端仍然走同一套 SSE 渲染。
        for index in range(0, len(text), 12):
            if cancel.is_set():
                break
            self._sse(handler, {"type": "chunk", "content": text[index:index + 12]})
        if not cancel.is_set():
            self._sse(handler, {"type": "done"})
            self._remember(conversation, "user", message)
            self._remember(conversation, "assistant", text)

    def with_file(self, handler) -> None:
        scope, user, _cookie, is_guest = self._actor(handler, create_guest=False)
        if user is None or is_guest:
            handler._send_json({"success": False, "error": "文件分析需要登录", "message": "文件分析需要登录"}, 401)
            return
        body = self.read_json(handler) or {}
        message = str(body.get("message", "")).strip() or "请分析这个文件"
        file_name = str(body.get("file_name", "")).strip()
        file_content = str(body.get("file_content", ""))
        conversation = scope or self._conversation_id(handler, user)
        prompt = self._prompt(conversation, message, f"[{file_name}]\n{file_content}")
        payload, _ = self.generate({
            "prompt": prompt,
            "max_new_tokens": min(512, max(24, int(body.get("max_new_tokens", 512)))),
            "temperature": float(body.get("temperature", 0.8)),
            "device": str(body.get("device", "cpu")),
        }, scope=conversation)
        if not payload.get("ok"):
            handler._send_json({
                "success": False,
                "error": str(payload.get("message") or payload.get("stderr") or "本地模型生成失败")[-1200:],
            }, 500)
            return
        reply = str(payload.get("text", ""))
        self._remember(conversation, "user", f"{message}\n[文件: {file_name}]")
        self._remember(conversation, "assistant", reply)
        handler._send_json({"success": True, "reply": reply, "file_name": file_name})

    def new_session(self, handler) -> None:
        scope, user, cookie, _is_guest = self._actor(handler, create_guest=True)
        if not scope:
            handler._send_json({"success": False, "error": "请先登录", "message": "请先登录"}, 401)
            return
        self._notify_scope(scope)
        self._clear_history(scope)
        handler._send_json({"success": True}, headers={"Set-Cookie": cookie} if cookie else None)

    def cancel(self, handler) -> None:
        scope, _user, _cookie, _is_guest = self._actor(handler, create_guest=False)
        if scope:
            with self._lock:
                event = self._cancelled.get(scope)
            if event is not None:
                event.set()
        handler._send_json({"success": True})
