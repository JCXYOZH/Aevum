"""
广域网通信模块（MQTT 中继）
- 通过公共 MQTT  broker 中继消息，跨互联网通信
- 房间制：用户输入房间号+密码加入同一房间
- 消息加密：密码派生密钥，XOR 流加密 + Base64
- 支持文字消息和文件传输（base64编码，限制大小）
- 纯标准库实现，无外部依赖
"""
import os
import json
import time
import socket
import struct
import hashlib
import base64
import threading
import uuid
from typing import Dict, List, Optional, Callable
from datetime import datetime

class MQTTClient:
    """最小 MQTT 3.1.1 客户端（纯标准库，支持 TLS）"""

    def __init__(self, host: str, port: int = 1883, keepalive: int = 30, use_tls: bool = False):
        self.host = host
        self.port = port
        self.keepalive = keepalive
        self.use_tls = use_tls
        self.sock: Optional[socket.socket] = None
        self.connected = False
        self._running = False
        self._recv_thread: Optional[threading.Thread] = None
        self._ping_thread: Optional[threading.Thread] = None
        self._on_message: Optional[Callable] = None
        self._on_connect: Optional[Callable] = None
        self._on_disconnect: Optional[Callable] = None
        self._lock = threading.Lock()
        self._packet_id = 0
        self._subscriptions: Dict[str, int] = {}

    def _next_packet_id(self) -> int:
        self._packet_id = (self._packet_id % 65535) + 1
        return self._packet_id

    def _encode_remaining_length(self, length: int) -> bytes:
        out = bytearray()
        while True:
            byte = length % 128
            length //= 128
            if length > 0:
                byte |= 0x80
            out.append(byte)
            if length == 0:
                break
        return bytes(out)

    def _decode_remaining_length(self, sock: socket.socket) -> int:
        multiplier = 1
        value = 0
        while True:
            b = sock.recv(1)
            if not b:
                raise ConnectionError("连接断开")
            digit = b[0]
            value += (digit & 0x7F) * multiplier
            if (digit & 0x80) == 0:
                break
            multiplier *= 128
            if multiplier > 128 * 128 * 128:
                raise ValueError("剩余长度超限")
        return value

    def _encode_string(self, s: str) -> bytes:
        data = s.encode("utf-8")
        return struct.pack(">H", len(data)) + data

    def _send_packet(self, packet_type: int, flags: int, payload: bytes = b""):
        with self._lock:
            if not self.sock:
                return
            header = bytes([(packet_type << 4) | flags])
            rem_len = self._encode_remaining_length(len(payload))
            self.sock.sendall(header + rem_len + payload)

    def connect(self, client_id: str = "") -> bool:
        try:
            raw_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            raw_sock.settimeout(5)
            raw_sock.connect((self.host, self.port))
            if self.use_tls:
                import ssl
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                self.sock = ctx.wrap_socket(raw_sock, server_hostname=self.host)
            else:
                self.sock = raw_sock
            if not client_id:
                client_id = "mrhua_" + uuid.uuid4().hex[:12]
            # CONNECT 包
            payload = self._encode_string("MQTT")  # protocol name
            payload += bytes([0x04])  # protocol level (3.1.1)
            payload += bytes([0x02])  # connect flags: clean session
            payload += struct.pack(">H", self.keepalive)  # keepalive
            payload += self._encode_string(client_id)
            self._send_packet(1, 0, payload)
            # 读 CONNACK：1字节固定头 + 剩余长度 + 2字节body
            first_byte = self.sock.recv(1)
            if not first_byte:
                return False
            ptype = first_byte[0] >> 4
            if ptype != 2:
                return False
            rem_len = self._decode_remaining_length(self.sock)
            connack = self.sock.recv(rem_len)
            if len(connack) < 2 or connack[1] != 0:
                return False
            self.connected = True
            self._running = True
            self._recv_thread = threading.Thread(target=self._recv_loop, daemon=True)
            self._recv_thread.start()
            self._ping_thread = threading.Thread(target=self._ping_loop, daemon=True)
            self._ping_thread.start()
            if self._on_connect:
                try:
                    self._on_connect()
                except Exception:
                    pass
            return True
        except Exception:
            self.connected = False
            return False

    def subscribe(self, topic: str, qos: int = 0):
        if not self.connected:
            return
        self._subscriptions[topic] = qos
        packet_id = self._next_packet_id()
        payload = struct.pack(">H", packet_id)
        payload += self._encode_string(topic)
        payload += bytes([qos])
        self._send_packet(8, 2, payload)

    def publish(self, topic: str, payload: bytes, qos: int = 0):
        if not self.connected:
            return
        body = self._encode_string(topic) + payload
        self._send_packet(3, qos, body)

    def disconnect(self):
        self._running = False
        self.connected = False
        try:
            self._send_packet(14, 0)
        except Exception:
            pass
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None
        if self._on_disconnect:
            try:
                self._on_disconnect()
            except Exception:
                pass

    def _ping_loop(self):
        while self._running and self.connected:
            time.sleep(self.keepalive - 5 if self.keepalive > 10 else self.keepalive)
            if not self._running:
                break
            try:
                self._send_packet(12, 0)
            except Exception:
                self.connected = False
                break

    def _recv_loop(self):
        buffer = b""
        while self._running and self.sock:
            try:
                self.sock.settimeout(2)
                data = self.sock.recv(4096)
                if not data:
                    self.connected = False
                    break
                buffer += data
                while len(buffer) >= 2:
                    ptype = buffer[0] >> 4
                    flags = buffer[0] & 0x0F
                    # 解析剩余长度
                    multiplier = 1
                    value = 0
                    pos = 1
                    while True:
                        if pos >= len(buffer):
                            break
                        digit = buffer[pos]
                        value += (digit & 0x7F) * multiplier
                        pos += 1
                        if (digit & 0x80) == 0:
                            break
                        multiplier *= 128
                    if pos >= len(buffer):
                        break
                    total_len = pos + value
                    if len(buffer) < total_len:
                        break
                    packet = buffer[:total_len]
                    buffer = buffer[total_len:]
                    body = packet[pos:]
                    if ptype == 3:  # PUBLISH
                        self._handle_publish(flags, body)
                    elif ptype == 13:  # PINGRESP
                        pass
                    elif ptype == 9:  # SUBACK
                        pass
            except socket.timeout:
                continue
            except Exception:
                self.connected = False
                break
        if self._on_disconnect and not self.connected:
            try:
                self._on_disconnect()
            except Exception:
                pass

    def _handle_publish(self, flags: int, body: bytes):
        try:
            topic_len = struct.unpack(">H", body[:2])[0]
            topic = body[2:2 + topic_len].decode("utf-8")
            payload = body[2 + topic_len:]
            if self._on_message:
                self._on_message(topic, payload)
        except Exception:
            pass
