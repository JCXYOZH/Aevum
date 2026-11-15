"""职责模块：node。"""

from __future__ import annotations

from typing import Optional, Dict, List, Tuple, Set, Callable, Any
from ..paths import DEFAULT_DHT_DIR
import asyncio
import time

from .constants import ALPHA
from .constants import DATA_TTL
from .models import DHTNodeInfo
from .storage import DHTStorage
from .constants import K
from .constants import NODE_TIMEOUT
from .routing import RoutingTable
from .functions import compute_key
from .functions import generate_random_id
from .constants import logger
from .functions import xor_distance

class DHTNode:
    """
    Kademlia DHT节点
    整合路由表、存储、节点发现、内容查找
    """

    def __init__(self, node_id: str, address: str, port: int,
                 storage_dir: str = DEFAULT_DHT_DIR,
                 send_message: Optional[Callable] = None):
        self.node_id = node_id
        self.address = address
        self.port = port
        self.routing_table = RoutingTable(node_id)
        self.storage = DHTStorage(storage_dir)
        self._send_message = send_message  # 由protocol层注入
        self._bootstrap_nodes: List[Tuple[str, int]] = []
        self._maintenance_task: Optional[asyncio.Task] = None
        self._running = False

    def set_send_message(self, send_message: Callable):
        """设置消息发送函数（由protocol层注入）"""
        self._send_message = send_message

    async def add_bootstrap_node(self, address: str, port: int):
        """添加种子节点"""
        self._bootstrap_nodes.append((address, port))

    async def bootstrap(self) -> int:
        """
        引导加入网络
        连接种子节点，执行FIND_NODE查找自己，填充路由表

        Returns:
            发现的节点数
        """
        total_discovered = 0

        for address, port in self._bootstrap_nodes:
            try:
                # 向种子节点发送FIND_NODE请求查找自己
                if self._send_message:
                    response = await self._send_message(
                        address, port,
                        message_type="FIND_NODE",
                        payload={"target_id": self.node_id},
                        channel=1,  # DHT通道
                        timeout=10.0,
                    )

                    if response and "nodes" in response.payload:
                        for node_data in response.payload["nodes"]:
                            node = DHTNodeInfo.from_dict(node_data)
                            if node.node_id != self.node_id:
                                await self.routing_table.add_node(node)
                                total_discovered += 1

                        # 将种子节点本身加入路由表
                        bootstrap_node = DHTNodeInfo(
                            node_id=response.source_node or generate_random_id(),
                            address=address,
                            port=port,
                        )
                        await self.routing_table.add_node(bootstrap_node)

            except Exception as e:
                logger.debug(f"引导节点 {address}:{port} 失败: {e}")

        # 对新发现的节点递归查找自己，进一步填充路由表
        if total_discovered > 0:
            await self._iterative_find_node(self.node_id)

        logger.info(f"DHT引导完成，发现 {total_discovered} 个节点")
        return total_discovered

    async def _iterative_find_node(self, target_id: str) -> List[DHTNodeInfo]:
        """
        迭代式FIND_NODE查找（Kademlia核心算法）

        Args:
            target_id: 目标节点ID

        Returns:
            距离目标最近的K个节点
        """
        # 获取初始最近节点
        closest = await self.routing_table.get_closest_nodes(target_id, ALPHA)
        if not closest:
            return []

        contacted: Set[str] = set()
        closest_so_far = closest[0] if closest else None

        for _ in range(10):  # 最多10轮迭代
            # 选择未联系过的最近ALPHA个节点
            to_contact = [n for n in closest if n.node_id not in contacted][:ALPHA]
            if not to_contact:
                break

            # 并发发送FIND_NODE请求
            tasks = []
            for node in to_contact:
                contacted.add(node.node_id)
                if self._send_message:
                    task = self._send_message(
                        node.address, node.port,
                        message_type="FIND_NODE",
                        payload={"target_id": target_id},
                        channel=1,
                        timeout=5.0,
                    )
                    tasks.append(task)

            if tasks:
                responses = await asyncio.gather(*tasks, return_exceptions=True)

                for response in responses:
                    if isinstance(response, Exception) or response is None:
                        continue
                    if "nodes" in response.payload:
                        for node_data in response.payload["nodes"]:
                            new_node = DHTNodeInfo.from_dict(node_data)
                            if new_node.node_id != self.node_id:
                                await self.routing_table.add_node(new_node)
                                # 更新最近节点列表
                                all_closest = await self.routing_table.get_closest_nodes(target_id, K)
                                closest = all_closest

            # 检查是否有更近的节点
            new_closest = await self.routing_table.get_closest_nodes(target_id, 1)
            if new_closest and closest_so_far:
                if xor_distance(new_closest[0].node_id, target_id) < \
                   xor_distance(closest_so_far.node_id, target_id):
                    closest_so_far = new_closest[0]
                else:
                    # 没有更近的节点了，结束
                    break
            elif new_closest:
                closest_so_far = new_closest[0]

        return await self.routing_table.get_closest_nodes(target_id, K)

    async def find_node(self, target_id: str) -> List[DHTNodeInfo]:
        """公开API：查找节点"""
        return await self._iterative_find_node(target_id)

    async def find_value(self, key: str) -> Tuple[Optional[Any], List[DHTNodeInfo]]:
        """
        查找值（FIND_VALUE）
        如果找到值则返回值，否则返回最近的节点列表

        Returns:
            (值或None, 最近节点列表)
        """
        target_id = compute_key(key)

        # 先查本地
        local_value = await self.storage.retrieve(key)
        if local_value is not None:
            return local_value, []

        # 迭代查找
        closest = await self.routing_table.get_closest_nodes(target_id, ALPHA)
        contacted: Set[str] = set()

        for _ in range(10):
            to_contact = [n for n in closest if n.node_id not in contacted][:ALPHA]
            if not to_contact:
                break

            tasks = []
            for node in to_contact:
                contacted.add(node.node_id)
                if self._send_message:
                    task = self._send_message(
                        node.address, node.port,
                        message_type="FIND_VALUE",
                        payload={"key": key},
                        channel=1,
                        timeout=5.0,
                    )
                    tasks.append(task)

            if tasks:
                responses = await asyncio.gather(*tasks, return_exceptions=True)
                for response in responses:
                    if isinstance(response, Exception) or response is None:
                        continue
                    if "value" in response.payload:
                        # 找到了值，缓存到本地
                        value = response.payload["value"]
                        await self.storage.store(key, value, response.source_node)
                        return value, []
                    if "nodes" in response.payload:
                        for node_data in response.payload["nodes"]:
                            new_node = DHTNodeInfo.from_dict(node_data)
                            if new_node.node_id != self.node_id:
                                await self.routing_table.add_node(new_node)

            closest = await self.routing_table.get_closest_nodes(target_id, K)

        return None, closest

    async def store_value(self, key: str, value: Any, ttl: int = DATA_TTL) -> int:
        """
        存储值到DHT（存储到最近的K个节点）

        Returns:
            成功存储的节点数
        """
        target_id = compute_key(key)

        # 先存本地
        await self.storage.store(key, value, self.node_id, ttl)

        # 找到最近的K个节点
        closest_nodes = await self._iterative_find_node(target_id)

        # 并发存储
        stored_count = 1  # 本地已存
        tasks = []
        for node in closest_nodes[:K]:
            if node.node_id == self.node_id:
                continue
            if self._send_message:
                task = self._send_message(
                    node.address, node.port,
                    message_type="STORE",
                    payload={"key": key, "value": value, "ttl": ttl, "publisher": self.node_id},
                    channel=1,
                    timeout=5.0,
                )
                tasks.append(task)

        if tasks:
            responses = await asyncio.gather(*tasks, return_exceptions=True)
            for response in responses:
                if not isinstance(response, Exception) and response is not None:
                    if response.payload.get("stored", False):
                        stored_count += 1

        return stored_count

    async def handle_find_node(self, target_id: str) -> List[Dict]:
        """处理FIND_NODE请求（返回最近的K个节点）"""
        closest = await self.routing_table.get_closest_nodes(target_id, K)
        return [n.to_dict() for n in closest]

    async def handle_find_value(self, key: str) -> Dict:
        """处理FIND_VALUE请求"""
        value = await self.storage.retrieve(key)
        if value is not None:
            return {"value": value}
        # 没找到值，返回最近节点
        target_id = compute_key(key)
        closest = await self.routing_table.get_closest_nodes(target_id, K)
        return {"nodes": [n.to_dict() for n in closest]}

    async def handle_store(self, key: str, value: Any, publisher: str, ttl: int) -> bool:
        """处理STORE请求"""
        return await self.storage.store(key, value, publisher, ttl)

    async def handle_ping(self) -> Dict:
        """处理PING请求"""
        return {
            "node_id": self.node_id,
            "address": self.address,
            "port": self.port,
            "timestamp": time.time(),
        }

    async def start_maintenance(self):
        """启动后台维护任务"""
        self._running = True
        self._maintenance_task = asyncio.create_task(self._maintenance_loop())

    async def stop_maintenance(self):
        """停止后台维护"""
        self._running = False
        if self._maintenance_task:
            self._maintenance_task.cancel()

    async def _maintenance_loop(self):
        """后台维护循环"""
        while self._running:
            try:
                # 清理过期数据
                expired = await self.storage.cleanup_expired()
                if expired > 0:
                    logger.debug(f"DHT清理过期数据: {expired}条")

                # 重发布数据
                to_republish = await self.storage.get_data_for_republish()
                for data in to_republish:
                    await self.store_value(data.key, data.value, data.ttl)

                # 刷新路由表（检查不活跃节点）
                all_nodes = await self.routing_table.get_all_nodes()
                for node in all_nodes:
                    if time.time() - node.last_seen > NODE_TIMEOUT:
                        await self.routing_table.remove_node(node.node_id)

                await asyncio.sleep(60)  # 每分钟维护一次

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"DHT维护异常: {e}")
                await asyncio.sleep(60)

    async def get_stats(self) -> Dict:
        """获取DHT统计"""
        return {
            "node_id": self.node_id,
            "address": self.address,
            "port": self.port,
            "known_nodes": await self.routing_table.get_node_count(),
            "stored_data": await self.storage.get_data_count(),
            "bucket_stats": await self.routing_table.get_bucket_stats(),
            "bootstrap_nodes": len(self._bootstrap_nodes),
        }
