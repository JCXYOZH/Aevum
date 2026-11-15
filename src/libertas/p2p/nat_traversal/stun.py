"""NAT 穿透职责：stun。"""

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

class STUNClient:
    """
    STUN客户端（RFC 5389简化实现）
    用于NAT类型检测和公网IP/端口发现
    """

    # STUN消息类型
    BINDING_REQUEST = 0x0001
    BINDING_RESPONSE = 0x0101
    BINDING_ERROR_RESPONSE = 0x0111

    # STUN属性类型
    MAPPED_ADDRESS = 0x0001
    XOR_MAPPED_ADDRESS = 0x0020
    CHANGE_REQUEST = 0x0003
    SOURCE_ADDRESS = 0x0004
    CHANGED_ADDRESS = 0x0005
    SOFTWARE = 0x8022
    FINGERPRINT = 0x8028

    def __init__(self, timeout: float = STUN_TIMEOUT):
        self.timeout = timeout

    def _build_binding_request(self, transaction_id: bytes,
                                change_ip: bool = False,
                                change_port: bool = False) -> bytes:
        """构建STUN Binding Request"""
        # 消息头：类型(2) + 长度(2) + 魔数(4) + 事务ID(12)
        msg_type = self.BINDING_REQUEST
        magic_cookie = 0x2112A442

        # 可选：CHANGE_REQUEST属性
        attributes = b""
        if change_ip or change_port:
            attr_type = self.CHANGE_REQUEST
            attr_length = 4
            flags = 0
            if change_ip:
                flags |= 0x04
            if change_port:
                flags |= 0x02
            attr_value = struct.pack("!I", flags)
            attributes += struct.pack("!HH", attr_type, attr_length) + attr_value

        msg_length = len(attributes)
        header = struct.pack("!HHI", msg_type, msg_length, magic_cookie) + transaction_id
        return header + attributes

    def _parse_stun_response(self, data: bytes) -> Optional[Dict]:
        """解析STUN响应"""
        if len(data) < 20:
            return None

        msg_type, msg_length, magic_cookie = struct.unpack("!HHI", data[:8])
        transaction_id = data[8:20]

        if msg_type != self.BINDING_RESPONSE:
            return None

        result = {"transaction_id": transaction_id.hex()}
        offset = 20

        while offset < 20 + msg_length:
            if offset + 4 > len(data):
                break
            attr_type, attr_length = struct.unpack("!HH", data[offset:offset + 4])
            attr_value = data[offset + 4:offset + 4 + attr_length]

            if attr_type in (self.MAPPED_ADDRESS, self.XOR_MAPPED_ADDRESS):
                if len(attr_value) >= 8:
                    family = attr_value[1]
                    port = struct.unpack("!H", attr_value[2:4])[0]
                    if attr_type == self.XOR_MAPPED_ADDRESS:
                        port ^= 0x2112
                        if family == 0x01:  # IPv4
                            ip_bytes = bytes(a ^ b for a, b in zip(
                                attr_value[4:8], struct.pack("!I", 0x2112A442)))
                            ip = socket.inet_ntoa(ip_bytes)
                        else:
                            ip = "::"
                    else:
                        if family == 0x01:
                            ip = socket.inet_ntoa(attr_value[4:8])
                        else:
                            ip = "::"
                    result["mapped_ip"] = ip
                    result["mapped_port"] = port

            offset += 4 + attr_length
            # 4字节对齐
            if attr_length % 4 != 0:
                offset += 4 - (attr_length % 4)

        return result

    async def detect_nat(self, stun_server: str = "stun.l.google.com",
                          stun_port: int = 19302) -> NATTypeDetectionResult:
        """
        检测NAT类型

        使用RFC 3489的检测算法：
        1. 发送Binding Request到主地址
        2. 如果没有响应，UDP被阻止
        3. 检查映射地址是否等于本地地址（公网IP）
        4. 发送Change Request（change IP+port）
        5. 根据响应判断NAT类型
        """
        nat_info = NATTypeDetectionResult(
            stun_server=f"{stun_server}:{stun_port}",
            detected_at=time.time(),
        )

        try:
            # 测试1：发送Binding Request到主地址
            local_ip = self._get_local_ip()
            local_port = random.randint(1024, 65535)

            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(self.timeout)
            sock.bind((local_ip, local_port))

            transaction_id = os.urandom(12)
            request = self._build_binding_request(transaction_id)

            sock.sendto(request, (stun_server, stun_port))
            try:
                data, addr = sock.recvfrom(1024)
            except socket.timeout:
                nat_info.nat_type = NATType.BLOCKED.value
                sock.close()
                return nat_info

            response = self._parse_stun_response(data)
            if not response or "mapped_ip" not in response:
                nat_info.nat_type = NATType.UNKNOWN.value
                sock.close()
                return nat_info

            mapped_ip = response["mapped_ip"]
            mapped_port = response["mapped_port"]
            nat_info.mapped_ip = mapped_ip
            nat_info.mapped_port = mapped_port

            # 检查是否是公网IP
            if mapped_ip == local_ip:
                nat_info.nat_type = NATType.OPEN_INTERNET.value
                nat_info.public_ip = mapped_ip
                nat_info.public_port = mapped_port
                sock.close()
                return nat_info

            # 测试2：发送Change Request（change IP+port）
            transaction_id2 = os.urandom(12)
            request2 = self._build_binding_request(transaction_id2, change_ip=True, change_port=True)
            sock.sendto(request2, (stun_server, stun_port))

            try:
                data2, addr2 = sock.recvfrom(1024)
                # 收到响应 = Full Cone NAT
                nat_info.nat_type = NATType.FULL_CONE.value
                nat_info.filtering_behavior = "endpoint-independent"
            except socket.timeout:
                # 没收到响应，继续测试
                # 测试3：发送Binding Request到changed address
                # 简化实现：根据RFC 3489，这里应该发送到changed address
                # 但很多STUN服务器不支持，所以用启发式判断

                # 测试3：从不同端口发送Binding Request
                sock2 = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                sock2.settimeout(self.timeout)
                sock2.bind((local_ip, random.randint(1024, 65535)))

                transaction_id3 = os.urandom(12)
                request3 = self._build_binding_request(transaction_id3)
                sock2.sendto(request3, (stun_server, stun_port))

                try:
                    data3, _ = sock2.recvfrom(1024)
                    response3 = self._parse_stun_response(data3)
                    if response3 and "mapped_port" in response3:
                        if response3["mapped_port"] != mapped_port:
                            # 不同本地端口映射到不同公网端口 = Symmetric NAT
                            nat_info.nat_type = NATType.SYMMETRIC.value
                            nat_info.mapping_behavior = "address-port-dependent"
                        else:
                            # 相同映射 = Port Restricted Cone
                            nat_info.nat_type = NATType.PORT_RESTRICTED_CONE.value
                            nat_info.mapping_behavior = "endpoint-independent"
                            nat_info.filtering_behavior = "address-port-dependent"
                except socket.timeout:
                    nat_info.nat_type = NATType.UNKNOWN.value

                sock2.close()

            sock.close()
            nat_info.public_ip = mapped_ip
            nat_info.public_port = mapped_port

        except Exception as e:
            logger.error(f"NAT检测异常: {e}")
            nat_info.nat_type = NATType.UNKNOWN.value

        return nat_info

    def _get_local_ip(self) -> str:
        """获取本地IP"""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "127.0.0.1"
