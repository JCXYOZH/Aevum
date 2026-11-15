"""NAT 穿透职责：manager。"""

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

from .models import NATType
from .models import NATTypeDetectionResult
from .stun import STUNClient
from .turn import TURNServer
from .holepunch import UDPHolePuncher
from .upnp import UPnPPortMapper

class NATTraversalManager:
    """
    NAT穿透管理器
    根据NAT类型选择最优连接策略
    """

    def __init__(self, node_id: str, stun_servers: Optional[List[Tuple[str, int]]] = None):
        self.node_id = node_id
        self.stun_servers = stun_servers or [
            ("stun.l.google.com", 19302),
            ("stun1.l.google.com", 19302),
            ("stun2.l.google.com", 19302),
        ]
        self.nat_info: Optional[NATTypeDetectionResult] = None
        self.stun_client = STUNClient()
        self.upnp_mapper = UPnPPortMapper()
        self.turn_server: Optional[TURNServer] = None
        self.hole_puncher: Optional[UDPHolePuncher] = None
        self.relay_nodes: List[Dict] = []  # 已知的中继节点列表
        self._is_relay_candidate = False

    async def detect_nat(self) -> NATTypeDetectionResult:
        """检测NAT类型"""
        for server, port in self.stun_servers:
            try:
                self.nat_info = await self.stun_client.detect_nat(server, port)
                if self.nat_info.nat_type != NATType.UNKNOWN.value:
                    logger.info(f"NAT类型: {self.nat_info.nat_type}, 公网: {self.nat_info.public_ip}:{self.nat_info.public_port}")
                    return self.nat_info
            except Exception as e:
                logger.debug(f"STUN服务器 {server} 失败: {e}")
                continue

        self.nat_info = NATTypeDetectionResult(nat_type=NATType.UNKNOWN.value)
        return self.nat_info

    async def setup_port_mapping(self, internal_port: int,
                                  external_port: Optional[int] = None) -> Optional[int]:
        """
        设置端口映射（UPnP）

        Returns:
            映射的外部端口，失败返回None
        """
        ext_port = external_port or internal_port
        success = await self.upnp_mapper.add_port_mapping(internal_port, ext_port)
        if success:
            return ext_port
        return None

    async def start_relay_server(self, listen_port: int = TURN_PORT) -> bool:
        """启动TURN中继服务器（成为中继节点）"""
        if self.turn_server:
            return True

        # 检查是否适合当中继节点（公网IP或Full Cone NAT）
        if self.nat_info and self.nat_info.nat_type in (
            NATType.OPEN_INTERNET.value, NATType.FULL_CONE.value
        ):
            self.turn_server = TURNServer(self.node_id, listen_port=listen_port)
            await self.turn_server.start()
            self._is_relay_candidate = True
            logger.info(f"成为TURN中继节点，监听端口: {listen_port}")
            return True

        return False

    async def connect_through_relay(self, target_node_id: str,
                                     relay_node: Dict,
                                     local_port: int = 0) -> Optional[Tuple[str, int]]:
        """
        通过中继节点连接目标

        Args:
            target_node_id: 目标节点ID
            relay_node: 中继节点信息 {address, port, node_id}
            local_port: 本地端口

        Returns:
            (session_id, 中继分配的地址)
        """
        # 向中继节点请求创建会话
        # 实际实现需要通过P2P消息协议发送TURN_ALLOCATE请求
        # 这里简化处理
        session_id = hashlib.sha256(
            f"{self.node_id}:{target_node_id}:{time.time()}".encode()
        ).hexdigest()[:16]

        return session_id, (relay_node["address"], relay_node.get("port", TURN_PORT))

    async def connect(self, target_node_id: str,
                       target_nat_info: NATTypeDetectionResult,
                       target_address: Tuple[str, int],
                       local_port: int = 0) -> Dict:
        """
        根据双方NAT类型选择最优连接策略

        Returns:
            {"method": "direct"/"hole_punch"/"relay", "success": bool, "address": ...}
        """
        if not self.nat_info:
            await self.detect_nat()

        my_type = self.nat_info.nat_type if self.nat_info else NATType.UNKNOWN.value
        target_type = target_nat_info.nat_type

        # 策略1：双方都有公网IP或Full Cone -> 直连
        if my_type in (NATType.OPEN_INTERNET.value, NATType.FULL_CONE.value) and \
           target_type in (NATType.OPEN_INTERNET.value, NATType.FULL_CONE.value):
            return {"method": "direct", "success": True, "address": target_address}

        # 策略2：至少一方不是Symmetric -> UDP打洞
        if my_type != NATType.SYMMETRIC.value and target_type != NATType.SYMMETRIC.value:
            if not self.hole_puncher:
                self.hole_puncher = UDPHolePuncher(("0.0.0.0", local_port or 0))
            success = await self.hole_puncher.punch_hole(target_node_id, target_address, local_port)
            if success:
                return {"method": "hole_punch", "success": True, "address": target_address}

        # 策略3：至少一方是Symmetric -> TURN中继
        if self.relay_nodes:
            relay = self.relay_nodes[0]
            result = await self.connect_through_relay(target_node_id, relay, local_port)
            if result:
                return {"method": "relay", "success": True, "address": result[1], "session_id": result[0]}

        # 所有方法都失败
        return {"method": "none", "success": False, "reason": "no_available_method"}

    def add_relay_node(self, node_id: str, address: str, port: int,
                       bandwidth: str = "100Mbps", reputation: float = 0.5):
        """添加已知中继节点"""
        self.relay_nodes.append({
            "node_id": node_id,
            "address": address,
            "port": port,
            "bandwidth": bandwidth,
            "reputation": reputation,
            "added_at": time.time(),
        })
        # 按信誉排序
        self.relay_nodes.sort(key=lambda x: x["reputation"], reverse=True)

    def get_connection_strategy(self, target_nat_type: str) -> str:
        """获取推荐的连接策略"""
        if not self.nat_info:
            return "unknown"

        my_type = self.nat_info.nat_type
        if my_type in (NATType.OPEN_INTERNET.value, NATType.FULL_CONE.value) and \
           target_nat_type in (NATType.OPEN_INTERNET.value, NATType.FULL_CONE.value):
            return "direct"
        if my_type != NATType.SYMMETRIC.value and target_nat_type != NATType.SYMMETRIC.value:
            return "hole_punch"
        return "relay"

    async def get_stats(self) -> Dict:
        """获取统计"""
        return {
            "nat_info": self.nat_info.to_dict() if self.nat_info else None,
            "is_relay_candidate": self._is_relay_candidate,
            "relay_server_stats": self.turn_server.get_stats() if self.turn_server else None,
            "known_relay_nodes": len(self.relay_nodes),
            "upnp_mapped_ports": len(self.upnp_mapper.mapped_ports),
            "stun_servers": len(self.stun_servers),
        }
