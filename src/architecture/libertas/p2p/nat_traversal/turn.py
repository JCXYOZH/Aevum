"""NAT 穿透职责：turn。"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import random
import socket
import struct
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from .constants import (
    STUN_PORT, TURN_PORT, STUN_TIMEOUT, HOLE_PUNCH_TIMEOUT,
    HOLE_PUNCH_ATTEMPTS, UPNP_TIMEOUT, RELAY_BUFFER_SIZE, logger,
)

from .models import RelaySession

class TURNServer:
    """
    TURN中继服务器
    为Symmetric NAT节点提供中继转发服务
    """

    def __init__(self, node_id: str, listen_address: str = "0.0.0.0",
                 listen_port: int = TURN_PORT, max_sessions: int = 100):
        self.node_id = node_id
        self.listen_address = listen_address
        self.listen_port = listen_port
        self.max_sessions = max_sessions
        self.sessions: Dict[str, RelaySession] = {}
        self._server: Optional[asyncio.DatagramTransport] = None
        self._running = False
        self._cleanup_task: Optional[asyncio.Task] = None

    async def start(self):
        """启动TURN服务器"""
        if self._running:
            return

        loop = asyncio.get_event_loop()
        self._server, _ = await loop.create_datagram_endpoint(
            lambda: TURNProtocol(self),
            local_addr=(self.listen_address, self.listen_port)
        )
        self._running = True
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        logger.info(f"TURN中继服务器启动: {self.listen_address}:{self.listen_port}")

    async def stop(self):
        """停止TURN服务器"""
        self._running = False
        if self._server:
            self._server.close()
        if self._cleanup_task:
            self._cleanup_task.cancel()

    def create_session(self, client_node_id: str,
                        client_address: Tuple[str, int],
                        peer_address: Tuple[str, int]) -> Optional[RelaySession]:
        """创建中继会话"""
        if len(self.sessions) >= self.max_sessions:
            return None

        session_id = hashlib.sha256(
            f"{client_node_id}:{client_address}:{peer_address}:{time.time()}".encode()
        ).hexdigest()[:16]

        session = RelaySession(
            session_id=session_id,
            client_node_id=client_node_id,
            client_address=client_address,
            peer_address=peer_address,
            allocated_port=random.randint(10000, 60000),
            expires_at=time.time() + 3600,  # 1小时过期
        )

        self.sessions[session_id] = session
        return session

    def relay_data(self, session_id: str, data: bytes, from_client: bool = True):
        """中继数据"""
        session = self.sessions.get(session_id)
        if not session or session.is_expired():
            return

        session.bytes_relayed += len(data)
        session.packets_relayed += 1
        session.last_activity = time.time()

        # 实际转发由TURNProtocol处理
        if self._server:
            target = session.peer_address if from_client else session.client_address
            self._server.sendto(data, target)

    async def _cleanup_loop(self):
        """清理过期会话"""
        while self._running:
            try:
                expired = [sid for sid, s in self.sessions.items() if s.is_expired()]
                for sid in expired:
                    del self.sessions[sid]
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"TURN清理异常: {e}")
                await asyncio.sleep(60)

    def get_stats(self) -> Dict:
        """获取统计"""
        return {
            "active_sessions": len(self.sessions),
            "max_sessions": self.max_sessions,
            "total_bytes_relayed": sum(s.bytes_relayed for s in self.sessions.values()),
            "total_packets_relayed": sum(s.packets_relayed for s in self.sessions.values()),
            "listen_port": self.listen_port,
        }

class TURNProtocol(asyncio.DatagramProtocol):
    """TURN UDP协议处理器"""

    def __init__(self, server: TURNServer):
        self.server = server
        self.transport = None

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        """处理收到的数据报"""
        # 简化实现：查找会话并转发
        for session in self.server.sessions.values():
            if addr == session.client_address:
                self.server.relay_data(session.session_id, data, from_client=True)
                break
            elif addr == session.peer_address:
                self.server.relay_data(session.session_id, data, from_client=False)
                break
