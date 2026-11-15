"""P2P 传输职责：connection。"""

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
from .models import ConnectionState
from .models import ConnectionStats
from .constants import DEFAULT_TIMEOUT
from .constants import HEARTBEAT_INTERVAL
from .constants import HEARTBEAT_TIMEOUT
from .models import Message
from .codec import MessageCodec
from .constants import logger

class P2PConnection:
    """
    P2P连接（入站或出站）
    管理一个TCP+TLS连接的读写、心跳、重连
    """

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter,
                 node_id: str = "", address: str = "", port: int = 0,
                 is_inbound: bool = False, on_message: Optional[Callable] = None,
                 on_disconnect: Optional[Callable] = None):
        self.reader = reader
        self.writer = writer
        self.node_id = node_id
        self.address = address
        self.port = port
        self.is_inbound = is_inbound
        self.state = ConnectionState.CONNECTED
        self.stats = ConnectionStats(connected_at=time.time())
        self.on_message = on_message
        self.on_disconnect = on_disconnect

        self._write_lock = asyncio.Lock()
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._read_task: Optional[asyncio.Task] = None
        self._last_heartbeat = time.time()
        self._pending_requests: Dict[str, asyncio.Future] = {}
        self._message_counter = 0

        # 启动读写循环
        self._read_task = asyncio.create_task(self._read_loop())
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def _read_loop(self):
        """消息读取循环"""
        try:
            while self.state == ConnectionState.CONNECTED:
                msg = await MessageCodec.read_message(self.reader)
                if msg is None:
                    break

                self.stats.messages_received += 1
                self.stats.bytes_received += len(json.dumps(msg.to_dict()).encode())

                # 检查是否是待处理的请求响应
                if msg.message_id and msg.message_id in self._pending_requests:
                    future = self._pending_requests.pop(msg.message_id)
                    if not future.done():
                        future.set_result(msg)
                    continue

                # 回调处理
                if self.on_message:
                    try:
                        await self.on_message(self, msg)
                    except Exception as e:
                        logger.error(f"消息处理异常: {e}")

        except (ConnectionResetError, BrokenPipeError, OSError) as e:
            logger.debug(f"连接读取错误: {e}")
        except asyncio.CancelledError:
            pass
        finally:
            await self.close()

    async def _heartbeat_loop(self):
        """心跳保活循环"""
        try:
            while self.state == ConnectionState.CONNECTED:
                await asyncio.sleep(HEARTBEAT_INTERVAL)

                # 检查是否超时
                if time.time() - self._last_heartbeat > HEARTBEAT_TIMEOUT:
                    logger.info(f"节点 {self.node_id} 心跳超时")
                    await self.close()
                    break

                # 发送PING
                try:
                    ping_msg = Message(
                        channel=ChannelType.CONTROL.value,
                        message_type="PING",
                        payload={"timestamp": time.time()},
                        source_node="",
                    )
                    await self.send(ping_msg)
                except Exception:
                    break

        except asyncio.CancelledError:
            pass

    async def send(self, message: Message) -> bool:
        """发送消息"""
        if self.state != ConnectionState.CONNECTED:
            return False

        try:
            async with self._write_lock:
                await MessageCodec.write_message(self.writer, message)
                self.stats.messages_sent += 1
                self.stats.bytes_sent += len(json.dumps(message.to_dict()).encode())
                return True
        except (ConnectionResetError, BrokenPipeError, OSError) as e:
            logger.debug(f"发送失败: {e}")
            await self.close()
            return False

    async def send_request(self, message: Message, timeout: float = DEFAULT_TIMEOUT) -> Optional[Message]:
        """发送请求并等待响应"""
        import uuid
        message.message_id = str(uuid.uuid4())[:8]

        future = asyncio.get_event_loop().create_future()
        self._pending_requests[message.message_id] = future

        try:
            if not await self.send(message):
                self._pending_requests.pop(message.message_id, None)
                return None

            response = await asyncio.wait_for(future, timeout=timeout)
            return response
        except asyncio.TimeoutError:
            self._pending_requests.pop(message.message_id, None)
            return None
        except Exception:
            self._pending_requests.pop(message.message_id, None)
            return None

    def update_heartbeat(self):
        """更新心跳时间"""
        self._last_heartbeat = time.time()

    async def close(self):
        """关闭连接"""
        if self.state in (ConnectionState.CLOSED, ConnectionState.CLOSING):
            return

        self.state = ConnectionState.CLOSING

        # 取消任务
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        if self._read_task:
            self._read_task.cancel()

        # 完成所有待处理请求
        for future in self._pending_requests.values():
            if not future.done():
                future.set_result(None)
        self._pending_requests.clear()

        # 关闭writer
        try:
            self.writer.close()
            await self.writer.wait_closed()
        except Exception:
            pass

        self.state = ConnectionState.CLOSED

        if self.on_disconnect:
            try:
                await self.on_disconnect(self)
            except Exception:
                pass

    def is_alive(self) -> bool:
        """连接是否存活"""
        return self.state == ConnectionState.CONNECTED

    def get_remote_address(self) -> Tuple[str, int]:
        """获取远程地址"""
        try:
            peer = self.writer.get_extra_info("peername")
            if peer:
                return peer[0], peer[1]
        except Exception:
            pass
        return self.address, self.port
