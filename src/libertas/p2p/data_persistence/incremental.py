"""职责模块：incremental。"""

from __future__ import annotations

from typing import Optional, Dict, List, Tuple, Set, Callable, Any
from ..paths import DEFAULT_STATE_DIR
import asyncio
import hashlib
import json
import os
import time

from .constants import SYNC_BATCH_SIZE
from .models import SyncSession
from .models import VersionVector
from .constants import logger

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
