"""职责模块：engine。"""

from __future__ import annotations

from typing import Optional, Dict, List, Tuple, Set, Callable, Any
from ..paths import DEFAULT_STATE_DIR
from ..dht import DHTNode, DHTData, compute_key, xor_distance, K
import asyncio
import time

from .cache import DHTCache
from .migration import DataMigrationManager
from .incremental import IncrementalSyncEngine
from .constants import REPUBLISH_INTERVAL
from .models import SyncSession
from .constants import logger

class DataPersistenceEngine:
    """
    数据持久性引擎
    整合数据迁移、DHT优化、增量同步
    """

    def __init__(self, node_id: str, dht_node: DHTNode,
                 asset_merger=None, state_dir: str = DEFAULT_STATE_DIR):
        self.node_id = node_id
        self.dht_node = dht_node
        self.asset_merger = asset_merger
        self.state_dir = state_dir

        self.cache = DHTCache()
        self.migration = DataMigrationManager(dht_node, node_id)
        self.sync_engine = IncrementalSyncEngine(
            node_id, asset_merger, state_dir=state_dir
        )

        self._republish_task: Optional[asyncio.Task] = None
        self._running = False

    def set_send_message(self, send_message: Callable):
        self.sync_engine.set_send_message(send_message)

    async def start(self):
        """启动后台维护任务"""
        self._running = True
        self._republish_task = asyncio.create_task(self._maintenance_loop())

    async def stop(self):
        """停止后台维护"""
        self._running = False
        if self._republish_task:
            self._republish_task.cancel()

    async def graceful_exit(self) -> int:
        """优雅退出：迁移数据"""
        await self.stop()
        return await self.migration.migrate_on_exit()

    async def cached_dht_get(self, key: str) -> Optional[Any]:
        """带缓存的DHT查询"""
        cached = await self.cache.get(key)
        if cached is not None:
            return cached

        value = await self.dht_node.find_value(key)
        if value is not None:
            await self.cache.set(key, value)
        return value

    async def cached_dht_store(self, key: str, value: Any) -> int:
        """带缓存的DHT存储"""
        await self.cache.set(key, value)
        self.sync_engine.increment_version()
        return await self.dht_node.store_value(key, value)

    async def sync_with_peer(self, peer_node_id: str,
                              direction: str = "both") -> Optional[SyncSession]:
        """与对等节点同步"""
        return await self.sync_engine.request_sync(peer_node_id, direction)

    async def _maintenance_loop(self):
        """后台维护循环"""
        while self._running:
            try:
                # 重发布数据
                to_republish = await self.dht_node.storage.get_data_for_republish()
                for data in to_republish:
                    await self.dht_node.store_value(data.key, data.value, data.ttl)

                # 检查冗余度
                await self.migration.replicate_under_replicated()

                # 清理过期数据
                await self.dht_node.storage.cleanup_expired()

                # 刷新路由表
                await self._refresh_routing_table()

                await asyncio.sleep(REPUBLISH_INTERVAL)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"数据维护异常: {e}")
                await asyncio.sleep(REPUBLISH_INTERVAL)

    async def _refresh_routing_table(self):
        """刷新路由表（检查K桶节点存活）"""
        all_nodes = await self.dht_node.routing_table.get_all_nodes()
        now = time.time()
        for node in all_nodes:
            if now - node.last_seen > 3600:  # 1小时未更新
                await self.dht_node.routing_table.remove_node(node.node_id)

    async def get_stats(self) -> Dict:
        """获取统计"""
        return {
            "cache": self.cache.get_stats(),
            "sync": self.sync_engine.get_stats(),
            "migration": {
                "is_migrating": self.migration._migrating,
            },
            "dht": await self.dht_node.get_stats(),
        }
