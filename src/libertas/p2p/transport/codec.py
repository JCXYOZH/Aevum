"""P2P 传输职责：codec。"""

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

from .constants import MAX_MESSAGE_SIZE
from .constants import MESSAGE_HEADER_SIZE
from .constants import MESSAGE_MAGIC
from .models import Message
from .constants import logger

class MessageCodec:
    """
    消息编解码器
    帧格式: MAGIC(4) + LENGTH(4, big-endian) + JSON_DATA
    """

    @staticmethod
    def encode(message: Message) -> bytes:
        """编码消息为字节帧"""
        data = json.dumps(message.to_dict(), ensure_ascii=False).encode("utf-8")
        if len(data) > MAX_MESSAGE_SIZE:
            raise ValueError(f"消息过大: {len(data)} > {MAX_MESSAGE_SIZE}")
        header = MESSAGE_MAGIC + struct.pack(">I", len(data))
        return header + data

    @staticmethod
    async def read_message(reader: asyncio.StreamReader) -> Optional[Message]:
        """从流中读取一条消息"""
        try:
            # 读取头部
            header = await reader.readexactly(MESSAGE_HEADER_SIZE)
            if len(header) < MESSAGE_HEADER_SIZE:
                return None

            magic = header[:4]
            if magic != MESSAGE_MAGIC:
                # 尝试重新同步
                logger.warning(f"无效的消息魔数: {magic.hex()}")
                return None

            length = struct.unpack(">I", header[4:8])[0]
            if length > MAX_MESSAGE_SIZE:
                logger.warning(f"消息过大: {length}")
                return None

            # 读取消息体
            data = await reader.readexactly(length)
            msg_dict = json.loads(data.decode("utf-8"))
            return Message.from_dict(msg_dict)

        except asyncio.IncompleteReadError:
            return None
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            logger.warning(f"消息解码失败: {e}")
            return None

    @staticmethod
    async def write_message(writer: asyncio.StreamWriter, message: Message):
        """写入一条消息到流"""
        data = MessageCodec.encode(message)
        writer.write(data)
        await writer.drain()
