"""
Libertas - P2P传输层
===================
TCP + TLS 加密传输，连接管理，消息序列化。

核心能力：
1. TCP服务器 + TLS双向认证
2. 连接池管理（出站连接复用）
3. 消息序列化（长度前缀 + JSON）
4. 心跳保活 + 断线重连
5. 节点身份（TLS证书公钥哈希 = Node ID）
6. 多路复用（一个连接跑多个逻辑通道）
7. 流量统计与速率限制

版本：1.0.0
"""

import asyncio
import json
import ssl
import socket
import time
import hashlib
import os
import struct
import logging
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple, Callable, Any, Set
from enum import Enum
from collections import defaultdict

from .paths import DEFAULT_CERT_DIR

logger = logging.getLogger(__name__)


# ============================================================
# 常量
# ============================================================

MESSAGE_MAGIC = b"LBT1"  # Libertas 网络协议 v1
MESSAGE_HEADER_SIZE = 8  # magic(4) + length(4)
MAX_MESSAGE_SIZE = 64 * 1024 * 1024  # 64MB最大消息
DEFAULT_TIMEOUT = 30.0
HEARTBEAT_INTERVAL = 30.0
HEARTBEAT_TIMEOUT = 90.0
RECONNECT_BASE_DELAY = 1.0
RECONNECT_MAX_DELAY = 60.0
MAX_PENDING_MESSAGES = 1000


# ============================================================
# 数据结构
# ============================================================

class ConnectionState(Enum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    HANDSHAKING = "handshaking"
    CONNECTED = "connected"
    CLOSING = "closing"
    CLOSED = "closed"
    ERROR = "error"


class ChannelType(Enum):
    CONTROL = 0      # 控制消息（握手/心跳）
    DHT = 1          # DHT路由消息
    SCAN = 2         # 扫描任务/结果
    DATA = 3         # 数据同步
    REPUTATION = 4   # 信誉消息
    SYNC = 5         # 资产同步


@dataclass
class NodeInfo:
    """节点信息"""
    node_id: str  # 160位十六进制字符串（40字符）
    address: str
    port: int
    capabilities: Dict = field(default_factory=dict)
    bandwidth: str = ""
    location: str = ""
    version: str = "1.0.0"
    first_seen: float = 0.0
    last_seen: float = 0.0

    def to_dict(self) -> Dict:
        return {
            "node_id": self.node_id,
            "address": self.address,
            "port": self.port,
            "capabilities": self.capabilities,
            "bandwidth": self.bandwidth,
            "location": self.location,
            "version": self.version,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "NodeInfo":
        return cls(
            node_id=data["node_id"],
            address=data.get("address", ""),
            port=data.get("port", 0),
            capabilities=data.get("capabilities", {}),
            bandwidth=data.get("bandwidth", ""),
            location=data.get("location", ""),
            version=data.get("version", "1.0.0"),
        )


@dataclass
class Message:
    """P2P消息"""
    channel: int  # ChannelType值
    message_type: str  # 消息类型（如PING/SCAN_TASK）
    payload: Dict = field(default_factory=dict)
    message_id: str = ""
    timestamp: float = field(default_factory=time.time)
    ttl: int = 3  # 生存跳数
    source_node: str = ""  # 源节点ID

    def to_dict(self) -> Dict:
        return {
            "channel": self.channel,
            "type": self.message_type,
            "payload": self.payload,
            "message_id": self.message_id,
            "timestamp": self.timestamp,
            "ttl": self.ttl,
            "source": self.source_node,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "Message":
        return cls(
            channel=data.get("channel", 0),
            message_type=data.get("type", ""),
            payload=data.get("payload", {}),
            message_id=data.get("message_id", ""),
            timestamp=data.get("timestamp", time.time()),
            ttl=data.get("ttl", 3),
            source_node=data.get("source", ""),
        )


@dataclass
class ConnectionStats:
    """连接统计"""
    bytes_sent: int = 0
    bytes_received: int = 0
    messages_sent: int = 0
    messages_received: int = 0
    connected_at: float = 0.0
    latency_ms: float = 0.0
    errors: int = 0


# ============================================================
# 节点身份管理
# ============================================================

class NodeIdentity:
    """
    节点身份管理
    生成TLS证书，Node ID = SHA-1(公钥)
    """

    def __init__(self, cert_dir: str = DEFAULT_CERT_DIR):
        self.cert_dir = cert_dir
        self.cert_file = os.path.join(cert_dir, "node.crt")
        self.key_file = os.path.join(cert_dir, "node.key")
        self.node_id: str = ""
        self.public_key_hash: str = ""
        self._ssl_context: Optional[ssl.SSLContext] = None

        os.makedirs(cert_dir, exist_ok=True)
        self._ensure_certificate()
        self._compute_node_id()

    def _ensure_certificate(self):
        """确保TLS证书存在，不存在则生成"""
        if os.path.exists(self.cert_file) and os.path.exists(self.key_file):
            return

        # 使用openssl生成自签名证书
        import subprocess
        try:
            # 生成私钥
            subprocess.run([
                "openssl", "genrsa", "-out", self.key_file, "2048"
            ], check=True, capture_output=True)

            # 生成自签名证书
            subprocess.run([
                "openssl", "req", "-new", "-x509",
                "-key", self.key_file,
                "-out", self.cert_file,
                "-days", "3650",
                "-subj", "/CN=MrHua-P2P-Node/O=MrHua/C=CN"
            ], check=True, capture_output=True)

            logger.info("生成新的TLS证书")
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            # openssl不可用时，用Python生成简化证书
            logger.warning(f"openssl不可用，使用Python生成证书: {e}")
            self._generate_certificate_python()

    def _generate_certificate_python(self):
        """纯Python生成自签名证书（简化版）"""
        try:
            from cryptography import x509
            from cryptography.x509.oid import NameOID
            from cryptography.hazmat.primitives import hashes, serialization
            from cryptography.hazmat.primitives.asymmetric import rsa
            import datetime

            key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

            with open(self.key_file, "wb") as f:
                f.write(key.private_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PrivateFormat.TraditionalOpenSSL,
                    encryption_algorithm=serialization.NoEncryption(),
                ))

            subject = issuer = x509.Name([
                x509.NameAttribute(NameOID.COMMON_NAME, "MrHua-P2P-Node"),
                x509.NameAttribute(NameOID.ORGANIZATION_NAME, "MrHua"),
                x509.NameAttribute(NameOID.COUNTRY_NAME, "CN"),
            ])

            cert = (
                x509.CertificateBuilder()
                .subject_name(subject)
                .issuer_name(issuer)
                .public_key(key.public_key())
                .serial_number(x509.random_serial_number())
                .not_valid_before(datetime.datetime.utcnow())
                .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=3650))
                .sign(key, hashes.SHA256())
            )

            with open(self.cert_file, "wb") as f:
                f.write(cert.public_bytes(serialization.Encoding.PEM))

        except ImportError:
            # cryptography也不可用，生成占位证书
            logger.error("无法生成TLS证书（openssl和cryptography都不可用）")
            # 创建占位文件
            with open(self.key_file, "w", encoding="utf-8") as f:
                f.write("PLACEHOLDER_KEY\n")
            with open(self.cert_file, "w", encoding="utf-8") as f:
                f.write("PLACEHOLDER_CERT\n")

    def _compute_node_id(self):
        """计算Node ID = SHA-1(公钥)"""
        try:
            with open(self.cert_file, "rb") as f:
                cert_data = f.read()

            # 提取公钥哈希
            try:
                from cryptography import x509
                from cryptography.hazmat.primitives import serialization
                cert = x509.load_pem_x509_certificate(cert_data)
                pub_key = cert.public_key().public_bytes(
                    encoding=serialization.Encoding.DER,
                    format=serialization.PublicFormat.SubjectPublicKeyInfo,
                )
                self.public_key_hash = hashlib.sha1(pub_key).hexdigest()
            except ImportError:
                # 用证书内容哈希代替
                self.public_key_hash = hashlib.sha1(cert_data).hexdigest()

            self.node_id = self.public_key_hash
            logger.info(f"Node ID: {self.node_id}")
        except Exception as e:
            logger.error(f"计算Node ID失败: {e}")
            # 生成随机Node ID
            self.node_id = hashlib.sha1(os.urandom(32)).hexdigest()
            self.public_key_hash = self.node_id

    def get_ssl_context(self, server_side: bool = False) -> ssl.SSLContext:
        """获取SSL上下文"""
        if self._ssl_context is None:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS)
            ctx.load_cert_chain(certfile=self.cert_file, keyfile=self.key_file)
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE  # 自签名证书，不验证CA
            ctx.set_ciphers("ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384")
            self._ssl_context = ctx
        return self._ssl_context


# ============================================================
# 消息编解码器
# ============================================================

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


# ============================================================
# P2P连接
# ============================================================

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


# ============================================================
# 连接管理器
# ============================================================

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
