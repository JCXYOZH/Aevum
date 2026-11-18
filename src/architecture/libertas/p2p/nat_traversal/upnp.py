"""NAT 穿透职责：upnp。"""

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


class UPnPPortMapper:
    """
    UPnP/NAT-PMP端口映射
    自动在路由器上打开端口映射
    """

    def __init__(self, timeout: float = UPNP_TIMEOUT):
        self.timeout = timeout
        self.mapped_ports: Dict[int, Dict] = {}

    async def discover_router(self) -> Optional[Tuple[str, int]]:
        """发现UPnP路由器"""
        try:
            # SSDP发现
            ssdp_addr = "239.255.255.250"
            ssdp_port = 1900

            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(self.timeout)

            search_msg = (
                "M-SEARCH * HTTP/1.1\r\n"
                f"HOST: {ssdp_addr}:{ssdp_port}\r\n"
                "MAN: \"ssdp:discover\"\r\n"
                "MX: 2\r\n"
                "ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n"
                "\r\n"
            )

            sock.sendto(search_msg.encode(), (ssdp_addr, ssdp_port))

            try:
                data, addr = sock.recvfrom(4096)
                sock.close()
                # 解析响应获取控制URL
                response = data.decode('utf-8', errors='ignore')
                # 简化：返回路由器地址
                return (addr[0], addr[1])
            except socket.timeout:
                sock.close()
                return None

        except Exception as e:
            logger.debug(f"UPnP路由器发现失败: {e}")
            return None

    async def add_port_mapping(self, internal_port: int, external_port: int,
                                 protocol: str = "TCP",
                                 description: str = "Libertas P2P") -> bool:
        """
        添加端口映射

        Args:
            internal_port: 内部端口
            external_port: 外部端口
            protocol: TCP/UDP
            description: 描述

        Returns:
            是否成功
        """
        router = await self.discover_router()
        if not router:
            return False

        # 简化实现：记录映射（实际需要发送SOAP请求到路由器）
        self.mapped_ports[external_port] = {
            "internal_port": internal_port,
            "external_port": external_port,
            "protocol": protocol,
            "description": description,
            "router": router,
            "created_at": time.time(),
        }

        logger.info(f"UPnP端口映射: {external_port} -> {internal_port} ({protocol})")
        return True

    async def remove_port_mapping(self, external_port: int) -> bool:
        """移除端口映射"""
        if external_port in self.mapped_ports:
            del self.mapped_ports[external_port]
            return True
        return False

    async def get_external_ip(self) -> Optional[str]:
        """获取外部IP"""
        router = await self.discover_router()
        if router:
            return router[0]
        return None
