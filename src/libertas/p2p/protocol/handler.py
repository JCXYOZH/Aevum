"""职责模块：handler。"""

from __future__ import annotations

from typing import Optional, Dict, List, Tuple, Callable, Any, Set
from ..transport import NodeIdentity, ConnectionManager, P2PConnection, Message, ChannelType, ConnectionState, NodeInfo
from ..dht import DHTNode as DHTNodeCore, DHTNodeInfo, compute_key
import asyncio
import time
import uuid

from .constants import CHALLENGE_DIFFICULTY
from .constants import HANDSHAKE_TIMEOUT
from .models import NodeCapabilities
from .constants import PROTOCOL_VERSION
from .models import ProofOfWork
from .constants import REQUEST_TIMEOUT
from .constants import logger

class ProtocolHandler:
    """
    P2P协议处理器
    处理所有消息类型，管理握手、请求-响应匹配
    """

    def __init__(self, identity: NodeIdentity, connection_manager: ConnectionManager,
                 dht_node: Optional[DHTNodeCore] = None,
                 capabilities: Optional[NodeCapabilities] = None):
        self.identity = identity
        self.conn_manager = connection_manager
        self.dht_node = dht_node
        self.capabilities = capabilities or NodeCapabilities()

        self._pending_requests: Dict[str, asyncio.Future] = {}
        self._handshake_pending: Dict[str, asyncio.Future] = {}
        self._known_nodes: Dict[str, NodeInfo] = {}
        self._message_handlers: Dict[str, Callable] = {}
        self._challenge_cache: Dict[str, str] = {}  # node_id -> challenge

        # 注册默认消息处理器
        self._register_default_handlers()

        # 注册连接管理器的消息回调
        self.conn_manager.register_message_handler(self._on_message)
        self.conn_manager.register_connect_handler(self._on_connect)
        self.conn_manager.register_disconnect_handler(self._on_disconnect)

    def register_handler(self, message_type: str, handler: Callable):
        """注册自定义消息处理器"""
        self._message_handlers[message_type] = handler

    def _register_default_handlers(self):
        """注册默认消息处理器"""
        self._message_handlers = {
            "HELLO": self._handle_hello,
            "PING": self._handle_ping,
            "PONG": self._handle_pong,
            "BYE": self._handle_bye,
            "FIND_NODE": self._handle_find_node,
            "FIND_VALUE": self._handle_find_value,
            "STORE": self._handle_store,
            "PEER_EXCHANGE": self._handle_peer_exchange,
            "CHALLENGE": self._handle_challenge,
            "CHALLENGE_RESP": self._handle_challenge_resp,
            "SCAN_TASK": self._handle_scan_task,
            "SCAN_RESULT": self._handle_scan_result,
            "TASK_COMPLETE": self._handle_task_complete,
            "ASSET_SYNC": self._handle_asset_sync,
            "ASSET_SYNC_REQUEST": self._handle_asset_sync_request,
            "REPUTATION_VOTE": self._handle_reputation_vote,
            "REPUTATION_QUERY": self._handle_reputation_query,
        }

    async def _on_message(self, conn: P2PConnection, message: Message):
        """处理收到的消息（入口）"""
        # 更新源节点
        if not message.source_node:
            message.source_node = conn.node_id

        # 检查是否是待处理的请求响应
        if message.message_id and message.message_id in self._pending_requests:
            future = self._pending_requests.pop(message.message_id)
            if not future.done():
                future.set_result(message)
            return

        # 分发到处理器
        handler = self._message_handlers.get(message.message_type)
        if handler:
            try:
                response = await handler(conn, message)
                if response is not None and message.message_id:
                    # 发送响应
                    response_msg = Message(
                        channel=message.channel,
                        message_type=message.message_type + "_RESP",
                        payload=response if isinstance(response, dict) else {"result": response},
                        message_id=message.message_id,
                        source_node=self.identity.node_id,
                    )
                    await conn.send(response_msg)
            except Exception as e:
                logger.error(f"消息处理异常 {message.message_type}: {e}")
        else:
            logger.debug(f"未处理的消息类型: {message.message_type}")

    async def _on_connect(self, conn: P2PConnection):
        """连接建立时"""
        logger.info(f"连接建立: {conn.node_id} ({conn.address}:{conn.port})")

    async def _on_disconnect(self, conn: P2PConnection):
        """连接断开时"""
        # 完成所有待处理的请求
        for msg_id, future in list(self._pending_requests.items()):
            if not future.done():
                future.set_result(None)
        self._pending_requests.clear()

        for node_id, future in list(self._handshake_pending.items()):
            if not future.done():
                future.set_result(None)
        self._handshake_pending.clear()

    # ============================================================
    # 握手协议
    # ============================================================

    async def perform_handshake(self, conn: P2PConnection) -> bool:
        """
        执行出站握手

        Returns:
            是否握手成功
        """
        # 发送HELLO
        hello_msg = Message(
            channel=ChannelType.CONTROL.value,
            message_type="HELLO",
            payload={
                "node_id": self.identity.node_id,
                "version": PROTOCOL_VERSION,
                "listen_port": self.conn_manager._listen_port,
                "capabilities": self.capabilities.to_dict(),
                "timestamp": time.time(),
            },
            source_node=self.identity.node_id,
        )

        # 等待HELLO_ACK
        future = asyncio.get_event_loop().create_future()
        self._handshake_pending[conn.node_id or conn.address] = future

        await conn.send(hello_msg)

        try:
            response = await asyncio.wait_for(future, timeout=HANDSHAKE_TIMEOUT)
            if response and response.payload.get("accepted", False):
                remote_node_id = response.payload.get("node_id", "")
                conn.node_id = remote_node_id

                # 记录节点信息
                self._known_nodes[remote_node_id] = NodeInfo(
                    node_id=remote_node_id,
                    address=conn.address,
                    port=response.payload.get("listen_port", conn.port),
                    capabilities=response.payload.get("capabilities", {}),
                    version=response.payload.get("version", ""),
                    first_seen=time.time(),
                    last_seen=time.time(),
                )

                # 添加到DHT路由表
                if self.dht_node:
                    from ..dht import DHTNodeInfo
                    dht_node = DHTNodeInfo(
                        node_id=remote_node_id,
                        address=conn.address,
                        port=response.payload.get("listen_port", conn.port),
                        capabilities=response.payload.get("capabilities", {}),
                    )
                    await self.dht_node.routing_table.add_node(dht_node)

                return True
            return False
        except asyncio.TimeoutError:
            return False
        finally:
            self._handshake_pending.pop(conn.node_id or conn.address, None)

    async def _handle_hello(self, conn: P2PConnection, message: Message) -> Dict:
        """处理入站HELLO"""
        remote_node_id = message.payload.get("node_id", "")
        remote_version = message.payload.get("version", "")
        remote_listen_port = message.payload.get("listen_port", 0)
        remote_caps = message.payload.get("capabilities", {})

        # 版本兼容性检查
        if remote_version.split(".")[0] != PROTOCOL_VERSION.split(".")[0]:
            return {
                "accepted": False,
                "reason": "incompatible_version",
                "node_id": self.identity.node_id,
            }

        # 设置连接的节点ID
        conn.node_id = remote_node_id

        # 记录节点信息
        self._known_nodes[remote_node_id] = NodeInfo(
            node_id=remote_node_id,
            address=conn.address,
            port=remote_listen_port,
            capabilities=remote_caps,
            version=remote_version,
            first_seen=time.time(),
            last_seen=time.time(),
        )

        # 添加到DHT路由表
        if self.dht_node:
            from ..dht import DHTNodeInfo
            dht_node = DHTNodeInfo(
                node_id=remote_node_id,
                address=conn.address,
                port=remote_listen_port,
                capabilities=remote_caps,
            )
            await self.dht_node.routing_table.add_node(dht_node)

        # 如果是出站连接的握手响应，完成future
        if conn.address in self._handshake_pending:
            future = self._handshake_pending.pop(conn.address)
            if not future.done():
                # 构造一个伪响应
                resp_msg = Message(
                    channel=0, message_type="HELLO_ACK",
                    payload={"accepted": True, "node_id": remote_node_id,
                             "listen_port": remote_listen_port, "capabilities": remote_caps},
                )
                future.set_result(resp_msg)

        return {
            "accepted": True,
            "node_id": self.identity.node_id,
            "version": PROTOCOL_VERSION,
            "listen_port": self.conn_manager._listen_port,
            "capabilities": self.capabilities.to_dict(),
            "timestamp": time.time(),
        }

    # ============================================================
    # 心跳
    # ============================================================

    async def _handle_ping(self, conn: P2PConnection, message: Message) -> Dict:
        """处理PING"""
        return {
            "node_id": self.identity.node_id,
            "timestamp": time.time(),
            "latency": time.time() - message.timestamp,
        }

    async def _handle_pong(self, conn: P2PConnection, message: Message):
        """处理PONG（更新延迟）"""
        if message.timestamp:
            conn.stats.latency_ms = (time.time() - message.timestamp) * 1000

    async def _handle_bye(self, conn: P2PConnection, message: Message):
        """处理BYE（优雅断开）"""
        await conn.close()

    # ============================================================
    # DHT消息
    # ============================================================

    async def _handle_find_node(self, conn: P2PConnection, message: Message) -> Dict:
        """处理FIND_NODE"""
        target_id = message.payload.get("target_id", "")
        if self.dht_node:
            nodes = await self.dht_node.handle_find_node(target_id)
            return {"nodes": nodes}
        return {"nodes": []}

    async def _handle_find_value(self, conn: P2PConnection, message: Message) -> Dict:
        """处理FIND_VALUE"""
        key = message.payload.get("key", "")
        if self.dht_node:
            return await self.dht_node.handle_find_value(key)
        return {"nodes": []}

    async def _handle_store(self, conn: P2PConnection, message: Message) -> Dict:
        """处理STORE"""
        key = message.payload.get("key", "")
        value = message.payload.get("value")
        publisher = message.payload.get("publisher", conn.node_id)
        ttl = message.payload.get("ttl", 86400)

        if self.dht_node:
            stored = await self.dht_node.handle_store(key, value, publisher, ttl)
            return {"stored": stored}
        return {"stored": False}

    # ============================================================
    # 节点交换（PEX）
    # ============================================================

    async def _handle_peer_exchange(self, conn: P2PConnection, message: Message) -> Dict:
        """处理PEER_EXCHANGE"""
        # 返回已知节点列表
        nodes = []
        for node_info in list(self._known_nodes.values())[:50]:
            if node_info.node_id != conn.node_id:
                nodes.append(node_info.to_dict())

        # 同时把对方给的节点加入已知列表
        remote_nodes = message.payload.get("nodes", [])
        for node_data in remote_nodes:
            node_id = node_data.get("node_id", "")
            if node_id and node_id not in self._known_nodes:
                self._known_nodes[node_id] = NodeInfo.from_dict(node_data)

        return {"nodes": nodes}

    # ============================================================
    # 防滥用挑战
    # ============================================================

    async def _handle_challenge(self, conn: P2PConnection, message: Message) -> Dict:
        """处理CHALLENGE（需要求解工作量证明）"""
        challenge = message.payload.get("challenge", "")
        difficulty = message.payload.get("difficulty", CHALLENGE_DIFFICULTY)

        # 求解（在后台线程中执行，避免阻塞）
        loop = asyncio.get_event_loop()
        nonce, attempts = await loop.run_in_executor(
            None, ProofOfWork.solve, challenge, difficulty
        )

        return {
            "challenge": challenge,
            "nonce": nonce,
            "attempts": attempts,
        }

    async def _handle_challenge_resp(self, conn: P2PConnection, message: Message):
        """处理CHALLENGE_RESP（验证工作量证明）"""
        challenge = message.payload.get("challenge", "")
        nonce = message.payload.get("nonce", "")
        difficulty = message.payload.get("difficulty", CHALLENGE_DIFFICULTY)

        valid = ProofOfWork.verify(challenge, nonce, difficulty)
        if valid:
            # 验证通过，节点可以加入网络
            self._challenge_cache.pop(conn.node_id, None)
        else:
            # 验证失败，断开连接
            logger.warning(f"节点 {conn.node_id} 工作量证明验证失败")
            await conn.close()

    # ============================================================
    # 扫描任务消息（由consensus层覆盖处理）
    # ============================================================

    async def _handle_scan_task(self, conn: P2PConnection, message: Message) -> Dict:
        """处理SCAN_TASK（默认拒绝，由consensus层覆盖）"""
        return {"accepted": False, "reason": "not_implemented"}

    async def _handle_scan_result(self, conn: P2PConnection, message: Message):
        """处理SCAN_RESULT（由consensus层覆盖）"""
        pass

    async def _handle_task_complete(self, conn: P2PConnection, message: Message):
        """处理TASK_COMPLETE（由consensus层覆盖）"""
        pass

    # ============================================================
    # 资产同步消息
    # ============================================================

    async def _handle_asset_sync(self, conn: P2PConnection, message: Message) -> Dict:
        """处理ASSET_SYNC（接收资产数据）"""
        assets = message.payload.get("assets", [])
        # 由consensus层处理实际入库
        return {"received": len(assets), "status": "ok"}

    async def _handle_asset_sync_request(self, conn: P2PConnection, message: Message) -> Dict:
        """处理ASSET_SYNC_REQUEST（请求资产数据）"""
        # 由consensus层处理
        return {"assets": [], "status": "no_data"}

    # ============================================================
    # 信誉消息
    # ============================================================

    async def _handle_reputation_vote(self, conn: P2PConnection, message: Message):
        """处理REPUTATION_VOTE（由consensus层覆盖）"""
        pass

    async def _handle_reputation_query(self, conn: P2PConnection, message: Message) -> Dict:
        """处理REPUTATION_QUERY（由consensus层覆盖）"""
        return {"reputation": 0.5, "votes": 0}

    # ============================================================
    # 公开API：发送消息
    # ============================================================

    async def send_message(self, node_id: str, message_type: str,
                            payload: Dict, channel: int = 0,
                            timeout: float = REQUEST_TIMEOUT) -> Optional[Message]:
        """
        向指定节点发送消息并等待响应

        Args:
            node_id: 目标节点ID
            message_type: 消息类型
            payload: 消息载荷
            channel: 通道号
            timeout: 超时时间

        Returns:
            响应消息或None
        """
        msg = Message(
            channel=channel,
            message_type=message_type,
            payload=payload,
            message_id=str(uuid.uuid4())[:8],
            source_node=self.identity.node_id,
        )

        future = asyncio.get_event_loop().create_future()
        self._pending_requests[msg.message_id] = future

        try:
            sent = await self.conn_manager.send_to_node(node_id, msg)
            if not sent:
                self._pending_requests.pop(msg.message_id, None)
                return None

            response = await asyncio.wait_for(future, timeout=timeout)
            return response
        except asyncio.TimeoutError:
            self._pending_requests.pop(msg.message_id, None)
            return None
        except Exception:
            self._pending_requests.pop(msg.message_id, None)
            return None

    async def broadcast_message(self, message_type: str, payload: Dict,
                                 channel: int = 0, exclude: Optional[Set[str]] = None) -> int:
        """广播消息"""
        msg = Message(
            channel=channel,
            message_type=message_type,
            payload=payload,
            message_id=str(uuid.uuid4())[:8],
            source_node=self.identity.node_id,
        )
        return await self.conn_manager.broadcast(msg, exclude=exclude)

    async def connect_and_handshake(self, address: str, port: int) -> Optional[P2PConnection]:
        """连接到节点并执行握手"""
        conn = await self.conn_manager.connect_to(address, port)
        if conn:
            success = await self.perform_handshake(conn)
            if success:
                return conn
            else:
                await conn.close()
        return None

    def get_known_nodes(self) -> List[NodeInfo]:
        """获取已知节点列表"""
        return list(self._known_nodes.values())

    def get_node_info(self, node_id: str) -> Optional[NodeInfo]:
        """获取节点信息"""
        return self._known_nodes.get(node_id)

    async def get_stats(self) -> Dict:
        """获取协议层统计"""
        return {
            "known_nodes": len(self._known_nodes),
            "pending_requests": len(self._pending_requests),
            "pending_handshakes": len(self._handshake_pending),
            "registered_handlers": len(self._message_handlers),
            "protocol_version": PROTOCOL_VERSION,
            "challenge_difficulty": CHALLENGE_DIFFICULTY,
            "capabilities": self.capabilities.to_dict(),
        }
