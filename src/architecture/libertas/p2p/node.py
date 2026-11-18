"""
Libertas - P2P节点主类
======================
整合传输层、DHT路由层、消息协议层、自治规则层。

提供简洁的API：
- start() / stop()
- connect_to_bootstrap()
- create_scan_task()
- get_assets()
- get_network_stats()

版本：1.0.0
"""

import asyncio
import json
import time
import os
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Callable, Any, Set
import logging

from .transport import (
    NodeIdentity, ConnectionManager, P2PConnection, Message,
    ChannelType, NodeInfo,
)
from .dht import DHTNode as DHTNodeCore, compute_key
from .protocol import ProtocolHandler, NodeCapabilities, ProofOfWork
from .consensus import ConsensusEngine, ScanTask, AssetRecord
from .paths import DEFAULT_CERT_DIR, DEFAULT_STATE_DIR, DEFAULT_DHT_DIR

logger = logging.getLogger(__name__)


# ============================================================
# P2P节点
# ============================================================

class P2PNode:
    """
    Libertas P2P 网络节点
    去中心化网络空间测绘的完整节点实现
    """

    def __init__(self,
                 listen_host: str = "0.0.0.0",
                 listen_port: int = 0,
                 cert_dir: str = DEFAULT_CERT_DIR,
                 state_dir: str = DEFAULT_STATE_DIR,
                 dht_dir: str = DEFAULT_DHT_DIR,
                 max_connections: int = 100,
                 capabilities: Optional[NodeCapabilities] = None):
        """
        初始化P2P节点

        Args:
            listen_host: 监听地址
            listen_port: 监听端口（0表示随机）
            cert_dir: TLS证书目录
            state_dir: 状态持久化目录
            dht_dir: DHT数据目录
            max_connections: 最大连接数
            capabilities: 节点能力声明
        """
        self.listen_host = listen_host
        self.listen_port = listen_port
        self.cert_dir = cert_dir
        self.state_dir = state_dir
        self.dht_dir = dht_dir
        self.max_connections = max_connections

        # 创建目录
        os.makedirs(cert_dir, exist_ok=True)
        os.makedirs(state_dir, exist_ok=True)
        os.makedirs(dht_dir, exist_ok=True)

        # 初始化各层
        self.identity = NodeIdentity(cert_dir)
        self.connection_manager = ConnectionManager(self.identity, max_connections)
        self.dht_node = DHTNodeCore(
            node_id=self.identity.node_id,
            address=listen_host,
            port=listen_port,
            storage_dir=dht_dir,
        )
        self.protocol = ProtocolHandler(
            identity=self.identity,
            connection_manager=self.connection_manager,
            dht_node=self.dht_node,
            capabilities=capabilities or NodeCapabilities(),
        )
        self.consensus = ConsensusEngine(
            identity=self.identity,
            protocol=self.protocol,
            dht_node=self.dht_node,
            state_dir=state_dir,
        )

        # 注入DHT节点的消息发送函数
        self.dht_node.set_send_message(self._dht_send_message)

        # 扫描执行器（由外部注入）
        self._scan_executor: Optional[Callable] = None

        # 状态
        self._running = False
        self._server_task: Optional[asyncio.Task] = None
        self._bootstrap_nodes: List[tuple] = []

        logger.info(f"P2P节点初始化完成，Node ID: {self.identity.node_id}")

    # ============================================================
    # 生命周期
    # ============================================================

    async def start(self) -> int:
        """
        启动P2P节点

        Returns:
            实际监听端口
        """
        if self._running:
            return self.listen_port

        # 启动服务器
        actual_port = await self.connection_manager.start_server(
            self.listen_host, self.listen_port
        )
        self.listen_port = actual_port
        self.dht_node.port = actual_port

        # 启动DHT维护
        await self.dht_node.start_maintenance()

        # 启动自治引擎
        await self.consensus.start()

        self._running = True
        logger.info(f"P2P节点启动，监听: {self.listen_host}:{actual_port}")

        return actual_port

    async def stop(self):
        """停止P2P节点"""
        if not self._running:
            return

        self._running = False

        # 停止自治引擎
        await self.consensus.stop()

        # 停止DHT维护
        await self.dht_node.stop_maintenance()

        # 关闭所有连接
        await self.connection_manager.close_all()

        logger.info("P2P节点已停止")

    # ============================================================
    # 网络加入
    # ============================================================

    async def add_bootstrap_node(self, address: str, port: int):
        """添加种子节点"""
        self._bootstrap_nodes.append((address, port))
        await self.dht_node.add_bootstrap_node(address, port)

    async def join_network(self) -> int:
        """
        加入P2P网络
        连接种子节点，DHT引导，节点交换

        Returns:
            发现的节点数
        """
        total_discovered = 0

        for address, port in self._bootstrap_nodes:
            try:
                # 连接并握手
                conn = await self.protocol.connect_and_handshake(address, port)
                if conn:
                    total_discovered += 1
                    logger.info(f"连接种子节点: {address}:{port} ({conn.node_id})")

                    # 节点交换（PEX）
                    response = await self.protocol.send_message(
                        conn.node_id, "PEER_EXCHANGE",
                        {"nodes": []}, channel=ChannelType.CONTROL.value
                    )
                    if response and "nodes" in response.payload:
                        for node_data in response.payload["nodes"]:
                            node_addr = node_data.get("address", "")
                            node_port = node_data.get("port", 0)
                            if node_addr and node_port:
                                await self.add_bootstrap_node(node_addr, node_port)
                                total_discovered += 1

            except Exception as e:
                logger.debug(f"连接种子节点失败 {address}:{port}: {e}")

        # DHT引导
        if total_discovered > 0:
            dht_discovered = await self.dht_node.bootstrap()
            total_discovered += dht_discovered

        logger.info(f"加入网络完成，发现 {total_discovered} 个节点")
        return total_discovered

    async def connect_to_node(self, address: str, port: int) -> bool:
        """手动连接到指定节点"""
        conn = await self.protocol.connect_and_handshake(address, port)
        return conn is not None

    # ============================================================
    # 扫描任务
    # ============================================================

    def set_scan_executor(self, executor: Callable):
        """
        设置扫描执行器
        执行器签名: async def executor(target, ports, scan_type, options) -> List[Dict]
        """
        self._scan_executor = executor
        self.consensus.set_scan_executor(executor)

    async def create_scan_task(self, target: str, ports: List[int],
                                 scan_type: str = "quick", priority: int = 0,
                                 options: Optional[Dict] = None) -> ScanTask:
        """
        创建扫描任务（自动分发到网络）

        Args:
            target: 目标（IP/CIDR/域名）
            ports: 端口列表
            scan_type: 扫描类型（quick/deep/vuln_verify/weak_password）
            priority: 优先级
            options: 其他选项

        Returns:
            扫描任务对象
        """
        return await self.consensus.create_scan_task(
            target, ports, scan_type, priority, options
        )

    def get_task(self, task_id: str) -> Optional[ScanTask]:
        """获取任务状态"""
        return self.consensus.task_distributor.get_task(task_id)

    def get_all_tasks(self) -> List[ScanTask]:
        """获取所有任务"""
        return self.consensus.task_distributor.get_all_tasks()

    # ============================================================
    # 资产查询
    # ============================================================

    def get_asset(self, ip: str) -> Optional[AssetRecord]:
        """获取资产详情"""
        return self.consensus.asset_merger.get_asset(ip)

    def get_all_assets(self) -> List[AssetRecord]:
        """获取所有资产"""
        return self.consensus.asset_merger.get_all_assets()

    def get_high_risk_assets(self, min_risk: float = 70.0) -> List[AssetRecord]:
        """获取高风险资产"""
        return self.consensus.asset_merger.get_assets_by_risk(min_risk)

    def set_on_asset_merged(self, callback: Callable):
        """设置资产合并回调（用于入库到本地数据库）"""
        self.consensus.set_on_asset_merged(callback)

    # ============================================================
    # DHT存储
    # ============================================================

    async def dht_store(self, key: str, value: Any, ttl: int = 86400) -> int:
        """存储数据到DHT"""
        return await self.dht_node.store_value(key, value, ttl)

    async def dht_retrieve(self, key: str) -> Optional[Any]:
        """从DHT检索数据"""
        value, _ = await self.dht_node.find_value(key)
        return value

    # ============================================================
    # 信誉查询
    # ============================================================

    def get_reputation(self, node_id: str) -> float:
        """获取节点信誉"""
        return self.consensus.get_reputation(node_id)

    def get_all_reputations(self) -> List:
        """获取所有节点信誉"""
        return self.consensus.reputation_system.get_all_reputations()

    def is_node_isolated(self, node_id: str) -> bool:
        """检查节点是否被隔离"""
        return self.consensus.is_isolated(node_id)

    # ============================================================
    # 节点信息
    # ============================================================

    def get_connected_nodes(self) -> List[NodeInfo]:
        """获取已连接的节点列表"""
        return self.protocol.get_known_nodes()

    def get_connection_count(self) -> int:
        """获取连接数"""
        return self.connection_manager.get_connection_count()

    def get_node_id(self) -> str:
        """获取自己的节点ID"""
        return self.identity.node_id

    def get_listen_address(self) -> tuple:
        """获取监听地址"""
        return (self.listen_host, self.listen_port)

    # ============================================================
    # 统计
    # ============================================================

    async def get_stats(self) -> Dict:
        """获取节点完整统计"""
        return {
            "node": {
                "node_id": self.identity.node_id,
                "listen_address": f"{self.listen_host}:{self.listen_port}",
                "running": self._running,
                "version": "1.0.0",
            },
            "network": {
                "connected_nodes": self.connection_manager.get_connection_count(),
                "known_nodes": len(self.protocol.get_known_nodes()),
                "bootstrap_nodes": len(self._bootstrap_nodes),
            },
            "dht": await self.dht_node.get_stats(),
            "protocol": await self.protocol.get_stats(),
            "consensus": await self.consensus.get_stats(),
            "transport": self.connection_manager.get_stats(),
        }

    # ============================================================
    # 内部方法
    # ============================================================

    async def _dht_send_message(self, address: str, port: int,
                                  message_type: str, payload: Dict,
                                  channel: int = 1, timeout: float = 5.0) -> Optional[Message]:
        """
        DHT节点的消息发送函数
        先检查是否已有连接，没有则新建
        """
        # 检查是否已有连接
        for conn in self.connection_manager.get_all_connections():
            if conn.address == address and conn.port == port:
                return await self.protocol.send_message(
                    conn.node_id, message_type, payload, channel, timeout
                )

        # 新建连接
        conn = await self.protocol.connect_and_handshake(address, port)
        if conn:
            return await self.protocol.send_message(
                conn.node_id, message_type, payload, channel, timeout
            )

        return None


# ============================================================
# 便捷函数
# ============================================================

async def create_and_start_node(
    listen_port: int = 0,
    bootstrap_nodes: Optional[List[tuple]] = None,
    scan_executor: Optional[Callable] = None,
    capabilities: Optional[NodeCapabilities] = None,
) -> P2PNode:
    """
    便捷函数：创建并启动P2P节点

    Args:
        listen_port: 监听端口
        bootstrap_nodes: 种子节点列表 [(address, port), ...]
        scan_executor: 扫描执行器
        capabilities: 节点能力

    Returns:
        已启动的P2P节点
    """
    node = P2PNode(
        listen_port=listen_port,
        capabilities=capabilities,
    )

    # 添加种子节点
    if bootstrap_nodes:
        for addr, port in bootstrap_nodes:
            await node.add_bootstrap_node(addr, port)

    # 设置扫描执行器
    if scan_executor:
        node.set_scan_executor(scan_executor)

    # 启动
    actual_port = await node.start()
    print(f"P2P节点启动，监听端口: {actual_port}")
    print(f"节点ID: {node.get_node_id()}")

    # 加入网络
    if bootstrap_nodes:
        discovered = await node.join_network()
        print(f"发现 {discovered} 个节点")

    return node
