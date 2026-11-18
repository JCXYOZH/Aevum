"""
Libertas - 资产分析增强
========================
资产聚类、风险趋势、漏洞关联、资产画像。

版本：1.0.0
"""

import asyncio
import time
import hashlib
import json
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple, Set
from collections import defaultdict
import logging

logger = logging.getLogger(__name__)


@dataclass
class AssetProfile:
    """资产画像"""
    asset_ip: str
    asset_type: str = ""  # server/iot/network/unknown
    os_family: str = ""
    open_ports: List[int] = field(default_factory=list)
    services: Dict[str, str] = field(default_factory=dict)
    vulnerabilities: List[str] = field(default_factory=list)
    risk_score: float = 0.0
    risk_trend: str = "stable"  # rising/falling/stable
    first_seen: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    scan_count: int = 0
    tags: List[str] = field(default_factory=list)
    cve_count: int = 0
    critical_cve_count: int = 0

    def to_dict(self) -> Dict:
        return {
            "asset_ip": self.asset_ip,
            "asset_type": self.asset_type,
            "os_family": self.os_family,
            "open_ports": self.open_ports,
            "services": self.services,
            "vulnerabilities": self.vulnerabilities,
            "risk_score": self.risk_score,
            "risk_trend": self.risk_trend,
            "first_seen": self.first_seen,
            "last_seen": self.last_seen,
            "scan_count": self.scan_count,
            "tags": self.tags,
            "cve_count": self.cve_count,
            "critical_cve_count": self.critical_cve_count,
        }


class AssetAnalytics:
    """
    资产分析引擎
    资产聚类、风险趋势、漏洞关联、资产画像
    """

    def __init__(self):
        self.profiles: Dict[str, AssetProfile] = {}
        self.risk_history: Dict[str, List[Tuple[float, float]]] = defaultdict(list)
        self.cve_database: Dict[str, Dict] = {}
        self._clusters: Dict[str, List[str]] = {}

    def update_asset(self, asset_ip: str, open_ports: List[int],
                     fingerprints: List[Dict], cves: List[Dict],
                     risk_score: float):
        """更新资产信息"""
        if asset_ip not in self.profiles:
            self.profiles[asset_ip] = AssetProfile(asset_ip=asset_ip)

        profile = self.profiles[asset_ip]
        profile.open_ports = list(set(profile.open_ports + open_ports))
        profile.risk_score = risk_score
        profile.last_seen = time.time()
        profile.scan_count += 1

        # 提取服务信息
        for fp in fingerprints:
            service = fp.get("service", "")
            version = fp.get("version", "")
            if service:
                profile.services[service] = version

        # 提取CVE信息
        for cve in cves:
            cve_id = cve.get("cve_id", "")
            if cve_id and cve_id not in profile.vulnerabilities:
                profile.vulnerabilities.append(cve_id)
                profile.cve_count += 1
                severity = cve.get("severity", "").lower()
                if severity in ("critical", "high"):
                    profile.critical_cve_count += 1

        # 记录风险历史
        self.risk_history[asset_ip].append((time.time(), risk_score))
        if len(self.risk_history[asset_ip]) > 100:
            self.risk_history[asset_ip] = self.risk_history[asset_ip][-100:]

        # 计算风险趋势
        profile.risk_trend = self._calculate_trend(asset_ip)

        # 资产类型推断
        profile.asset_type = self._infer_asset_type(profile)
        profile.os_family = self._infer_os(profile)

        # 自动打标签
        profile.tags = self._auto_tag(profile)

    def _calculate_trend(self, asset_ip: str) -> str:
        """计算风险趋势"""
        history = self.risk_history.get(asset_ip, [])
        if len(history) < 5:
            return "stable"

        recent = [r[1] for r in history[-5:]]
        older = [r[1] for r in history[-10:-5]] if len(history) >= 10 else recent[:2]

        avg_recent = sum(recent) / len(recent)
        avg_older = sum(older) / len(older) if older else avg_recent

        if avg_recent - avg_older > 5:
            return "rising"
        elif avg_older - avg_recent > 5:
            return "falling"
        return "stable"

    def _infer_asset_type(self, profile: AssetProfile) -> str:
        """推断资产类型"""
        ports = set(profile.open_ports)
        services = set(profile.services.keys())

        # IoT设备特征
        iot_ports = {554, 8080, 8443, 5000, 8000}
        if ports & iot_ports and len(ports) <= 5:
            return "iot"

        # 网络设备特征
        network_ports = {22, 23, 80, 443, 161, 179}
        if ports & {161, 179, 23} and "ssh" not in services:
            return "network"

        # 服务器特征
        server_ports = {22, 80, 443, 3306, 5432, 6379, 27017, 8080}
        if ports & server_ports and len(ports) >= 3:
            return "server"

        return "unknown"

    def _infer_os(self, profile: AssetProfile) -> str:
        """推断操作系统"""
        services = profile.services
        for service, version in services.items():
            svc_lower = service.lower()
            if "iis" in svc_lower:
                return "windows"
            if "apache" in svc_lower or "nginx" in svc_lower:
                return "linux"
        if 3389 in profile.open_ports:
            return "windows"
        if 22 in profile.open_ports:
            return "linux"
        return "unknown"

    def _auto_tag(self, profile: AssetProfile) -> List[str]:
        """自动打标签"""
        tags = []
        if profile.risk_score >= 80:
            tags.append("high_risk")
        if profile.critical_cve_count > 0:
            tags.append("critical_vulnerable")
        if profile.asset_type == "iot":
            tags.append("iot_device")
        if 22 in profile.open_ports:
            tags.append("ssh_open")
        if 3389 in profile.open_ports:
            tags.append("rdp_open")
        if profile.scan_count > 10:
            tags.append("frequently_scanned")
        return tags

    def cluster_assets(self) -> Dict[str, List[str]]:
        """
        资产聚类
        按网段、服务、风险等级聚类
        """
        clusters = defaultdict(list)

        for ip, profile in self.profiles.items():
            # 按/24网段聚类
            prefix = ".".join(ip.split(".")[:3])
            clusters[f"subnet_{prefix}"].append(ip)

            # 按资产类型聚类
            clusters[f"type_{profile.asset_type}"].append(ip)

            # 按风险等级聚类
            if profile.risk_score >= 80:
                clusters["risk_critical"].append(ip)
            elif profile.risk_score >= 60:
                clusters["risk_high"].append(ip)
            elif profile.risk_score >= 40:
                clusters["risk_medium"].append(ip)
            else:
                clusters["risk_low"].append(ip)

        self._clusters = dict(clusters)
        return self._clusters

    def get_correlated_vulnerabilities(self) -> Dict[str, List[str]]:
        """
        漏洞关联分析
        找出同时出现在多个资产上的漏洞组合
        """
        cve_to_assets: Dict[str, Set[str]] = defaultdict(set)
        for ip, profile in self.profiles.items():
            for cve in profile.vulnerabilities:
                cve_to_assets[cve].add(ip)

        # 找出影响多个资产的漏洞
        widespread = {cve: list(assets) for cve, assets in cve_to_assets.items()
                      if len(assets) >= 2}

        return dict(sorted(widespread.items(), key=lambda x: len(x[1]), reverse=True))

    def get_top_risky_assets(self, count: int = 10) -> List[AssetProfile]:
        """获取风险最高的资产"""
        sorted_assets = sorted(
            self.profiles.values(), key=lambda x: x.risk_score, reverse=True
        )
        return sorted_assets[:count]

    def get_asset_profile(self, asset_ip: str) -> Optional[AssetProfile]:
        return self.profiles.get(asset_ip)

    def get_stats(self) -> Dict:
        total = len(self.profiles)
        avg_risk = sum(p.risk_score for p in self.profiles.values()) / total if total > 0 else 0
        by_type = defaultdict(int)
        for p in self.profiles.values():
            by_type[p.asset_type] += 1

        return {
            "total_assets": total,
            "average_risk": round(avg_risk, 2),
            "by_type": dict(by_type),
            "high_risk_count": sum(1 for p in self.profiles.values() if p.risk_score >= 80),
            "critical_vuln_count": sum(p.critical_cve_count for p in self.profiles.values()),
            "clusters": len(self._clusters),
        }
