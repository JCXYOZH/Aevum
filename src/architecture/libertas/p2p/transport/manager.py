"""P2P 传输职责：manager。"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import socket
import ssl
import struct
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from .models import ChannelType
from .constants import DEFAULT_TIMEOUT
from .models import Message
from .identity import NodeIdentity
from .connection import P2PConnection
from .constants import logger

class ConnectionManager:
    """
    连接管理器
    管理所有入站和出站连接，连接池，重连
    """

    def __init__(self, identity: NodeIdentity, max_connections: int = 100):
        self.identity = identity
        self.max_connections = max_connections
        self.connections: Dict[str, P2PConnection] = {}  # node_id -> connection
        self._connecting: Dict[str, asyncio.Task] = {}
        self._reconnect_tasks: Dict[str, asyncio.Task] = {}
        self._lock = asyncio.Lock()
        self._on_message_handlers: List[Callable] = []
        self._on_connect_handlers: List[Callable] = []
        self._on_disconnect_handlers: List[Callable] = []
        self._server: Optional[asyncio.AbstractServer] = None
        self._listen_port: int = 0

    def register_message_handler(self, handler: Callable):
        """注册消息处理器"""
        self._on_message_handlers.append(handler)

    def register_connect_handler(self, handler: Callable):
        """注册连接建立处理器"""
        self._on_connect_handlers.append(handler)

    def register_disconnect_handler(self, handler: Callable):
        """注册断开处理器"""
        self._on_disconnect_handlers.append(handler)

    async def start_server(self, host: str = "0.0.0.0", port: int = 0) -> int:
        """启动P2P服务器"""
        ssl_ctx = self.identity.get_ssl_context(server_side=True)

        self._server = await asyncio.start_server(
            self._handle_inbound_connection,
            host, port,
            ssl=ssl_ctx,
        )

        # 获取实际监听端口
        sockets = self._server.sockets
        if sockets:
            self._listen_port = sockets[0].getsockname()[1]
        else:
            self._listen_port = port

        logger.info(f"P2P服务器监听: {host}:{self._listen_port}")
        return self._listen_port

    async def _handle_inbound_connection(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """处理入站连接"""
        try:
            peer = writer.get_extra_info("peername")
            address = peer[0] if peer else ""
            port = peer[1] if peer else 0

            # 等待握手获取node_id
            conn = P2PConnection(
                reader=reader, writer=writer,
                address=address, port=port,
                is_inbound=True,
                on_message=self._dispatch_message,
                on_disconnect=self._handle_disconnect,
            )

            # 等待握手消息
            handshake_msg = await asyncio.wait_for(
                self._wait_for_handshake(conn),
                timeout=10.0
            )

            if handshake_msg:
                remote_node_id = handshake_msg.payload.get("node_id", "")
                conn.node_id = remote_node_id

                # 检查是否已连接
                async with self._lock:
                    if remote_node_id in self.connections:
                        # 已存在连接，关闭新连接
                        await conn.close()
                        return
                    if len(self.connections) >= self.max_connections:
                        await conn.close()
                        return
                    self.connections[remote_node_id] = conn

                logger.info(f"入站连接: {remote_node_id} ({address}:{port})")

                # 触发连接事件
                for handler in self._on_connect_handlers:
                    try:
                        await handler(conn)
                    except Exception as e:
                        logger.error(f"连接处理器异常: {e}")

            else:
                await conn.close()

        except asyncio.TimeoutError:
            logger.debug("入站连接握手超时")
            try:
                writer.close()
            except Exception:
                pass
        except Exception as e:
            logger.error(f"入站连接处理异常: {e}")

    async def _wait_for_handshake(self, conn: P2PConnection) -> Optional[Message]:
        """等待握手消息"""
        # 发送自己的握手
        handshake = Message(
            channel=ChannelType.CONTROL.value,
            message_type="HELLO",
            payload={
                "node_id": self.identity.node_id,
                "version": "1.0.0",
                "listen_port": self._listen_port,
            },
        )
        await conn.send(handshake)

        # 等待对方握手（通过消息回调设置）
        # 简化：直接返回一个构造的握手
        # 实际实现中应该在_dispatch_message中捕获HELLO消息
        return None  # 由protocol层处理握手

    async def connect_to(self, address: str, port: int) -> Optional[P2PConnection]:
        """连接到远程节点"""
        key = f"{address}:{port}"

        # 检查是否正在连接
        if key in self._connecting:
            return await self._connecting[key]

        # 检查是否已连接
        async with self._lock:
            for conn in self.connections.values():
                if conn.address == address and conn.port == port:
                    return conn

        async def _do_connect():
            try:
                ssl_ctx = self.identity.get_ssl_context(server_side=False)
                reader, writer = await asyncio.open_connection(
                    address, port, ssl=ssl_ctx
                )

                conn = P2PConnection(
                    reader=reader, writer=writer,
                    address=address, port=port,
                    is_inbound=False,
                    on_message=self._dispatch_message,
                    on_disconnect=self._handle_disconnect,
                )

                # 握手由protocol层处理
                return conn

            except Exception as e:
                logger.debug(f"连接 {address}:{port} 失败: {e}")
                return None

        task = asyncio.create_task(_do_connect())
        self._connecting[key] = task

        try:
            conn = await task
            if conn:
                async with self._lock:
                    if conn.node_id:
                        self.connections[conn.node_id] = conn
                    else:
                        # 临时存储，等握手后更新
                        pass
            return conn
        finally:
            self._connecting.pop(key, None)

    async def _dispatch_message(self, conn: P2PConnection, message: Message):
        """分发消息到所有处理器"""
        conn.update_heartbeat()

        for handler in self._on_message_handlers:
            try:
                await handler(conn, message)
            except Exception as e:
                logger.error(f"消息处理器异常: {e}")

    async def _handle_disconnect(self, conn: P2PConnection):
        """处理连接断开"""
        async with self._lock:
            if conn.node_id and conn.node_id in self.connections:
                del self.connections[conn.node_id]

        for handler in self._on_disconnect_handlers:
            try:
                await handler(conn)
            except Exception as e:
                logger.error(f"断开处理器异常: {e}")

        logger.info(f"连接断开: {conn.node_id} ({conn.address}:{conn.port})")

    def get_connection(self, node_id: str) -> Optional[P2PConnection]:
        """获取连接"""
        return self.connections.get(node_id)

    def get_all_connections(self) -> List[P2PConnection]:
        """获取所有连接"""
        return list(self.connections.values())

    def get_connected_node_ids(self) -> List[str]:
        """获取已连接的节点ID列表"""
        return list(self.connections.keys())

    def get_connection_count(self) -> int:
        """获取连接数"""
        return len(self.connections)

    async def broadcast(self, message: Message, exclude: Optional[Set[str]] = None) -> int:
        """广播消息到所有连接"""
        exclude = exclude or set()
        count = 0
        for node_id, conn in list(self.connections.items()):
            if node_id in exclude:
                continue
            if await conn.send(message):
                count += 1
        return count

    async def send_to_node(self, node_id: str, message: Message) -> bool:
        """发送消息到指定节点"""
        conn = self.connections.get(node_id)
        if conn:
            return await conn.send(message)
        return False

    async def request_from_node(self, node_id: str, message: Message,
                                 timeout: float = DEFAULT_TIMEOUT) -> Optional[Message]:
        """向指定节点发送请求并等待响应"""
        conn = self.connections.get(node_id)
        if conn:
            return await conn.send_request(message, timeout)
        return None

    async def close_all(self):
        """关闭所有连接"""
        for conn in list(self.connections.values()):
            await conn.close()
        self.connections.clear()

        if self._server:
            self._server.close()
            await self._server.wait_closed()

    def get_stats(self) -> Dict:
        """获取统计信息"""
        total_sent = sum(c.stats.bytes_sent for c in self.connections.values())
        total_recv = sum(c.stats.bytes_received for c in self.connections.values())
        total_msgs_sent = sum(c.stats.messages_sent for c in self.connections.values())
        total_msgs_recv = sum(c.stats.messages_received for c in self.connections.values())

        return {
            "connection_count": len(self.connections),
            "max_connections": self.max_connections,
            "listen_port": self._listen_port,
            "total_bytes_sent": total_sent,
            "total_bytes_received": total_recv,
            "total_messages_sent": total_msgs_sent,
            "total_messages_received": total_msgs_recv,
            "connected_nodes": [
                {
                    "node_id": c.node_id,
                    "address": c.address,
                    "port": c.port,
                    "is_inbound": c.is_inbound,
                    "latency_ms": c.stats.latency_ms,
                    "connected_for": time.time() - c.stats.connected_at,
                }
                for c in self.connections.values()
            ],
        }
