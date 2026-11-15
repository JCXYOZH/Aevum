"""
Libertas - 节点发现增强
========================
mDNS局域网发现、DNS种子节点、PEX增强、节点健康度传播。

版本：1.0.0
"""

import asyncio
import socket
import struct
import time
import json
import hashlib
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple, Set, Callable
from collections import defaultdict
import logging

logger = logging.getLogger(__name__)


@dataclass
class DiscoveredNode:
    """发现的节点"""
    node_id: str
    address: str
    port: int
    source: str  # mdns/dns_seed/pex/manual
    discovered_at: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    is_online: bool = True
    latency_ms: float = 0.0
    capabilities: Dict = field(default_factory=dict)
    reputation: float = 0.5

    def to_dict(self) -> Dict:
        return {
            "node_id": self.node_id,
            "address": self.address,
            "port": self.port,
            "source": self.source,
            "is_online": self.is_online,
            "latency_ms": self.latency_ms,
            "reputation": self.reputation,
        }


class MdnsDiscovery:
    """mDNS局域网节点发现"""

    MDNS_GROUP = "224.0.0.251"
    MDNS_PORT = 5353
    SERVICE_TYPE = "_libertas._tcp.local"

    def __init__(self, node_id: str, listen_port: int = 0):
        self.node_id = node_id
        self.listen_port = listen_port
        self.discovered: Dict[str, DiscoveredNode] = {}
        self._sock: Optional[socket.socket] = None
        self._running = False
        self._advertise_task: Optional[asyncio.Task] = None

    async def start(self):
        """启动mDNS发现"""
        self._running = True
        try:
            self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self._sock.bind(("", self.MDNS_PORT))
            mreq = struct.pack("4sl", socket.inet_aton(self.MDNS_GROUP), socket.INADDR_ANY)
            self._sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
            self._sock.setblocking(False)
        except Exception as e:
            logger.debug(f"mDNS启动失败: {e}")
            return

        self._advertise_task = asyncio.create_task(self._advertise_loop())
        asyncio.create_task(self._listen_loop())

    async def stop(self):
        self._running = False
        if self._advertise_task:
            self._advertise_task.cancel()
        if self._sock:
            self._sock.close()

    async def _advertise_loop(self):
        """定期广播自己的存在"""
        while self._running:
            try:
                msg = json.dumps({
                    "type": "libertas_node",
                    "node_id": self.node_id,
                    "port": self.listen_port,
                    "timestamp": time.time(),
                }).encode()
                if self._sock:
                    self._sock.sendto(msg, (self.MDNS_GROUP, self.MDNS_PORT))
            except Exception:
                pass
            await asyncio.sleep(30)

    async def _listen_loop(self):
        """监听其他节点的广播"""
        while self._running:
            try:
                if self._sock:
                    loop = asyncio.get_event_loop()
                    data, addr = await loop.sock_recvfrom(self._sock, 4096)
                    try:
                        msg = json.loads(data.decode())
                        if msg.get("type") == "libertas_node":
                            node_id = msg.get("node_id", "")
                            if node_id and node_id != self.node_id:
                                self.discovered[node_id] = DiscoveredNode(
                                    node_id=node_id,
                                    address=addr[0],
                                    port=msg.get("port", 0),
                                    source="mdns",
                                )
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        pass
            except Exception:
                await asyncio.sleep(1)

    def get_discovered_nodes(self) -> List[DiscoveredNode]:
        return list(self.discovered.values())


class DnsSeedDiscovery:
    """DNS种子节点发现"""

    def __init__(self, seed_domains: Optional[List[str]] = None):
        self.seed_domains = seed_domains or [
            "seed.libertas.network",
            "seed1.libertas.network",
        ]
        self.discovered: List[Tuple[str, int]] = []

    async def discover(self) -> List[Tuple[str, int]]:
        """从DNS种子域名解析节点列表"""
        results = []
        for domain in self.seed_domains:
            try:
                loop = asyncio.get_event_loop()
                infos = await loop.getaddrinfo(domain, None)
                for info in infos:
                    ip = info[4][0]
                    results.append((ip, 9000))  # 默认端口
            except Exception as e:
                logger.debug(f"DNS种子解析失败 {domain}: {e}")

        self.discovered = list(set(results))
        return self.discovered


class PeerExchange:
    """节点列表交换（PEX）增强"""

    def __init__(self, node_id: str):
        self.node_id = node_id
        self.known_peers: Dict[str, DiscoveredNode] = {}
        self._exchange_history: Set[str] = set()

    def add_peer(self, node: DiscoveredNode):
        self.known_peers[node.node_id] = node

    def get_peers_for_exchange(self, exclude_node_id: Optional[str] = None,
                                 count: int = 50) -> List[Dict]:
        """获取要交换的节点列表（推荐算法）"""
        peers = []
        for node_id, node in self.known_peers.items():
            if node_id == exclude_node_id:
                continue
            if not node.is_online:
                continue
            peers.append(node.to_dict())

        # 按信誉排序，取前N个
        peers.sort(key=lambda x: x.get("reputation", 0), reverse=True)
        return peers[:count]

    async def exchange_with_peer(self, peer_node_id: str,
                                   send_message: Callable) -> int:
        """与对等节点交换节点列表"""
        if peer_node_id in self._exchange_history:
            return 0
        self._exchange_history.add(peer_node_id)

        try:
            my_peers = self.get_peers_for_exchange(exclude_node_id=peer_node_id)
            response = await send_message(
                peer_node_id, "PEX_EXCHANGE",
                {"peers": my_peers, "node_id": self.node_id},
                channel=0, timeout=10.0,
            )

            if response and "peers" in response.payload:
                new_count = 0
                for peer_data in response.payload["peers"]:
                    node_id = peer_data.get("node_id", "")
                    if node_id and node_id not in self.known_peers:
                        self.known_peers[node_id] = DiscoveredNode(
                            node_id=node_id,
                            address=peer_data.get("address", ""),
                            port=peer_data.get("port", 0),
                            source="pex",
                            reputation=peer_data.get("reputation", 0.5),
                        )
                        new_count += 1
                return new_count
        except Exception as e:
            logger.debug(f"PEX交换失败: {e}")

        return 0

    def get_all_peers(self) -> List[DiscoveredNode]:
        return list(self.known_peers.values())


class NodeHealthMonitor:
    """节点健康度监控与传播"""

    def __init__(self, node_id: str):
        self.node_id = node_id
        self.health_status: Dict[str, Dict] = {}
        self._last_health_check: float = 0

    def update_health(self, node_id: str, status: Dict):
        """更新节点健康状态"""
        self.health_status[node_id] = {
            **status,
            "updated_at": time.time(),
        }

    def get_health(self, node_id: str) -> Optional[Dict]:
        return self.health_status.get(node_id)

    def get_online_nodes(self) -> List[str]:
        return [nid for nid, h in self.health_status.items()
                if h.get("is_online", False)]

    def get_stats(self) -> Dict:
        online = len(self.get_online_nodes())
        return {
            "total_monitored": len(self.health_status),
            "online": online,
            "offline": len(self.health_status) - online,
        }


class NodeDiscoveryEngine:
    """节点发现引擎（整合所有发现方式）"""

    def __init__(self, node_id: str, listen_port: int = 0,
                 seed_domains: Optional[List[str]] = None):
        self.node_id = node_id
        self.mdns = MdnsDiscovery(node_id, listen_port)
        self.dns_seed = DnsSeedDiscovery(seed_domains)
        self.pex = PeerExchange(node_id)
        self.health_monitor = NodeHealthMonitor(node_id)
        self._all_nodes: Dict[str, DiscoveredNode] = {}

    async def start(self):
        await self.mdns.start()

    async def stop(self):
        await self.mdns.stop()

    async def discover_all(self) -> List[DiscoveredNode]:
        """执行所有发现方式"""
        # DNS种子
        dns_nodes = await self.dns_seed.discover()
        for addr, port in dns_nodes:
            node_id = hashlib.sha256(f"{addr}:{port}".encode()).hexdigest()[:40]
            if node_id not in self._all_nodes:
                self._all_nodes[node_id] = DiscoveredNode(
                    node_id=node_id, address=addr, port=port, source="dns_seed"
                )

        # mDNS
        for node in self.mdns.get_discovered_nodes():
            self._all_nodes[node.node_id] = node

        # PEX
        for node in self.pex.get_all_peers():
            self._all_nodes[node.node_id] = node

        return list(self._all_nodes.values())

    def add_manual_node(self, node_id: str, address: str, port: int):
        """手动添加节点"""
        self._all_nodes[node_id] = DiscoveredNode(
            node_id=node_id, address=address, port=port, source="manual"
        )

    def get_all_nodes(self) -> List[DiscoveredNode]:
        return list(self._all_nodes.values())

    def get_online_nodes(self) -> List[DiscoveredNode]:
        return [n for n in self._all_nodes.values() if n.is_online]

    def get_stats(self) -> Dict:
        return {
            "total_discovered": len(self._all_nodes),
            "online": len(self.get_online_nodes()),
            "mdns_discovered": len(self.mdns.discovered),
            "dns_seed_discovered": len(self.dns_seed.discovered),
            "pex_peers": len(self.pex.known_peers),
            "health": self.health_monitor.get_stats(),
        }
