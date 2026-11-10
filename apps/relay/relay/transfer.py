# ============================================================
# transfer.py — 纯内存流式中继（文件不落盘、不整包驻留）
#
# 工作方式：
#   发送端按分片 PUT，进入有界内存缓冲；
#   接收端 GET，按到达顺序逐片取走，取走即释放；
#   两端不需要同时在线超过一个缓冲区的量：典型内存占用
#   = 缓冲区上限，而不是文件大小。
#
# 硬约束：
#   * 分组上限 max_chunk（默认 1 MiB），防止单次请求撑爆进程；
#   * 单条传输缓冲区上限 + 全局预算，超出就返回 0x050303 背压；
#   * 无人接收的传输在 TTL 后整条丢弃；
#   * 接收端取到 EOF 后传输对象立刻从字典移除。
#
# 责任划分：R5 文件中继（R3 的容量上限仍复用内存守卫的码）。
# ============================================================
from __future__ import annotations

import logging
import secrets
import threading
import time
from collections import deque
from typing import Deque, Dict, Optional, Tuple

from relay.codes import (
    ERR_OK,
    ERR_R3_CAPACITY_EXCEEDED,
    ERR_R5_BUFFER_FULL,
    ERR_R5_CHUNK_EMPTY,
    ERR_R5_CHUNK_TOO_LARGE,
    ERR_R5_TRANSFER_CONSUMED,
    ERR_R5_TRANSFER_MISSING,
    ERR_R5_TRANSFER_TIMEOUT,
)

logger = logging.getLogger(__name__)


class _Budget:
    """全局缓冲预算：所有传输共享同一份额度，避免 N 条传输各占满上限。"""

    __slots__ = ("limit", "used", "_lock")

    def __init__(self, limit: int) -> None:
        self.limit = max(1, int(limit))
        self.used = 0
        self._lock = threading.Lock()

    def reserve(self, size: int) -> bool:
        with self._lock:
            if self.used + size > self.limit:
                return False
            self.used += size
            return True

    def release(self, size: int) -> None:
        with self._lock:
            self.used = max(0, self.used - size)

    def snapshot(self) -> Dict[str, int]:
        with self._lock:
            return {"used": self.used, "limit": self.limit}


class ChunkStream:
    """一条正在传输的文件：有界队列 + 条件变量。"""

    __slots__ = (
        "token", "session_id", "name", "created_at", "last_active", "expires_at",
        "max_chunk", "max_buffer", "_chunks", "_buffered", "_budget",
        "_eof", "_closed", "_receiver_seen", "_sent_bytes", "_cond",
    )

    def __init__(
        self,
        *,
        token: str,
        session_id: str,
        name: str,
        ttl: int,
        max_chunk: int,
        max_buffer: int,
        budget: _Budget,
    ) -> None:
        self.token = token
        self.session_id = session_id
        self.name = name
        self.created_at = time.time()
        self.last_active = self.created_at
        self.expires_at = self.created_at + ttl
        self.max_chunk = max_chunk
        self.max_buffer = max_buffer
        self._chunks: Deque[bytes] = deque()
        self._buffered = 0
        self._budget = budget
        self._eof = False
        self._closed = False
        self._receiver_seen = False
        self._sent_bytes = 0
        self._cond = threading.Condition()

    # ------------------------- 发送侧 -------------------------
    def put(self, data: bytes) -> int:
        if not isinstance(data, (bytes, bytearray, memoryview)):
            return ERR_R5_CHUNK_EMPTY
        payload = bytes(data)
        size = len(payload)
        if size == 0:
            return ERR_R5_CHUNK_EMPTY
        if size > self.max_chunk:
            return ERR_R5_CHUNK_TOO_LARGE

        with self._cond:
            if self._closed or self._eof:
                return ERR_R5_TRANSFER_CONSUMED
            if self._buffered + size > self.max_buffer:
                return ERR_R5_BUFFER_FULL
            if not self._budget.reserve(size):
                return ERR_R5_BUFFER_FULL
            self._chunks.append(payload)
            self._buffered += size
            self._sent_bytes += size
            self.last_active = time.time()
            self._cond.notify_all()
            return ERR_OK

    def end(self) -> int:
        """发送端声明写完了；接收端把已排队的片取完后即结束。"""
        with self._cond:
            if self._closed:
                return ERR_R5_TRANSFER_CONSUMED
            self._eof = True
            self.last_active = time.time()
            self._cond.notify_all()
            return ERR_OK

    # ------------------------- 接收侧 -------------------------
    def take(self, timeout: float) -> Tuple[int, bytes]:
        """取下一片。返回 (ERR_OK, b"") 表示正常结束。

        timeout 是“等待下一片”的上限，不是整条传输的上限：
        发送端持续在写时，每一片都可以重新等 timeout。
        """
        deadline = time.time() + max(0.1, float(timeout))
        with self._cond:
            self._receiver_seen = True
            while True:
                if self._closed:
                    return ERR_R5_TRANSFER_CONSUMED, b""
                if self._chunks:
                    payload = self._chunks.popleft()
                    size = len(payload)
                    self._buffered -= size
                    self._budget.release(size)
                    self.last_active = time.time()
                    self._cond.notify_all()   # 唤醒因缓冲区满而等待的发送端
                    return ERR_OK, payload
                if self._eof:
                    self._closed = True
                    return ERR_OK, b""
                remaining = deadline - time.time()
                if remaining <= 0:
                    return ERR_R5_TRANSFER_TIMEOUT, b""
                self._cond.wait(min(remaining, 1.0))

    def close(self, drain: bool = False) -> None:
        """中止/收尾：释放缓冲并唤醒两端。"""
        with self._cond:
            if not drain:
                released = self._buffered
                self._chunks.clear()
                self._buffered = 0
                if released:
                    self._budget.release(released)
            else:
                released = self._buffered
                self._buffered = 0
                if released:
                    self._budget.release(released)
                self._chunks.clear()
            self._closed = True
            self._cond.notify_all()

    # ------------------------- 状态 -------------------------
    def expired(self, now: float) -> bool:
        return now >= self.expires_at

    def snapshot(self) -> Dict[str, object]:
        with self._cond:
            return {
                "token": self.token,
                "session_id": self.session_id,
                "name": self.name,
                "bytes_sent": self._sent_bytes,
                "buffered_bytes": self._buffered,
                "eof": self._eof,
                "receiver_seen": self._receiver_seen,
                "age": round(time.time() - self.created_at, 1),
                "expires_in": max(0, round(self.expires_at - time.time(), 1)),
            }


class TransferRelay:
    """传输管理器：创建 / 写入 / 取走 / 到期清理。"""

    def __init__(
        self,
        *,
        ttl: int = 120,
        max_chunk: int = 1_048_576,
        max_buffer_per_transfer: int = 4 * 1_048_576,
        max_transfers: int = 128,
        total_buffer: int = 32 * 1_048_576,
        gc_interval: int = 30,
    ) -> None:
        self._ttl = max(1, int(ttl))
        self._max_chunk = max(1, int(max_chunk))
        self._max_buffer = max(self._max_chunk, int(max_buffer_per_transfer))
        self._max_transfers = max(1, int(max_transfers))
        self._budget = _Budget(total_buffer)
        self._gc_interval = max(1, int(gc_interval))

        self._transfers: Dict[str, ChunkStream] = {}
        self._lock = threading.RLock()
        self._stop = threading.Event()

        self._created_total = 0
        self._finished_total = 0
        self._expired_total = 0
        self._rejected_total = 0

        self._gc_thread = threading.Thread(
            target=self._gc_loop, name="transfer-relay-gc", daemon=True
        )
        self._gc_thread.start()
        logger.info(
            "流式中继已启动 ttl=%ss chunk=%s buffer=%s transfers=%s total_buffer=%s",
            self._ttl, self._max_chunk, self._max_buffer, self._max_transfers,
            self._budget.limit,
        )

    # ------------------------- 生命周期 -------------------------
    def create(self, session_id: str = "", name: str = "") -> Tuple[int, Optional[str], Dict[str, object]]:
        with self._lock:
            self._purge_locked(time.time())
            if len(self._transfers) >= self._max_transfers:
                self._rejected_total += 1
                return ERR_R3_CAPACITY_EXCEEDED, None, {}
            token = secrets.token_urlsafe(12)
            while token in self._transfers:
                token = secrets.token_urlsafe(12)
            stream = ChunkStream(
                token=token,
                session_id=str(session_id or "")[:32],
                name=str(name or "file")[:128],
                ttl=self._ttl,
                max_chunk=self._max_chunk,
                max_buffer=self._max_buffer,
                budget=self._budget,
            )
            self._transfers[token] = stream
            self._created_total += 1
            return ERR_OK, token, stream.snapshot()

    def put(self, token: str, data: bytes) -> int:
        with self._lock:
            stream = self._live_locked(token)
            if stream is None:
                return ERR_R5_TRANSFER_MISSING
        return stream.put(data)

    def end(self, token: str) -> int:
        with self._lock:
            stream = self._live_locked(token)
            if stream is None:
                return ERR_R5_TRANSFER_MISSING
        return stream.end()

    def take(self, token: str, timeout: float = 20.0) -> Tuple[int, bytes]:
        with self._lock:
            stream = self._live_locked(token)
            if stream is None:
                return ERR_R5_TRANSFER_MISSING, b""
        code, payload = stream.take(timeout)
        if code == ERR_OK and payload == b"":
            # 正常收尾：这条传输的生命周期结束，对象立刻释放
            self._finish(token, stream)
        return code, payload

    def close(self, token: str, reason: str = "") -> int:
        with self._lock:
            stream = self._transfers.pop(token, None)
            if stream is None:
                return ERR_R5_TRANSFER_MISSING
        stream.close()
        self._finished_total += 1
        if reason:
            logger.info("[R5] 传输中止 token=%s… reason=%s", token[:6], reason)
        return ERR_OK

    def info(self, token: str) -> Tuple[int, Dict[str, object]]:
        with self._lock:
            stream = self._live_locked(token)
            if stream is None:
                return ERR_R5_TRANSFER_MISSING, {}
            return ERR_OK, stream.snapshot()

    def stats(self) -> Dict[str, object]:
        now = time.time()
        with self._lock:
            self._purge_locked(now)
            return {
                "transfers": len(self._transfers),
                "max_transfers": self._max_transfers,
                "created_total": self._created_total,
                "finished_total": self._finished_total,
                "expired_total": self._expired_total,
                "rejected_total": self._rejected_total,
                "ttl": self._ttl,
                "max_chunk": self._max_chunk,
                "buffer_per_transfer": self._max_buffer,
                "buffer": self._budget.snapshot(),
                "persisted": False,
            }

    def purge(self) -> int:
        with self._lock:
            return self._purge_locked(time.time())

    def shutdown(self) -> None:
        self._stop.set()
        if self._gc_thread.is_alive():
            self._gc_thread.join(timeout=1.0)
        with self._lock:
            for stream in self._transfers.values():
                stream.close()
            self._transfers.clear()
        logger.info("流式中继已关闭，所有缓冲已释放")

    # ------------------------- 内部 -------------------------
    def _live_locked(self, token: str) -> Optional[ChunkStream]:
        stream = self._transfers.get(token)
        if stream is None:
            return None
        if stream.expired(time.time()):
            self._transfers.pop(token, None)
            stream.close()
            self._expired_total += 1
            return None
        return stream

    def _finish(self, token: str, stream: ChunkStream) -> None:
        with self._lock:
            if self._transfers.pop(token, None) is not None:
                self._finished_total += 1
        stream.close()

    def _purge_locked(self, now: float) -> int:
        expired = [t for t, s in self._transfers.items() if s.expired(now)]
        for token in expired:
            stream = self._transfers.pop(token, None)
            if stream is not None:
                stream.close()
        self._expired_total += len(expired)
        return len(expired)

    def _gc_loop(self) -> None:
        while not self._stop.wait(self._gc_interval):
            try:
                removed = self.purge()
                if removed:
                    logger.info("[GC] 清理 %s 条过期传输", removed)
            except Exception:
                logger.exception("[GC] 传输清理失败")
