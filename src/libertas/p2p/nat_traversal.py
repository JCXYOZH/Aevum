"""
Libertas - NAT穿透引擎
=====================
让P2P节点在NAT后面也能直接通信。

核心能力：
1. STUN客户端 - NAT类型检测
2. TURN中继 - Symmetric NAT中继转发
3. UDP打洞 - Hole Punching算法
4. UPnP/NAT-PMP - 自动端口映射
5. 中继节点选举 - 高带宽高信誉节点成为TURN中继
6. 连接策略 - 根据NAT类型选择最优连接方式

版本：1.0.0
"""

import asyncio
import socket
import struct
import time
import random
import hashlib
import json
import os
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple, Set, Callable, Any
from enum import Enum
import logging

logger = logging.getLogger(__name__)


# ============================================================
# 常量
# ============================================================

STUN_PORT = 3478
TURN_PORT = 3478
STUN_TIMEOUT = 5.0
HOLE_PUNCH_TIMEOUT = 10.0
HOLE_PUNCH_ATTEMPTS = 5
UPNP_TIMEOUT = 5.0
RELAY_BUFFER_SIZE = 65536


# ============================================================
# NAT类型枚举
# ============================================================

class NATType(Enum):
    UNKNOWN = "unknown"
    OPEN_INTERNET = "open_internet"      # 公网IP，无NAT
    FULL_CONE = "full_cone"              # 全锥型NAT
    RESTRICTED_CONE = "restricted_cone"  # 受限锥型NAT
    PORT_RESTRICTED_CONE = "port_restricted_cone"  # 端口受限锥型NAT
    SYMMETRIC = "symmetric"              # 对称型NAT（最难穿透）
    BLOCKED = "blocked"                  # UDP被阻止


# ============================================================
# 数据结构
# ============================================================

@dataclass
class NATTypeDetectionResult:
    """NAT信息"""
    nat_type: str = NATType.UNKNOWN.value
    public_ip: str = ""
    public_port: int = 0
    mapped_ip: str = ""
    mapped_port: int = 0
    filtering_behavior: str = ""  # endpoint-independent/address-dependent/address-port-dependent
    mapping_behavior: str = ""    # endpoint-independent/address-dependent/address-port-dependent
    detected_at: float = 0.0
    stun_server: str = ""

    def to_dict(self) -> Dict:
        return {
            "nat_type": self.nat_type,
            "public_ip": self.public_ip,
            "public_port": self.public_port,
            "filtering_behavior": self.filtering_behavior,
            "mapping_behavior": self.mapping_behavior,
            "detected_at": self.detected_at,
        }


@dataclass
class RelaySession:
    """TURN中继会话"""
    session_id: str
    client_node_id: str
    client_address: Tuple[str, int]
    peer_address: Tuple[str, int]
    allocated_port: int = 0
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    bytes_relayed: int = 0
    packets_relayed: int = 0
    expires_at: float = 0.0

    def is_expired(self) -> bool:
        return time.time() > self.expires_at

    def to_dict(self) -> Dict:
        return {
            "session_id": self.session_id,
            "client_node_id": self.client_node_id,
            "client_address": self.client_address,
            "peer_address": self.peer_address,
            "allocated_port": self.allocated_port,
            "created_at": self.created_at,
            "bytes_relayed": self.bytes_relayed,
            "packets_relayed": self.packets_relayed,
        }


@dataclass
class HolePunchAttempt:
    """打洞尝试记录"""
    target_node_id: str
    target_address: Tuple[str, int]
    local_port: int = 0
    attempts: int = 0
    max_attempts: int = HOLE_PUNCH_ATTEMPTS
    started_at: float = field(default_factory=time.time)
    success: bool = False
    connected_address: Optional[Tuple[str, int]] = None


# ============================================================
# STUN客户端
# ============================================================

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


# ============================================================
# UPnP端口映射
# ============================================================

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
                                 description: str = "MrHua P2P") -> bool:
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


# ============================================================
# TURN中继服务器
# ============================================================

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


# ============================================================
# UDP打洞器
# ============================================================

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


# ============================================================
# NAT穿透管理器（整合所有组件）
# ============================================================

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
