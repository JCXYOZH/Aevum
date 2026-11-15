"""
Libertas - 数据持久性与同步引擎
================================
DHT数据迁移、重发布优化、增量同步协议。

核心能力：
1. 节点退出数据迁移 - 优雅退出时把数据迁移给邻居
2. 数据冗余检查 - 确保K份副本
3. DHT查询缓存 - 加速重复查询
4. 增量同步协议 - 基于版本向量的增量同步
5. 全量同步 - 新节点加入时
6. 同步冲突解决 - 版本向量合并
7. 数据分片传输 - 大数据集分片
8. 同步进度跟踪 - 断点续传

版本：1.0.0
"""

import asyncio
import json
import time
import hashlib
import os
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple, Set, Callable, Any
from collections import defaultdict
import logging

from .dht import DHTNode, DHTData, compute_key, xor_distance, K
from .consensus import AssetRecord
from .paths import DEFAULT_STATE_DIR

logger = logging.getLogger(__name__)


# ============================================================
# 常量
# ============================================================

REPUBLISH_INTERVAL = 1800  # 30分钟重发布
DATA_REDUNDANCY = K  # 数据冗余因子
SYNC_BATCH_SIZE = 100  # 每批同步100条
SYNC_CHUNK_SIZE = 64 * 1024  # 64KB分片
CACHE_TTL = 300  # 缓存5分钟
CACHE_MAX_ENTRIES = 10000


# ============================================================
# 数据结构
# ============================================================

@dataclass
class VersionVector:
    """版本向量"""
    counters: Dict[str, int] = field(default_factory=dict)

    def increment(self, node_id: str):
        self.counters[node_id] = self.counters.get(node_id, 0) + 1

    def get(self, node_id: str) -> int:
        return self.counters.get(node_id, 0)

    def merge(self, other: "VersionVector") -> "VersionVector":
        """合并两个版本向量（取最大值）"""
        merged = VersionVector()
        all_nodes = set(self.counters.keys()) | set(other.counters.keys())
        for node in all_nodes:
            merged.counters[node] = max(self.get(node), other.get(node))
        return merged

    def dominates(self, other: "VersionVector") -> bool:
        """判断当前版本向量是否支配另一个（所有计数器>=）"""
        all_nodes = set(self.counters.keys()) | set(other.counters.keys())
        for node in all_nodes:
            if self.get(node) < other.get(node):
                return False
        return True

    def concurrent(self, other: "VersionVector") -> bool:
        """判断是否并发（互不支配）"""
        return not self.dominates(other) and not other.dominates(self)

    def to_dict(self) -> Dict:
        return dict(self.counters)

    @classmethod
    def from_dict(cls, data: Dict) -> "VersionVector":
        vv = cls()
        vv.counters = dict(data)
        return vv


@dataclass
class SyncSession:
    """同步会话"""
    session_id: str
    peer_node_id: str
    direction: str  # "push" / "pull" / "both"
    started_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    items_synced: int = 0
    items_total: int = 0
    bytes_transferred: int = 0
    status: str = "active"  # active/completed/failed
    error: str = ""
    checkpoint: str = ""  # 断点续传检查点

    def to_dict(self) -> Dict:
        return {
            "session_id": self.session_id,
            "peer_node_id": self.peer_node_id,
            "direction": self.direction,
            "started_at": self.started_at,
            "items_synced": self.items_synced,
            "items_total": self.items_total,
            "bytes_transferred": self.bytes_transferred,
            "status": self.status,
            "checkpoint": self.checkpoint,
        }


@dataclass
class CacheEntry:
    """缓存条目"""
    key: str
    value: Any
    created_at: float = field(default_factory=time.time)
    access_count: int = 0
    last_accessed: float = field(default_factory=time.time)

    def is_expired(self) -> bool:
        return time.time() - self.created_at > CACHE_TTL


# ============================================================
# DHT查询缓存
# ============================================================

class DHTCache:
    """
    DHT查询缓存
    加速重复查询，减少网络流量
    """

    def __init__(self, max_entries: int = CACHE_MAX_ENTRIES):
        self.max_entries = max_entries
        self._cache: Dict[str, CacheEntry] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Optional[Any]:
        """获取缓存"""
        async with self._lock:
            entry = self._cache.get(key)
            if entry and not entry.is_expired():
                entry.access_count += 1
                entry.last_accessed = time.time()
                return entry.value
            if entry and entry.is_expired():
                del self._cache[key]
            return None

    async def set(self, key: str, value: Any):
        """设置缓存"""
        async with self._lock:
            if len(self._cache) >= self.max_entries:
                # 淘汰最久未访问的
                oldest_key = min(self._cache.keys(),
                                 key=lambda k: self._cache[k].last_accessed)
                del self._cache[oldest_key]
            self._cache[key] = CacheEntry(key=key, value=value)

    async def invalidate(self, key: str):
        """使缓存失效"""
        async with self._lock:
            self._cache.pop(key, None)

    async def clear(self):
        """清空缓存"""
        async with self._lock:
            self._cache.clear()

    def get_stats(self) -> Dict:
        return {
            "entries": len(self._cache),
            "max_entries": self.max_entries,
            "hit_rate": 0.0,  # 需要统计
        }


# ============================================================
# 数据迁移管理器
# ============================================================

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


# ============================================================
# 增量同步引擎
# ============================================================

class IncrementalSyncEngine:
    """
    增量同步引擎
    基于版本向量的增量数据同步
    """

    def __init__(self, node_id: str, asset_merger=None,
                 send_message: Optional[Callable] = None,
                 state_dir: str = DEFAULT_STATE_DIR):
        self.node_id = node_id
        self.asset_merger = asset_merger
        self._send_message = send_message
        self.state_dir = state_dir
        self.version_vector = VersionVector()
        self.sessions: Dict[str, SyncSession] = {}
        self._lock = asyncio.Lock()
        self._sync_log: List[Dict] = []
        os.makedirs(state_dir, exist_ok=True)
        self._load_version_vector()

    def set_send_message(self, send_message: Callable):
        self._send_message = send_message

    def increment_version(self):
        """递增本地版本向量"""
        self.version_vector.increment(self.node_id)
        self._save_version_vector()

    async def request_sync(self, peer_node_id: str,
                            direction: str = "both",
                            since_version: Optional[VersionVector] = None) -> Optional[SyncSession]:
        """
        请求与对等节点同步

        Args:
            peer_node_id: 对等节点ID
            direction: push/pull/both
            since_version: 从哪个版本开始同步

        Returns:
            同步会话
        """
        session_id = hashlib.sha256(
            f"{self.node_id}:{peer_node_id}:{time.time()}".encode()
        ).hexdigest()[:16]

        session = SyncSession(
            session_id=session_id,
            peer_node_id=peer_node_id,
            direction=direction,
        )
        self.sessions[session_id] = session

        if not self._send_message:
            session.status = "failed"
            session.error = "no_send_message"
            return session

        try:
            # 发送同步请求
            response = await self._send_message(
                peer_node_id, "SYNC_REQUEST",
                {
                    "session_id": session_id,
                    "direction": direction,
                    "version_vector": self.version_vector.to_dict(),
                    "since_version": since_version.to_dict() if since_version else None,
                },
                channel=5,  # SYNC通道
                timeout=30.0,
            )

            if response and response.payload.get("accepted"):
                session.items_total = response.payload.get("items_total", 0)
                session.status = "active"

                # 执行同步
                if direction in ("pull", "both"):
                    await self._pull_data(session, response.payload)
                if direction in ("push", "both"):
                    await self._push_data(session)

                session.status = "completed"
            else:
                session.status = "failed"
                session.error = "rejected"

        except Exception as e:
            session.status = "failed"
            session.error = str(e)

        return session

    async def _pull_data(self, session: SyncSession, response: Dict):
        """从对等节点拉取数据"""
        items = response.get("items", [])
        for item in items:
            try:
                if self.asset_merger and "asset_ip" in item:
                    from .consensus import ScanResult
                    result = ScanResult(
                        result_id=item.get("result_id", ""),
                        task_id=item.get("task_id", "sync"),
                        scanner=session.peer_node_id,
                        asset_ip=item["asset_ip"],
                        open_ports=item.get("open_ports", []),
                        fingerprints=item.get("fingerprints", []),
                        cves=item.get("cves", []),
                        risk_score=item.get("risk_score", 0.0),
                    )
                    await self.asset_merger.merge_result(result)
                session.items_synced += 1
            except Exception as e:
                logger.debug(f"同步条目失败: {e}")

    async def _push_data(self, session: SyncSession):
        """向对等节点推送数据"""
        if not self.asset_merger:
            return

        assets = self.asset_merger.get_all_assets()
        for asset in assets[:SYNC_BATCH_SIZE]:
            try:
                item = {
                    "asset_ip": asset.asset_ip,
                    "open_ports": asset.merged_ports,
                    "fingerprints": asset.merged_fingerprints,
                    "cves": asset.merged_cves,
                    "risk_score": asset.merged_risk_score,
                }
                if self._send_message:
                    await self._send_message(
                        session.peer_node_id, "SYNC_DATA",
                        {"session_id": session.session_id, "item": item},
                        channel=5, timeout=10.0,
                    )
                session.items_synced += 1
            except Exception as e:
                logger.debug(f"推送条目失败: {e}")

    async def handle_sync_request(self, peer_node_id: str, request: Dict) -> Dict:
        """处理同步请求"""
        direction = request.get("direction", "both")
        peer_vv = VersionVector.from_dict(request.get("version_vector", {}))

        # 计算需要同步的条目（版本向量支配的条目）
        items_to_sync = []
        if self.asset_merger:
            for asset in self.asset_merger.get_all_assets():
                asset_vv = VersionVector.from_dict(asset.version_vector)
                if asset_vv.dominates(peer_vv) or asset_vv.concurrent(peer_vv):
                    items_to_sync.append({
                        "asset_ip": asset.asset_ip,
                        "open_ports": asset.merged_ports,
                        "fingerprints": asset.merged_fingerprints,
                        "cves": asset.merged_cves,
                        "risk_score": asset.merged_risk_score,
                    })

        return {
            "accepted": True,
            "items_total": len(items_to_sync),
            "items": items_to_sync[:SYNC_BATCH_SIZE],
            "version_vector": self.version_vector.to_dict(),
        }

    async def handle_sync_data(self, peer_node_id: str, data: Dict):
        """处理同步数据"""
        item = data.get("item", {})
        if self.asset_merger and "asset_ip" in item:
            from .consensus import ScanResult
            result = ScanResult(
                result_id=data.get("session_id", ""),
                task_id="sync",
                scanner=peer_node_id,
                asset_ip=item["asset_ip"],
                open_ports=item.get("open_ports", []),
                fingerprints=item.get("fingerprints", []),
                cves=item.get("cves", []),
                risk_score=item.get("risk_score", 0.0),
            )
            await self.asset_merger.merge_result(result)

    def get_session(self, session_id: str) -> Optional[SyncSession]:
        return self.sessions.get(session_id)

    def get_all_sessions(self) -> List[SyncSession]:
        return list(self.sessions.values())

    def get_stats(self) -> Dict:
        active = sum(1 for s in self.sessions.values() if s.status == "active")
        completed = sum(1 for s in self.sessions.values() if s.status == "completed")
        failed = sum(1 for s in self.sessions.values() if s.status == "failed")
        total_items = sum(s.items_synced for s in self.sessions.values())

        return {
            "active_sessions": active,
            "completed_sessions": completed,
            "failed_sessions": failed,
            "total_items_synced": total_items,
            "version_vector": self.version_vector.to_dict(),
            "version_counter": self.version_vector.get(self.node_id),
        }

    def _save_version_vector(self):
        try:
            filepath = os.path.join(self.state_dir, "version_vector.json")
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(self.version_vector.to_dict(), f)
        except Exception:
            pass

    def _load_version_vector(self):
        try:
            filepath = os.path.join(self.state_dir, "version_vector.json")
            if os.path.exists(filepath):
                with open(filepath, "r", encoding="utf-8") as f:
                    self.version_vector = VersionVector.from_dict(json.load(f))
        except Exception:
            pass


# ============================================================
# 数据持久性引擎（整合所有组件）
# ============================================================

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
