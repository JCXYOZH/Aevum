"""
Libertas - Kademlia DHT 路由层
==============================
分布式哈希表，节点发现，内容寻址存储。

核心能力：
1. Kademlia DHT（160位节点ID，XOR距离）
2. K桶路由表（k=20，alpha=3）
3. 节点发现（FIND_NODE递归查找）
4. 内容存储（STORE，冗余到最近K个节点）
5. 内容查找（FIND_VALUE）
6. 节点保活（PING/republish）
7. 种子节点引导

版本：1.0.0
"""

import asyncio
import hashlib
import time
import json
import os
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple, Set, Callable, Any
from collections import OrderedDict
import logging

from .paths import DEFAULT_DHT_DIR

logger = logging.getLogger(__name__)


# ============================================================
# 常量
# ============================================================

KEY_SIZE = 160  # 节点ID位数
K = 20  # 每个K桶的最大节点数
ALPHA = 3  # 并发查找数
NODE_TIMEOUT = 3600  # 节点超时时间（秒）
REPUBLISH_INTERVAL = 3600  # 数据重发布间隔
DATA_TTL = 86400  # 数据过期时间（秒）
MAX_DATA_SIZE = 1024 * 1024  # 单条数据最大1MB


# ============================================================
# 工具函数
# ============================================================

def node_id_to_int(node_id: str) -> int:
    """节点ID（十六进制字符串）转整数"""
    return int(node_id, 16)


def int_to_node_id(value: int) -> str:
    """整数转节点ID"""
    return format(value, f"0{KEY_SIZE // 4}x")


def xor_distance(node_id1: str, node_id2: str) -> int:
    """计算两个节点ID的XOR距离"""
    return node_id_to_int(node_id1) ^ node_id_to_int(node_id2)


def distance_bucket(distance: int) -> int:
    """计算距离属于哪个K桶（0-159）"""
    if distance == 0:
        return 0
    return distance.bit_length() - 1


def generate_random_id() -> str:
    """生成随机节点ID"""
    import os
    return hashlib.sha1(os.urandom(32)).hexdigest()


def compute_key(key: str) -> str:
    """计算内容键的哈希（用于DHT存储）"""
    return hashlib.sha1(key.encode("utf-8")).hexdigest()


# ============================================================
# 数据结构
# ============================================================

@dataclass
class DHTNodeInfo:
    """DHT 路由表中的节点描述。"""
    node_id: str
    address: str
    port: int
    last_seen: float = field(default_factory=time.time)
    capabilities: Dict = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "node_id": self.node_id,
            "address": self.address,
            "port": self.port,
            "last_seen": self.last_seen,
            "capabilities": self.capabilities,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "DHTNodeInfo":
        return cls(
            node_id=data["node_id"],
            address=data.get("address", ""),
            port=data.get("port", 0),
            last_seen=data.get("last_seen", time.time()),
            capabilities=data.get("capabilities", {}),
        )


@dataclass
class DHTData:
    """DHT存储的数据"""
    key: str
    value: Any
    publisher: str  # 发布者节点ID
    timestamp: float = field(default_factory=time.time)
    ttl: int = DATA_TTL

    def is_expired(self) -> bool:
        return time.time() - self.timestamp > self.ttl

    def to_dict(self) -> Dict:
        return {
            "key": self.key,
            "value": self.value,
            "publisher": self.publisher,
            "timestamp": self.timestamp,
            "ttl": self.ttl,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "DHTData":
        return cls(
            key=data["key"],
            value=data["value"],
            publisher=data.get("publisher", ""),
            timestamp=data.get("timestamp", time.time()),
            ttl=data.get("ttl", DATA_TTL),
        )


# ============================================================
# K桶路由表
# ============================================================

class KBucket:
    """单个K桶"""

    def __init__(self, bucket_index: int):
        self.bucket_index = bucket_index
        self.nodes: "OrderedDict[str, DHTNodeInfo]" = OrderedDict()
        self.last_updated = time.time()

    def add_node(self, node: DHTNodeInfo) -> Tuple[bool, Optional[DHTNodeInfo]]:
        """
        添加节点到K桶

        Returns:
            (是否添加成功, 需要被替换的最旧节点（如果桶满了）)
        """
        if node.node_id in self.nodes:
            # 已存在，移到末尾（最近使用）
            self.nodes.move_to_end(node.node_id)
            self.nodes[node.node_id].last_seen = time.time()
            self.last_updated = time.time()
            return True, None

        if len(self.nodes) < K:
            # 桶未满，直接添加
            self.nodes[node.node_id] = node
            self.last_updated = time.time()
            return True, None

        # 桶满了，返回最旧节点（需要检查是否存活）
        oldest_id = next(iter(self.nodes))
        oldest_node = self.nodes[oldest_id]
        return False, oldest_node

    def remove_node(self, node_id: str):
        """移除节点"""
        if node_id in self.nodes:
            del self.nodes[node_id]
            self.last_updated = time.time()

    def get_nodes(self, count: int = K) -> List[DHTNodeInfo]:
        """获取桶中节点（按最近使用排序）"""
        return list(self.nodes.values())[-count:]

    def get_closest_nodes(self, target_id: str, count: int = K) -> List[DHTNodeInfo]:
        """获取桶中距离目标最近的节点"""
        nodes = list(self.nodes.values())
        nodes.sort(key=lambda n: xor_distance(n.node_id, target_id))
        return nodes[:count]

    def is_full(self) -> bool:
        return len(self.nodes) >= K

    def __len__(self) -> int:
        return len(self.nodes)

    def __contains__(self, node_id: str) -> bool:
        return node_id in self.nodes


class RoutingTable:
    """
    Kademlia路由表
    由160个K桶组成（对应160位ID的每个bit位置）
    """

    def __init__(self, own_node_id: str):
        self.own_node_id = own_node_id
        self.buckets: List[KBucket] = [KBucket(i) for i in range(KEY_SIZE)]
        self._lock = asyncio.Lock()

    def _get_bucket_index(self, node_id: str) -> int:
        """获取节点属于哪个K桶"""
        distance = xor_distance(self.own_node_id, node_id)
        return distance_bucket(distance)

    async def add_node(self, node: DHTNodeInfo) -> Tuple[bool, Optional[DHTNodeInfo]]:
        """添加节点到路由表"""
        if node.node_id == self.own_node_id:
            return False, None

        bucket_index = self._get_bucket_index(node.node_id)
        async with self._lock:
            bucket = self.buckets[bucket_index]
            return bucket.add_node(node)

    async def remove_node(self, node_id: str):
        """从路由表移除节点"""
        bucket_index = self._get_bucket_index(node_id)
        async with self._lock:
            self.buckets[bucket_index].remove_node(node_id)

    async def get_closest_nodes(self, target_id: str, count: int = K) -> List[DHTNodeInfo]:
        """获取距离目标最近的K个节点"""
        all_nodes = []
        async with self._lock:
            for bucket in self.buckets:
                all_nodes.extend(bucket.get_nodes())

        all_nodes.sort(key=lambda n: xor_distance(n.node_id, target_id))
        return all_nodes[:count]

    async def get_all_nodes(self) -> List[DHTNodeInfo]:
        """获取所有已知节点"""
        nodes = []
        async with self._lock:
            for bucket in self.buckets:
                nodes.extend(bucket.get_nodes())
        return nodes

    async def get_node_count(self) -> int:
        """获取已知节点总数"""
        async with self._lock:
            return sum(len(b) for b in self.buckets)

    async def get_bucket_stats(self) -> List[Dict]:
        """获取K桶统计"""
        stats = []
        async with self._lock:
            for i, bucket in enumerate(self.buckets):
                if len(bucket) > 0:
                    stats.append({
                        "bucket": i,
                        "node_count": len(bucket),
                        "last_updated": bucket.last_updated,
                    })
        return stats

    async def refresh_bucket(self, bucket_index: int):
        """刷新K桶（标记需要更新）"""
        async with self._lock:
            self.buckets[bucket_index].last_updated = time.time()


# ============================================================
# DHT存储
# ============================================================

class DHTStorage:
    """
    DHT本地存储
    存储内容键值对，支持过期和重发布
    """

    def __init__(self, storage_dir: str = DEFAULT_DHT_DIR):
        self.storage_dir = storage_dir
        self.data: Dict[str, DHTData] = {}
        self._lock = asyncio.Lock()
        os.makedirs(storage_dir, exist_ok=True)
        self._load()

    async def store(self, key: str, value: Any, publisher: str, ttl: int = DATA_TTL) -> bool:
        """存储数据"""
        data_key = compute_key(key)
        data = DHTData(
            key=data_key,
            value=value,
            publisher=publisher,
            ttl=ttl,
        )
        async with self._lock:
            self.data[data_key] = data
        self._save()
        return True

    async def retrieve(self, key: str) -> Optional[Any]:
        """检索数据"""
        data_key = compute_key(key)
        async with self._lock:
            data = self.data.get(data_key)
            if data and not data.is_expired():
                return data.value
            if data and data.is_expired():
                del self.data[data_key]
        return None

    async def remove(self, key: str) -> bool:
        """删除数据"""
        data_key = compute_key(key)
        async with self._lock:
            if data_key in self.data:
                del self.data[data_key]
                self._save()
                return True
        return False

    async def get_keys(self) -> List[str]:
        """获取所有存储的键"""
        async with self._lock:
            return list(self.data.keys())

    async def get_data_count(self) -> int:
        """获取存储数据条数"""
        async with self._lock:
            return len(self.data)

    async def cleanup_expired(self) -> int:
        """清理过期数据"""
        expired = []
        async with self._lock:
            for key, data in self.data.items():
                if data.is_expired():
                    expired.append(key)
            for key in expired:
                del self.data[key]
        if expired:
            self._save()
        return len(expired)

    async def get_data_for_republish(self) -> List[DHTData]:
        """获取需要重发布的数据"""
        now = time.time()
        result = []
        async with self._lock:
            for data in self.data.values():
                # 超过一半TTL的数据需要重发布
                if not data.is_expired() and (now - data.timestamp) > data.ttl / 2:
                    result.append(data)
        return result

    def _save(self):
        """持久化到磁盘"""
        try:
            filepath = os.path.join(self.storage_dir, "dht_store.json")
            data_list = [d.to_dict() for d in self.data.values()]
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data_list, f, ensure_ascii=False)
        except Exception as e:
            logger.error(f"DHT存储持久化失败: {e}")

    def _load(self):
        """从磁盘加载"""
        try:
            filepath = os.path.join(self.storage_dir, "dht_store.json")
            if os.path.exists(filepath):
                with open(filepath, "r", encoding="utf-8") as f:
                    data_list = json.load(f)
                for d in data_list:
                    data = DHTData.from_dict(d)
                    if not data.is_expired():
                        self.data[data.key] = data
        except Exception as e:
            logger.error(f"DHT存储加载失败: {e}")


# ============================================================
# DHT节点（核心）
# ============================================================

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
