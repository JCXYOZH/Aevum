"""MrHua 对话 HTTP 适配层。

前端 `app-shell.js` 发送的是 `POST /api/chat/stream_token`（SSE）与
`POST /api/chat/with_file`（普通 JSON）。这里把消息接到桌面监控服务已经实现的
本地模型生成函数，不再假设旧项目里的 `/api/chat` 后端仍然存在。
"""

from __future__ import annotations

import json
import threading
from typing import Any, Callable, Dict, Optional

MAX_BODY = 1_000_000
MAX_FILE_CHARS = 120_000
MAX_HISTORY_TURNS = 6


class ChatAPI:
    def __init__(self, auth_api, generate: Callable[[dict], tuple[dict, int]]) -> None:
        self.auth = auth_api
        self.generate = generate
        self._lock = threading.Lock()
        self._histories: Dict[str, list[dict]] = {}
        self._cancelled: Dict[str, threading.Event] = {}

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

    def _conversation_id(self, handler, user) -> str:
        return f"{user.user_id}"

    def _remember(self, conversation: str, role: str, text: str) -> None:
        with self._lock:
            history = self._histories.setdefault(conversation, [])
            history.append({"role": role, "text": text})
            if len(history) > MAX_HISTORY_TURNS * 2:
                del history[: len(history) - MAX_HISTORY_TURNS * 2]

    def _prompt(self, conversation: str, message: str, file_context: str = "") -> str:
        with self._lock:
            history = list(self._histories.get(conversation, []))
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

    def _start_sse(self, handler) -> None:
        handler.send_response(200)
        handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
        handler.send_header("Cache-Control", "no-cache")
        handler.send_header("Connection", "close")
        handler.send_header("X-Accel-Buffering", "no")
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
        user = self.auth.current_user(handler)
        if user is None:
            handler._send_json({"success": False, "error": "请先登录", "message": "请先登录"}, 401)
            return
        body = self.read_json(handler) or {}
        message = str(body.get("message", "")).strip()
        if not message:
            handler._send_json({"success": False, "error": "消息不能为空", "message": "消息不能为空"}, 400)
            return
        conversation = self._conversation_id(handler, user)
        cancel = threading.Event()
        with self._lock:
            self._cancelled[conversation] = cancel

        self._start_sse(handler)
        self._sse(handler, {"type": "tool_status", "content": "正在调用本地模型…"})
        prompt = self._prompt(conversation, message)
        payload, status = self.generate({
            "prompt": prompt,
            "max_new_tokens": int(body.get("max_new_tokens", 96)),
            "temperature": float(body.get("temperature", 0.8)),
            "device": str(body.get("device", "cpu")),
        })
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
        user = self.auth.current_user(handler)
        if user is None:
            handler._send_json({"success": False, "error": "请先登录", "message": "请先登录"}, 401)
            return
        body = self.read_json(handler) or {}
        message = str(body.get("message", "")).strip() or "请分析这个文件"
        file_name = str(body.get("file_name", "")).strip()
        file_content = str(body.get("file_content", ""))
        conversation = self._conversation_id(handler, user)
        prompt = self._prompt(conversation, message, f"[{file_name}]\n{file_content}")
        payload, _ = self.generate({
            "prompt": prompt,
            "max_new_tokens": int(body.get("max_new_tokens", 96)),
            "temperature": float(body.get("temperature", 0.8)),
            "device": str(body.get("device", "cpu")),
        })
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
        user = self.auth.current_user(handler)
        if user is None:
            handler._send_json({"success": False, "error": "请先登录", "message": "请先登录"}, 401)
            return
        conversation = self._conversation_id(handler, user)
        with self._lock:
            self._histories.pop(conversation, None)
        handler._send_json({"success": True})

    def cancel(self, handler) -> None:
        user = self.auth.current_user(handler)
        if user is not None:
            with self._lock:
                event = self._cancelled.get(self._conversation_id(handler, user))
            if event is not None:
                event.set()
        handler._send_json({"success": True})
