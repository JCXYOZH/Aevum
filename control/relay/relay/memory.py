# ============================================================
# memory.py — 纯内存中继记忆
#
# 契约：
#   1. 不落盘。本模块没有任何 open()/json.dump/sqlite/tempfile 调用，
#      进程退出、会话关闭、TTL 到期，内容立即从内存消失。
#   2. 会话是唯一作用域。没有跨会话的长期记忆，没有衰减、没有整合、
#      没有向量索引、没有后台重建。
#   3. 有上限。单条消息、单会话总字数、会话总数三道上限，任一触发
#      都不会把进程拖进 OOM。
#   4. 只记录，不解释。消息按追加顺序保存，满窗口时弹出最旧的。
#
# 责任划分（0xRRFFTT 的 RR 段）：
#   R1 会话管理   R2 消息管理   R3 内存守卫   R4 到期清理
# ============================================================
from __future__ import annotations

import logging
import secrets
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, List, Optional, Tuple

from relay.codes import (  # 0xRRFFTT 的唯一归属是 contracts/errors.json
    ERR_OK,
    ERR_R1_SESSION_MISSING,
    ERR_R1_SESSION_EXPIRED,
    ERR_R2_MSG_EMPTY,
    ERR_R2_MSG_LIMIT,
    ERR_R2_MSG_TOO_LARGE,
    ERR_R2_ROLE_INVALID,
    ERR_R3_CAPACITY_EXCEEDED,
    ERR_R3_SESSION_BUDGET_EXCEEDED,
    error_hex,
    error_message,
    error_name,
)

logger = logging.getLogger(__name__)

ALLOWED_ROLES = ("user", "assistant", "system", "tool")


@dataclass(slots=True)
class Turn:
    """一条已发生的对话。只存在于内存。"""

    role: str
    content: str
    ts: float
    chars: int

    def to_dict(self) -> Dict[str, object]:
        return {"role": self.role, "content": self.content, "ts": round(self.ts, 3)}


class _Session:
    __slots__ = ("sid", "created_at", "last_active", "turns", "chars", "max_messages")

    def __init__(self, sid: str, max_messages: int) -> None:
        self.sid = sid
        self.created_at = time.time()
        self.last_active = self.created_at
        self.turns: Deque[Turn] = deque()
        self.chars = 0
        # 单会话窗口可以不同：一次性会话用默认值，交流房间单独放大
        self.max_messages = max_messages


class EphemeralMemory:
    """会话内的纯内存对话记忆。

    参数含义：
      ttl                      最后活跃后还能活多久（秒）
      max_turns                单会话保留的“轮”数，1 轮 = user + assistant
      max_sessions             全局并发会话上限（防 OOM 的第一道闸）
      max_chars_per_message    单条消息字数上限
      max_chars_per_session    单会话累计字数上限（超出则弹最旧的消息）
      gc_interval              后台清理扫描间隔（秒）
    """

    def __init__(
        self,
        *,
        ttl: int = 600,
        max_turns: int = 20,
        max_sessions: int = 2000,
        max_chars_per_message: int = 64_000,
        max_chars_per_session: int = 512_000,
        gc_interval: int = 30,
    ) -> None:
        self._ttl = max(1, int(ttl))
        self._max_messages = max(2, int(max_turns) * 2)
        self._max_sessions = max(1, int(max_sessions))
        self._max_chars_per_message = max(1, int(max_chars_per_message))
        self._max_chars_per_session = max(1, int(max_chars_per_session))
        self._gc_interval = max(1, int(gc_interval))

        self._sessions: Dict[str, _Session] = {}
        self._lock = threading.RLock()
        self._stop = threading.Event()

        # 只记数量，不记内容
        self._created_total = 0
        self._closed_total = 0
        self._expired_total = 0
        self._rejected_total = 0

        self._gc_thread = threading.Thread(
            target=self._gc_loop, name="memory-relay-gc", daemon=True
        )
        self._gc_thread.start()
        logger.info(
            "纯内存记忆已启动 ttl=%ss max_turns=%s max_sessions=%s session_budget_chars=%s",
            self._ttl,
            self._max_messages // 2,
            self._max_sessions,
            self._max_chars_per_session,
        )

    # ------------------------- R1 会话 -------------------------
    def create_session(self) -> Tuple[int, Optional[str]]:
        with self._lock:
            self._sweep_locked(time.time())
            if len(self._sessions) >= self._max_sessions:
                self._rejected_total += 1
                return ERR_R3_CAPACITY_EXCEEDED, None
            sid = secrets.token_urlsafe(9)
            while sid in self._sessions:          # 概率极低，仍然确定性处理
                sid = secrets.token_urlsafe(9)
            self._sessions[sid] = _Session(sid, self._max_messages)
            self._created_total += 1
            return ERR_OK, sid

    def ensure_session(self, sid: str, max_messages: int = 0) -> Tuple[int, bool]:
        """给"服务端自己开的房间"用的固定 id 会话。

        返回 (码, 是否新建)。房间是内存里的普通会话，同样受 TTL 与上限约束：
        没人说话也没人进房，它照样会到期消失，下一次进房再重新建。
        max_messages 让房间可以有比一次性会话更大的消息窗口。
        """
        with self._lock:
            now = time.time()
            self._sweep_locked(now)
            if self._live_session_locked(sid, now) is not None:
                return ERR_OK, False
            if len(self._sessions) >= self._max_sessions:
                self._rejected_total += 1
                return ERR_R3_CAPACITY_EXCEEDED, False
            self._sessions[sid] = _Session(sid, max_messages or self._max_messages)
            self._created_total += 1
            return ERR_OK, True

    def touch(self, sid: str) -> int:
        """把会话的活跃时间推到当前：有人在读或在写，就不该被判到期。"""
        with self._lock:
            session = self._live_session_locked(sid, time.time())
            if session is None:
                return ERR_R1_SESSION_MISSING
            session.last_active = time.time()
            return ERR_OK

    def clear_session(self, sid: str) -> int:
        with self._lock:
            session = self._sessions.get(sid)
            if session is None:
                return ERR_R1_SESSION_MISSING
            self._wipe_locked(session)
            del self._sessions[sid]
            self._closed_total += 1
            return ERR_OK

    def session_exists(self, sid: str) -> bool:
        with self._lock:
            return self._live_session_locked(sid, time.time()) is not None

    def list_sessions(self) -> List[Dict[str, object]]:
        now = time.time()
        with self._lock:
            self._sweep_locked(now)
            return [
                {
                    "id": s.sid,
                    "turns": len(s.turns),
                    "chars": s.chars,
                    "created_at": round(s.created_at, 3),
                    "last_active": round(s.last_active, 3),
                    "idle": round(now - s.last_active, 1),
                }
                for s in self._sessions.values()
            ]

    # ------------------------- R2 消息 -------------------------
    def add_message(self, sid: str, role: str, content: str) -> int:
        if not isinstance(role, str) or role not in ALLOWED_ROLES:
            return ERR_R2_ROLE_INVALID
        if not isinstance(content, str) or not content.strip():
            return ERR_R2_MSG_EMPTY
        if len(content) > self._max_chars_per_message:
            return ERR_R2_MSG_TOO_LARGE

        with self._lock:
            session = self._live_session_locked(sid, time.time())
            if session is None:
                return ERR_R1_SESSION_MISSING

            # 会话预算不够时先弹最旧的，弹到能放下为止；单条就超预算则拒绝
            while session.chars + len(content) > self._max_chars_per_session:
                if not session.turns:
                    self._rejected_total += 1
                    return ERR_R3_SESSION_BUDGET_EXCEEDED
                self._pop_oldest_locked(session)
            if len(session.turns) >= session.max_messages:
                self._pop_oldest_locked(session)

            turn = Turn(role=role, content=content, ts=time.time(), chars=len(content))
            session.turns.append(turn)
            session.chars += turn.chars
            session.last_active = turn.ts
            return ERR_OK

    def get_context(self, sid: str, limit: int = 0) -> Tuple[int, List[Dict[str, object]]]:
        with self._lock:
            session = self._live_session_locked(sid, time.time())
            if session is None:
                return ERR_R1_SESSION_MISSING, []
            turns = list(session.turns)
            session.last_active = time.time()
        if limit and limit > 0:
            turns = turns[-limit:]
        return ERR_OK, [t.to_dict() for t in turns]

    # ------------------------- R3 守卫 / R4 清理 -------------------------
    def stats(self) -> Dict[str, object]:
        now = time.time()
        with self._lock:
            self._sweep_locked(now)
            turns = sum(len(s.turns) for s in self._sessions.values())
            chars = sum(s.chars for s in self._sessions.values())
            return {
                "sessions": len(self._sessions),
                "turns": turns,
                "chars": chars,
                "max_sessions": self._max_sessions,
                "session_budget_chars": self._max_chars_per_session,
                "ttl": self._ttl,
                "created_total": self._created_total,
                "closed_total": self._closed_total,
                "expired_total": self._expired_total,
                "rejected_total": self._rejected_total,
                "persisted": False,
            }

    def sweep(self) -> int:
        with self._lock:
            return self._sweep_locked(time.time())

    def shutdown(self) -> None:
        self._stop.set()
        if self._gc_thread.is_alive():
            self._gc_thread.join(timeout=1.0)
        with self._lock:
            for session in list(self._sessions.values()):
                self._wipe_locked(session)
            self._sessions.clear()
        logger.info("纯内存记忆已关闭，所有会话内容已从内存释放")

    # ------------------------- 内部 -------------------------
    def _live_session_locked(self, sid: str, now: float) -> Optional[_Session]:
        session = self._sessions.get(sid)
        if session is None:
            return None
        if now - session.last_active > self._ttl:
            self._expired_total += 1
            self._wipe_locked(session)
            del self._sessions[sid]
            return None
        return session

    def _pop_oldest_locked(self, session: _Session) -> None:
        turn = session.turns.popleft()
        session.chars -= turn.chars

    @staticmethod
    def _wipe_locked(session: _Session) -> None:
        # 显式清空引用，避免内容在容器清空前仍被外部持有
        session.turns.clear()
        session.chars = 0

    def _sweep_locked(self, now: float) -> int:
        expired = [sid for sid, s in self._sessions.items() if now - s.last_active > self._ttl]
        for sid in expired:
            session = self._sessions.pop(sid, None)
            if session is not None:
                self._wipe_locked(session)
        self._expired_total += len(expired)
        return len(expired)

    def _gc_loop(self) -> None:
        while not self._stop.wait(self._gc_interval):
            try:
                removed = self.sweep()
                if removed:
                    logger.info("[GC] 到期清理 %s 个会话", removed)
            except Exception:  # 清理线程不允许因异常退出
                logger.exception("[GC] 清理失败")
