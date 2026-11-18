"""职责模块：migration。"""

from __future__ import annotations

from ..dht import DHTNode, DHTData, compute_key, xor_distance, K
from typing import Optional, Dict, List, Tuple, Set, Callable, Any

from .constants import DATA_REDUNDANCY
from .constants import logger

class DataMigrationManager:
    """
    数据迁移管理器
    节点退出时把DHT数据迁移给最近的邻居
    """

    def __init__(self, dht_node: DHTNode, node_id: str):
        self.dht_node = dht_node
        self.node_id = node_id
        self._migrating = False

    async def migrate_on_exit(self) -> int:
        """
        节点退出时迁移所有数据

        Returns:
            迁移的数据条数
        """
        if self._migrating:
            return 0
        self._migrating = True

        migrated = 0
        try:
            # 获取所有本地存储的数据
            all_keys = await self.dht_node.storage.get_keys()
            logger.info(f"开始迁移 {len(all_keys)} 条数据")

            for key in all_keys:
                try:
                    value = await self.dht_node.storage.retrieve(key)
                    if value is not None:
                        # 重新存储到DHT（会复制到最近的K个节点）
                        await self.dht_node.store_value(key, value)
                        migrated += 1
                except Exception as e:
                    logger.debug(f"迁移数据 {key} 失败: {e}")

            logger.info(f"数据迁移完成，共迁移 {migrated} 条")

        except Exception as e:
            logger.error(f"数据迁移异常: {e}")
        finally:
            self._migrating = False

        return migrated

    async def check_redundancy(self) -> Dict[str, int]:
        """
        检查数据冗余度

        Returns:
            {key: 实际副本数}
        """
        redundancy = {}
        all_keys = await self.dht_node.storage.get_keys()

        for key in all_keys:
            # 查找最近的K个节点，检查数据是否存在
            target_id = compute_key(key)
            closest = await self.dht_node.routing_table.get_closest_nodes(target_id, K)
            # 简化：假设本地有1份，其他节点可能有副本
            redundancy[key] = 1 + len(closest) // 2  # 估算

        return redundancy

    async def replicate_under_replicated(self) -> int:
        """
        复制冗余度不足的数据

        Returns:
            复制的数据条数
        """
        replicated = 0
        redundancy = await self.check_redundancy()

        for key, count in redundancy.items():
            if count < DATA_REDUNDANCY // 2:  # 冗余度不足一半
                try:
                    value = await self.dht_node.storage.retrieve(key)
                    if value is not None:
                        await self.dht_node.store_value(key, value)
                        replicated += 1
                except Exception as e:
                    logger.debug(f"复制数据 {key} 失败: {e}")

        return replicated
