"""职责模块：assets。"""

from __future__ import annotations

from typing import Optional, Dict, List, Tuple, Set, Callable, Any
import asyncio
import time

from .models import AssetRecord
from .constants import REPUTATION_AUTHORITY_MULTIPLIER
from .models import ScanResult
from .constants import logger

class AssetMerger:
    """
    资产多源合并器
    多个节点扫描同一资产时，信誉加权合并，冲突解决
    """

    def __init__(self, consensus: "ConsensusEngine"):
        self.consensus = consensus
        self.assets: Dict[str, AssetRecord] = {}
        self._merge_lock = asyncio.Lock()

    async def merge_result(self, result: ScanResult):
        """合并扫描结果到资产记录"""
        async with self._merge_lock:
            ip = result.asset_ip
            if ip not in self.assets:
                self.assets[ip] = AssetRecord(asset_ip=ip)

            asset = self.assets[ip]

            # 记录来源
            asset.sources[result.scanner] = result.to_dict()

            # 更新版本向量
            asset.version_vector[result.scanner] = \
                asset.version_vector.get(result.scanner, 0) + 1

            # 信誉加权合并端口
            await self._merge_ports(asset, result)

            # 合并指纹
            for fp in result.fingerprints:
                if fp not in asset.merged_fingerprints:
                    asset.merged_fingerprints.append(fp)

            # 合并CVE
            for cve in result.cves:
                if cve not in asset.merged_cves:
                    asset.merged_cves.append(cve)

            # 信誉加权风险评分
            await self._merge_risk_score(asset, result)

            # 计算共识程度
            asset.consensus_level = self._calculate_consensus(asset)

            asset.last_updated = time.time()

            # 通知上层入库
            if self.consensus.on_asset_merged:
                try:
                    await self.consensus.on_asset_merged(asset)
                except Exception as e:
                    logger.error(f"资产合并回调异常: {e}")

    async def _merge_ports(self, asset: AssetRecord, result: ScanResult):
        """信誉加权合并端口"""
        scanner_rep = self.consensus.get_reputation(result.scanner)
        if self.consensus.reputation_system.is_authority(result.scanner):
            scanner_rep *= REPUTATION_AUTHORITY_MULTIPLIER

        # 统计每个端口的投票
        port_votes: Dict[int, List[Tuple[str, float]]] = {}  # port -> [(state, reputation)]

        for source_id, source_data in asset.sources.items():
            source_rep = self.consensus.get_reputation(source_id)
            if self.consensus.reputation_system.is_authority(source_id):
                source_rep *= REPUTATION_AUTHORITY_MULTIPLIER

            for port_data in source_data.get("open_ports", []):
                port = port_data.get("port", 0)
                state = port_data.get("state", "open")
                if port not in port_votes:
                    port_votes[port] = []
                port_votes[port].append((state, source_rep))

        # 合并：加权投票，超过50%权重认为开放
        merged_ports = []
        for port, votes in port_votes.items():
            open_weight = sum(rep for state, rep in votes if state == "open")
            total_weight = sum(rep for _, rep in votes)

            if total_weight > 0 and open_weight / total_weight > 0.5:
                # 找到最新的端口数据
                latest_port_data = None
                latest_time = 0
                for source_id, source_data in asset.sources.items():
                    for port_data in source_data.get("open_ports", []):
                        if port_data.get("port") == port and source_data.get("timestamp", 0) > latest_time:
                            latest_port_data = port_data
                            latest_time = source_data.get("timestamp", 0)

                if latest_port_data:
                    merged_ports.append(latest_port_data)

        asset.merged_ports = merged_ports

    async def _merge_risk_score(self, asset: AssetRecord, result: ScanResult):
        """信誉加权合并风险评分"""
        total_weight = 0.0
        weighted_score = 0.0

        for source_id, source_data in asset.sources.items():
            source_rep = self.consensus.get_reputation(source_id)
            if self.consensus.reputation_system.is_authority(source_id):
                source_rep *= REPUTATION_AUTHORITY_MULTIPLIER

            score = source_data.get("risk_score", 0.0)
            weighted_score += score * source_rep
            total_weight += source_rep

        if total_weight > 0:
            asset.merged_risk_score = weighted_score / total_weight

    def _calculate_consensus(self, asset: AssetRecord) -> float:
        """计算共识程度（0-1）"""
        if len(asset.sources) < 2:
            return 1.0  # 只有一个来源，默认完全共识

        # 比较各来源的端口列表相似度
        source_ports = []
        for source_data in asset.sources.values():
            ports = set(p.get("port", 0) for p in source_data.get("open_ports", []))
            source_ports.append(ports)

        if not source_ports:
            return 0.0

        # 计算Jaccard相似度
        intersection = set.intersection(*source_ports) if source_ports else set()
        union = set.union(*source_ports) if source_ports else set()

        if not union:
            return 1.0

        return len(intersection) / len(union)

    def get_asset(self, ip: str) -> Optional[AssetRecord]:
        return self.assets.get(ip)

    def get_all_assets(self) -> List[AssetRecord]:
        return list(self.assets.values())

    def get_assets_by_risk(self, min_risk: float = 0.0) -> List[AssetRecord]:
        return [a for a in self.assets.values() if a.merged_risk_score >= min_risk]

    def get_stats(self) -> Dict:
        total = len(self.assets)
        high_risk = len([a for a in self.assets.values() if a.merged_risk_score >= 70])
        multi_source = len([a for a in self.assets.values() if len(a.sources) >= 2])
        avg_consensus = sum(a.consensus_level for a in self.assets.values()) / total if total > 0 else 0

        return {
            "total_assets": total,
            "high_risk_assets": high_risk,
            "multi_source_assets": multi_source,
            "average_consensus": round(avg_consensus, 4),
        }
