"""NAT 穿透职责：holepunch。"""

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

from .models import HolePunchAttempt

class UDPHolePuncher:
    """
    UDP打洞器（Hole Punching）
    同时从两端发送UDP包，在NAT上打洞
    """

    def __init__(self, local_address: Tuple[str, int],
                 on_success: Optional[Callable] = None):
        self.local_address = local_address
        self.on_success = on_success
        self._sock: Optional[socket.socket] = None
        self._attempts: Dict[str, HolePunchAttempt] = {}

    async def punch_hole(self, target_node_id: str,
                          target_address: Tuple[str, int],
                          local_port: int = 0) -> bool:
        """
        尝试打洞

        Args:
            target_node_id: 目标节点ID
            target_address: 目标公网地址
            local_port: 本地端口（0表示随机）

        Returns:
            是否成功
        """
        attempt = HolePunchAttempt(
            target_node_id=target_node_id,
            target_address=target_address,
            local_port=local_port or random.randint(1024, 65535),
        )
        self._attempts[target_node_id] = attempt

        try:
            # 创建UDP socket
            self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self._sock.settimeout(2.0)
            self._sock.bind(("0.0.0.0", attempt.local_port))

            # 同时打洞：发送多个包到目标的不同端口
            for i in range(attempt.max_attempts):
                if attempt.success:
                    break

                attempt.attempts = i + 1

                # 发送打洞包
                punch_msg = json.dumps({
                    "type": "hole_punch",
                    "node_id": target_node_id,
                    "attempt": i,
                    "timestamp": time.time(),
                }).encode()

                # 发送到目标地址
                self._sock.sendto(punch_msg, target_address)

                # 同时发送到目标的相邻端口（增加成功率）
                adjacent_port = target_address[1] + random.randint(-5, 5)
                if 1024 <= adjacent_port <= 65535:
                    self._sock.sendto(punch_msg, (target_address[0], adjacent_port))

                # 等待响应
                try:
                    data, addr = self._sock.recvfrom(1024)
                    response = json.loads(data.decode())
                    if response.get("type") == "hole_punch_ack":
                        attempt.success = True
                        attempt.connected_address = addr
                        if self.on_success:
                            await self.on_success(target_node_id, addr)
                        return True
                except socket.timeout:
                    pass

                await asyncio.sleep(0.5)

            return False

        except Exception as e:
            logger.error(f"打洞异常: {e}")
            return False
        finally:
            if self._sock:
                self._sock.close()
                self._sock = None

    async def listen_for_punch(self, listen_port: int,
                                 on_punch_received: Optional[Callable] = None) -> Tuple[str, Tuple[str, int]]:
        """
        监听打洞请求（被打洞端）

        Returns:
            (node_id, 对端地址)
        """
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(HOLE_PUNCH_TIMEOUT)
        sock.bind(("0.0.0.0", listen_port))

        try:
            while True:
                try:
                    data, addr = sock.recvfrom(1024)
                    msg = json.loads(data.decode())
                    if msg.get("type") == "hole_punch":
                        node_id = msg.get("node_id", "")

                        # 发送ACK
                        ack = json.dumps({
                            "type": "hole_punch_ack",
                            "node_id": node_id,
                            "timestamp": time.time(),
                        }).encode()
                        sock.sendto(ack, addr)

                        if on_punch_received:
                            await on_punch_received(node_id, addr)

                        return node_id, addr

                except socket.timeout:
                    continue
                except (json.JSONDecodeError, UnicodeDecodeError):
                    continue

        finally:
            sock.close()
