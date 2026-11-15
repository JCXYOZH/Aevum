"""
security/network_space_mapper.py - 网络空间测绘引擎

核心能力：
- NetworkSpaceMapper: 网络空间测绘主引擎
  - 端口扫描（TCP全连接/SYN/UDP）
  - 服务识别（Banner抓取/版本探测）
  - IP段批量扫描（CIDR/范围）
  - 域名解析与关联发现
  - 资产指纹识别（CMS/框架/中间件/设备）
  - CVE漏洞关联（CPE→CVE映射）
  - 地理信息映射
  - 测绘结果导出
- AssetFingerprint: 资产指纹识别器（200+指纹规则）
- TopologyGenerator: 拓扑图生成器（资产关系图/域名关联/IP段拓扑）
- AssetMonitor: 资产变化监控器（新增/变更/消失资产检测）
"""
import os
import re
import sys
import json
import time
import uuid
import socket
import struct
import hashlib
import ipaddress
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple, Set
from dataclasses import dataclass, field
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from enum import Enum
from .models import *  # noqa: F401,F403
from .asset_fingerprint import *  # noqa: F401,F403
from .network_space_mapper import *  # noqa: F401,F403

class TopologyGenerator:
    """拓扑图生成器

    生成资产关系图、域名关联图、IP段拓扑图。
    """

    def __init__(self):
        self.nodes: List[Dict] = []
        self.edges: List[Dict] = []

    def build_from_assets(self, assets: List[Asset]) -> Dict:
        """从资产列表构建拓扑图"""
        self.nodes = []
        self.edges = []
        node_ids = set()

        for asset in assets:
            # IP节点
            ip_node = {
                "id": asset.ip,
                "label": asset.ip,
                "type": "ip",
                "risk_score": asset.risk_score,
                "status": asset.status,
            }
            if asset.ip not in node_ids:
                self.nodes.append(ip_node)
                node_ids.add(asset.ip)

            # 域名节点
            if asset.domain and asset.domain not in node_ids:
                self.nodes.append({
                    "id": asset.domain,
                    "label": asset.domain,
                    "type": "domain",
                })
                node_ids.add(asset.domain)
                self.edges.append({
                    "source": asset.domain,
                    "target": asset.ip,
                    "type": "resolves_to",
                })

            # 主机名节点
            if asset.hostname and asset.hostname not in node_ids:
                self.nodes.append({
                    "id": asset.hostname,
                    "label": asset.hostname[:50],
                    "type": "hostname",
                })
                node_ids.add(asset.hostname)
                self.edges.append({
                    "source": asset.ip,
                    "target": asset.hostname,
                    "type": "hosts",
                })

            # 端口/服务节点
            for port in asset.ports:
                service_id = f"{asset.ip}:{port.port}"
                if service_id not in node_ids:
                    self.nodes.append({
                        "id": service_id,
                        "label": f"{port.port}/{port.service}",
                        "type": "service",
                        "port": port.port,
                        "service": port.service,
                        "version": port.version,
                    })
                    node_ids.add(service_id)
                    self.edges.append({
                        "source": asset.ip,
                        "target": service_id,
                        "type": "has_port",
                    })

            # 指纹节点
            for fp in asset.fingerprints:
                fp_id = f"{asset.ip}:{fp['name']}"
                if fp_id not in node_ids:
                    self.nodes.append({
                        "id": fp_id,
                        "label": fp["name"],
                        "type": "fingerprint",
                        "category": fp["category"],
                        "confidence": fp["confidence"],
                    })
                    node_ids.add(fp_id)
                    self.edges.append({
                        "source": asset.ip,
                        "target": fp_id,
                        "type": "runs",
                    })

            # CVE节点
            for cve in asset.cves:
                cve_id = cve["cve"]
                if cve_id not in node_ids:
                    self.nodes.append({
                        "id": cve_id,
                        "label": cve_id,
                        "type": "cve",
                        "severity": cve.get("severity", "unknown"),
                        "description": cve.get("description", ""),
                    })
                    node_ids.add(cve_id)
                self.edges.append({
                    "source": asset.ip,
                    "target": cve_id,
                    "type": "vulnerable_to",
                })

        return {
            "nodes": self.nodes,
            "edges": self.edges,
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
        }

    def generate_mermaid(self, topology: Dict = None) -> str:
        """生成Mermaid拓扑图"""
        topology = topology or {"nodes": self.nodes, "edges": self.edges}
        lines = ["graph TD"]

        # 节点定义
        for node in topology["nodes"]:
            nid = node["id"].replace(":", "_").replace(".", "_").replace("-", "_")
            label = node.get("label", node["id"])[:30]
            ntype = node.get("type", "default")

            if ntype == "ip":
                lines.append(f'    {nid}["{label}"]')
            elif ntype == "domain":
                lines.append(f'    {nid}(["{label}"])')
            elif ntype == "service":
                lines.append(f'    {nid}{{"{label}"}}')
            elif ntype == "cve":
                severity = node.get("severity", "")
                lines.append(f'    {nid}[/"{label} ({severity})"/]')
            else:
                lines.append(f'    {nid}["{label}"]')

        # 边定义
        for edge in topology["edges"]:
            src = edge["source"].replace(":", "_").replace(".", "_").replace("-", "_")
            tgt = edge["target"].replace(":", "_").replace(".", "_").replace("-", "_")
            etype = edge.get("type", "")
            lines.append(f'    {src} -->|{etype}| {tgt}')

        return "\n".join(lines)

    def generate_json(self, topology: Dict = None) -> str:
        """生成JSON格式拓扑图（兼容ECharts/D3.js）"""
        topology = topology or {"nodes": self.nodes, "edges": self.edges}
        return json.dumps({
            "nodes": [{"id": n["id"], "name": n.get("label", n["id"]),
                       "category": n.get("type", "default"),
                       "value": n.get("risk_score", n.get("confidence", 10))}
                      for n in topology["nodes"]],
            "links": [{"source": e["source"], "target": e["target"],
                       "relation": e.get("type", "")}
                      for e in topology["edges"]],
            "categories": [{"name": t} for t in set(n.get("type", "default") for n in topology["nodes"])],
        }, ensure_ascii=False, indent=2)

class AssetMonitor:
    """资产变化监控器

    检测新增/变更/消失资产，生成差异报告。
    """

    def __init__(self):
        self.snapshots: Dict[str, Dict] = {}  # snapshot_id -> snapshot data
        self.baseline: Dict[str, Asset] = {}

    def take_snapshot(self, assets: List[Asset], name: str = "") -> str:
        """拍摄资产快照"""
        snapshot_id = f"snap_{uuid.uuid4().hex[:8]}"
        snapshot = {
            "snapshot_id": snapshot_id,
            "name": name or f"Snapshot {time.strftime('%Y-%m-%d %H:%M:%S')}",
            "timestamp": time.time(),
            "assets": {a.ip: a.to_dict() for a in assets},
            "asset_count": len(assets),
        }
        self.snapshots[snapshot_id] = snapshot
        return snapshot_id

    def set_baseline(self, assets: List[Asset]):
        """设置基线"""
        self.baseline = {a.ip: a for a in assets}

    def compare(self, current_assets: List[Asset],
                baseline_assets: List[Asset] = None) -> Dict:
        """对比资产变化

        Returns:
            {new: [...], changed: [...], removed: [...], unchanged: count}
        """
        baseline = {a.ip: a for a in (baseline_assets or self.baseline.values())}
        current = {a.ip: a for a in current_assets}

        new_assets = []
        changed_assets = []
        removed_assets = []
        unchanged_count = 0

        # 新增资产
        for ip, asset in current.items():
            if ip not in baseline:
                asset.status = "new"
                new_assets.append(asset.to_dict())
            else:
                # 检查变化
                old = baseline[ip]
                changes = self._detect_changes(old, asset)
                if changes:
                    asset.status = "changed"
                    changed_assets.append({
                        "ip": ip,
                        "changes": changes,
                        "old": old.to_dict(),
                        "new": asset.to_dict(),
                    })
                else:
                    unchanged_count += 1

        # 消失资产
        for ip, asset in baseline.items():
            if ip not in current:
                asset.status = "removed"
                removed_assets.append(asset.to_dict())

        return {
            "new": new_assets,
            "changed": changed_assets,
            "removed": removed_assets,
            "unchanged": unchanged_count,
            "total_current": len(current),
            "total_baseline": len(baseline),
            "summary": {
                "new_count": len(new_assets),
                "changed_count": len(changed_assets),
                "removed_count": len(removed_assets),
                "unchanged_count": unchanged_count,
            },
        }

    def _detect_changes(self, old: Asset, new: Asset) -> List[Dict]:
        """检测两个资产之间的变化"""
        changes = []

        # 端口变化
        old_ports = {p.port: p for p in old.ports}
        new_ports = {p.port: p for p in new.ports}

        for port in new_ports:
            if port not in old_ports:
                changes.append({"type": "port_opened", "port": port, "service": new_ports[port].service})

        for port in old_ports:
            if port not in new_ports:
                changes.append({"type": "port_closed", "port": port, "service": old_ports[port].service})

        # 服务版本变化
        for port in new_ports:
            if port in old_ports:
                if new_ports[port].version != old_ports[port].version:
                    changes.append({
                        "type": "service_version_changed",
                        "port": port,
                        "old_version": old_ports[port].version,
                        "new_version": new_ports[port].version,
                    })

        # 指纹变化
        old_fps = {f["name"] for f in old.fingerprints}
        new_fps = {f["name"] for f in new.fingerprints}
        for fp in new_fps - old_fps:
            changes.append({"type": "fingerprint_added", "name": fp})
        for fp in old_fps - new_fps:
            changes.append({"type": "fingerprint_removed", "name": fp})

        # CVE变化
        old_cves = {c["cve"] for c in old.cves}
        new_cves = {c["cve"] for c in new.cves}
        for cve in new_cves - old_cves:
            changes.append({"type": "cve_added", "cve": cve})

        # 风险评分变化
        if abs(new.risk_score - old.risk_score) > 5:
            changes.append({
                "type": "risk_score_changed",
                "old_score": old.risk_score,
                "new_score": new.risk_score,
            })

        return changes

    def generate_diff_report(self, diff: Dict) -> str:
        """生成差异报告"""
        lines = ["# 资产变化监控报告", ""]
        summary = diff["summary"]
        lines.append(f"**新增资产**: {summary['new_count']}")
        lines.append(f"**变更资产**: {summary['changed_count']}")
        lines.append(f"**消失资产**: {summary['removed_count']}")
        lines.append(f"**未变化**: {summary['unchanged_count']}")
        lines.append("")

        if diff["new"]:
            lines.append("## 新增资产")
            lines.append("")
            for asset in diff["new"]:
                lines.append(f"- **{asset['ip']}**: {asset.get('hostname', '')} "
                             f"开放{len(asset.get('open_ports', []))}个端口, "
                             f"风险评分{asset['risk_score']}")
            lines.append("")

        if diff["changed"]:
            lines.append("## 变更资产")
            lines.append("")
            for change in diff["changed"]:
                lines.append(f"### {change['ip']}")
                for c in change["changes"]:
                    lines.append(f"- {c['type']}: {json.dumps(c, ensure_ascii=False)[:100]}")
                lines.append("")

        if diff["removed"]:
            lines.append("## 消失资产")
            lines.append("")
            for asset in diff["removed"]:
                lines.append(f"- **{asset['ip']}**: {asset.get('hostname', '')}")
            lines.append("")

        return "\n".join(lines)
