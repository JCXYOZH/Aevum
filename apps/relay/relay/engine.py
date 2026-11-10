# ============================================================
# relay/engine.py — 装配层（DAG 第 4 层）
#
# 把三块拼成一个中继引擎：
#   relay/memory.py   会话记忆（R1/R2/R3/R4）
#   relay/transfer.py 流式文件转发（R5）
#   relay/server.py   HTTP 面（R9），访问控制 R6
#
# 这个文件本身不做任何存储决策，只决定“装配成什么形状”。
# 进程入口在 relay/__main__.py，先过 bootstrap 自检。
# ============================================================
from __future__ import annotations

import logging
import os
import threading
from typing import Any, Dict, Optional

from relay.memory import EphemeralMemory
from relay.server import RelayApp, RelayHTTPServer, build_server
from relay.transfer import TransferRelay

logger = logging.getLogger(__name__)

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8790


class RelayEngine:
    """一个进程内的一套中继：一份记忆 + 一份传输 + 可选 HTTP 面。"""

    def __init__(
        self,
        *,
        session_ttl: int = 600,
        max_turns: int = 20,
        max_sessions: int = 2000,
        max_chars_per_message: int = 64_000,
        max_chars_per_session: int = 512_000,
        transfer_ttl: int = 120,
        max_chunk: int = 1_048_576,
        max_transfers: int = 128,
        total_buffer: int = 32 * 1_048_576,
        token: str = "",
    ) -> None:
        self.memory = EphemeralMemory(
            ttl=session_ttl,
            max_turns=max_turns,
            max_sessions=max_sessions,
            max_chars_per_message=max_chars_per_message,
            max_chars_per_session=max_chars_per_session,
        )
        self.transfers = TransferRelay(
            ttl=transfer_ttl,
            max_chunk=max_chunk,
            max_transfers=max_transfers,
            total_buffer=total_buffer,
        )
        self.app = RelayApp(self.memory, self.transfers, token=token)
        self._server: Optional[RelayHTTPServer] = None
        self._http_thread: Optional[threading.Thread] = None

    # ------------------------- HTTP -------------------------
    def start_http(self, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> RelayHTTPServer:
        if self._server is not None:
            return self._server
        server = build_server(self.app, host, port)
        self._server = server
        self._http_thread = threading.Thread(
            target=server.serve_forever,
            name="memory-relay-http",
            daemon=True,
        )
        self._http_thread.start()
        logger.info("中继 HTTP 已启动 http://%s:%s", host, server.port)
        return server

    @property
    def port(self) -> Optional[int]:
        return self._server.port if self._server is not None else None

    # ------------------------- 生命周期 -------------------------
    def stats(self) -> Dict[str, Any]:
        return self.app.stats()

    def shutdown(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None
        self.app.shutdown()
        logger.info("中继已关闭")

    # ------------------------- 便捷入口 -------------------------
    def create_session(self) -> Any:
        return self.memory.create_session()

    def append(self, sid: str, role: str, content: str) -> int:
        return self.memory.add_message(sid, role, content)

    def context(self, sid: str, limit: int = 0) -> Any:
        return self.memory.get_context(sid, limit)


_engine: Optional[RelayEngine] = None
_engine_lock = threading.Lock()


def get_relay() -> RelayEngine:
    """进程级单例：按环境变量装配一次。"""
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                _engine = RelayEngine(
                    session_ttl=int(os.environ.get("RELAY_SESSION_TTL", "600")),
                    max_turns=int(os.environ.get("RELAY_MAX_TURNS", "20")),
                    max_sessions=int(os.environ.get("RELAY_MAX_SESSIONS", "2000")),
                    transfer_ttl=int(os.environ.get("RELAY_TRANSFER_TTL", "120")),
                    token=os.environ.get("RELAY_TOKEN", ""),
                )
    return _engine


# 兼容旧草稿里的名字，语义不变：拿到的都是同一套中继
get_memory_relay = get_relay
