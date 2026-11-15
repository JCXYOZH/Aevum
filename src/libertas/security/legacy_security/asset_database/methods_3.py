"""
花先生 - 资产数据库与查询系统
==============================
网络空间测绘结果的持久化存储、查询、分析和导出。

核心能力：
1. SQLite结构化存储（资产表/端口表/指纹表/CVE表/扫描任务表/标签表）
2. 批量入库与UPSERT去重合并
3. 历史版本管理（每次扫描保存快照，支持时间线回溯）
4. 高级多条件查询（IP/端口/服务/指纹/CVE/风险等级/标签）
5. 全文搜索（FTS5虚拟表）
6. 资产标签与分组管理
7. 数据导出（JSON/CSV/Excel/XML）
8. 统计分析与仪表盘数据
9. 资产变化追踪与差异报告

作者：花先生
版本：2.0.0
"""

import sqlite3
import json
import os
import time
import csv
import ipaddress
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Tuple, Any, Union
from enum import Enum
from collections import defaultdict, Counter
import logging
import threading
import shutil
import traceback
from .models import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403
from .methods_1 import *  # noqa: F401,F403
from .methods_2 import *  # noqa: F401,F403

class AssetDatabasePart3(object):
    def _upsert_cve(self, cursor, asset_id: int, cve_data: Dict, now: float):
        """插入或更新CVE"""
        cve_id = cve_data.get("cve", cve_data.get("cve_id", ""))
        if not cve_id:
            return

        cursor.execute("""
            SELECT id FROM cves WHERE asset_id = ? AND cve_id = ?
        """, (asset_id, cve_id))
        existing = cursor.fetchone()

        if existing:
            cursor.execute("""
                UPDATE cves SET
                    severity = ?, cvss_score = ?, description = ?,
                    exploit_available = ?, patch_available = ?, last_seen = ?
                WHERE id = ?
            """, (
                cve_data.get("severity", "medium"),
                cve_data.get("cvss_score", cve_data.get("score", 0.0)),
                cve_data.get("description", ""),
                1 if cve_data.get("exploit_available", False) else 0,
                1 if cve_data.get("patch_available", True) else 0,
                now,
                existing["id"],
            ))
        else:
            cursor.execute("""
                INSERT INTO cves (
                    asset_id, cve_id, severity, cvss_score, description,
                    affected_product, affected_version, exploit_available,
                    patch_available, refs, first_seen, last_seen
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                asset_id, cve_id,
                cve_data.get("severity", "medium"),
                cve_data.get("cvss_score", cve_data.get("score", 0.0)),
                cve_data.get("description", ""),
                cve_data.get("affected_product", cve_data.get("product", "")),
                cve_data.get("affected_version", cve_data.get("version", "")),
                1 if cve_data.get("exploit_available", False) else 0,
                1 if cve_data.get("patch_available", True) else 0,
                json.dumps(cve_data.get("references", []), ensure_ascii=False),
                now, now,
            ))
    def batch_upsert(self, assets_data: List[Dict]) -> List[int]:
        """
        批量入库资产

        Args:
            assets_data: 资产数据列表

        Returns:
            资产ID列表
        """
        asset_ids = []
        for asset_data in assets_data:
            aid = self.upsert_asset(asset_data)
            if aid:
                asset_ids.append(aid)
        return asset_ids
    def get_asset(self, asset_id: int) -> Optional[Dict]:
        """获取单个资产详情（含端口、指纹、CVE）"""
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()

            cursor.execute("SELECT * FROM assets WHERE id = ?", (asset_id,))
            row = cursor.fetchone()
            if not row:
                return None

            asset = dict(row)
            asset["tags"] = json.loads(asset.get("tags", "[]"))
            asset["extra"] = json.loads(asset.get("extra", "{}"))

            # 端口
            cursor.execute("SELECT * FROM ports WHERE asset_id = ? ORDER BY port", (asset_id,))
            asset["ports"] = [dict(r) for r in cursor.fetchall()]

            # 指纹
            cursor.execute("SELECT * FROM fingerprints WHERE asset_id = ? ORDER BY confidence DESC", (asset_id,))
            asset["fingerprints"] = [dict(r) for r in cursor.fetchall()]

            # CVE
            cursor.execute("SELECT * FROM cves WHERE asset_id = ? ORDER BY cvss_score DESC", (asset_id,))
            asset["cves"] = [dict(r) for r in cursor.fetchall()]

            return asset
    def get_asset_by_ip(self, ip: str) -> Optional[Dict]:
        """通过IP获取资产"""
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM assets WHERE ip = ?", (ip,))
            row = cursor.fetchone()
            if row:
                return self.get_asset(row["id"])
            return None
    def query_assets(self, filters: Optional[Dict] = None,
                     page: int = 1, page_size: int = 50,
                     sort_by: str = "risk_score", sort_order: str = "desc") -> Dict:
        """
        高级多条件查询资产

        Args:
            filters: 过滤条件字典
                - ip: IP或IP段
                - port: 端口号
                - service: 服务名
                - fingerprint: 指纹名
                - cve: CVE编号
                - risk_level: 风险等级
                - status: 状态
                - os: 操作系统
                - tag: 标签
                - keyword: 关键词（全文搜索）
            page: 页码
            page_size: 每页数量
            sort_by: 排序字段
            sort_order: 排序方向

        Returns:
            {"total": 总数, "page": 当前页, "page_size": 每页数量, "assets": 资产列表}
        """
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()

            filters = filters or {}
            conditions = []
            params = []
            joins = []

            # IP过滤
            if "ip" in filters and filters["ip"]:
                ip_val = filters["ip"]
                if "/" in ip_val:
                    # CIDR段
                    try:
                        network = ipaddress.ip_network(ip_val, strict=False)
                        placeholders = ",".join(["?"] * len(list(network.hosts())))
                        if placeholders:
                            conditions.append(f"a.ip IN ({placeholders})")
                            params.extend([str(ip) for ip in network.hosts()])
                    except ValueError:
                        conditions.append("a.ip LIKE ?")
                        params.append(f"%{ip_val}%")
                else:
                    conditions.append("a.ip LIKE ?")
                    params.append(f"%{ip_val}%")

            # 端口过滤
            if "port" in filters and filters["port"]:
                joins.append("JOIN ports p ON p.asset_id = a.id")
                conditions.append("p.port = ?")
                params.append(filters["port"])

            # 服务过滤
            if "service" in filters and filters["service"]:
                joins.append("JOIN ports p2 ON p2.asset_id = a.id")
                conditions.append("p2.service LIKE ?")
                params.append(f"%{filters['service']}%")

            # 指纹过滤
            if "fingerprint" in filters and filters["fingerprint"]:
                joins.append("JOIN fingerprints f ON f.asset_id = a.id")
                conditions.append("f.name LIKE ?")
                params.append(f"%{filters['fingerprint']}%")

            # CVE过滤
            if "cve" in filters and filters["cve"]:
                joins.append("JOIN cves c ON c.asset_id = a.id")
                conditions.append("c.cve_id LIKE ?")
                params.append(f"%{filters['cve']}%")

            # 风险等级
            if "risk_level" in filters and filters["risk_level"]:
                conditions.append("a.risk_level = ?")
                params.append(filters["risk_level"])

            # 状态
            if "status" in filters and filters["status"]:
                conditions.append("a.status = ?")
                params.append(filters["status"])

            # 操作系统
            if "os" in filters and filters["os"]:
                conditions.append("a.os LIKE ?")
                params.append(f"%{filters['os']}%")

            # 标签
            if "tag" in filters and filters["tag"]:
                joins.append("JOIN asset_tags at ON at.asset_id = a.id")
                joins.append("JOIN tags t ON t.id = at.tag_id")
                conditions.append("t.name = ?")
                params.append(filters["tag"])

            # 关键词全文搜索
            if "keyword" in filters and filters["keyword"]:
                conditions.append("(a.ip LIKE ? OR a.hostname LIKE ? OR a.domain LIKE ? OR a.isp LIKE ? OR a.org LIKE ?)")
                kw = f"%{filters['keyword']}%"
                params.extend([kw, kw, kw, kw, kw])

            # 构建查询
            where_clause = " AND ".join(conditions) if conditions else "1=1"
            join_clause = " ".join(set(joins)) if joins else ""

            # 总数
            count_sql = f"SELECT COUNT(DISTINCT a.id) as total FROM assets a {join_clause} WHERE {where_clause}"
            cursor.execute(count_sql, params)
            total = cursor.fetchone()["total"]

            # 分页查询
            offset = (page - 1) * page_size
            order_dir = "DESC" if sort_order.lower() == "desc" else "ASC"
            allowed_sort = ["risk_score", "last_seen", "first_seen", "scan_count", "ip"]
            sort_field = sort_by if sort_by in allowed_sort else "risk_score"

            query_sql = f"""
                SELECT DISTINCT a.* FROM assets a {join_clause}
                WHERE {where_clause}
                ORDER BY a.{sort_field} {order_dir}
                LIMIT ? OFFSET ?
            """
            cursor.execute(query_sql, params + [page_size, offset])

            assets = []
            for row in cursor.fetchall():
                asset = dict(row)
                asset["tags"] = json.loads(asset.get("tags", "[]"))
                asset["extra"] = json.loads(asset.get("extra", "{}"))
                # 简化的端口数
                cursor.execute("SELECT COUNT(*) as cnt FROM ports WHERE asset_id = ? AND state = 'open'", (asset["id"],))
                asset["open_port_count"] = cursor.fetchone()["cnt"]
                cursor.execute("SELECT COUNT(*) as cnt FROM cves WHERE asset_id = ?", (asset["id"],))
                asset["cve_count"] = cursor.fetchone()["cnt"]
                assets.append(asset)

            return {
                "total": total,
                "page": page,
                "page_size": page_size,
                "total_pages": (total + page_size - 1) // page_size,
                "assets": assets,
            }
    def search_fulltext(self, keyword: str, limit: int = 50) -> List[Dict]:
        """全文搜索资产"""
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            try:
                cursor.execute("""
                    SELECT a.* FROM assets a
                    JOIN assets_fts fts ON fts.rowid = a.id
                    WHERE assets_fts MATCH ?
                    LIMIT ?
                """, (keyword, limit))
                return [dict(r) for r in cursor.fetchall()]
            except sqlite3.OperationalError:
                # FTS不可用时回退到LIKE
                cursor.execute("""
                    SELECT * FROM assets
                    WHERE ip LIKE ? OR hostname LIKE ? OR domain LIKE ?
                    LIMIT ?
                """, (f"%{keyword}%", f"%{keyword}%", f"%{keyword}%", limit))
                return [dict(r) for r in cursor.fetchall()]
    def get_statistics(self) -> Dict:
        """获取资产统计仪表盘数据"""
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()

            stats = {}

            # 总资产数
            cursor.execute("SELECT COUNT(*) as cnt FROM assets")
            stats["total_assets"] = cursor.fetchone()["cnt"]

            # 存活资产
            cursor.execute("SELECT COUNT(*) as cnt FROM assets WHERE status = 'up'")
            stats["alive_assets"] = cursor.fetchone()["cnt"]

            # 风险分布
            cursor.execute("""
                SELECT risk_level, COUNT(*) as cnt FROM assets
                GROUP BY risk_level ORDER BY cnt DESC
            """)
            stats["risk_distribution"] = {r["risk_level"]: r["cnt"] for r in cursor.fetchall()}

            # Top服务
            cursor.execute("""
                SELECT service, COUNT(*) as cnt FROM ports
                WHERE state = 'open' AND service != ''
                GROUP BY service ORDER BY cnt DESC LIMIT 20
            """)
            stats["top_services"] = [{"service": r["service"], "count": r["cnt"]} for r in cursor.fetchall()]

            # Top端口
            cursor.execute("""
                SELECT port, COUNT(*) as cnt FROM ports
                WHERE state = 'open'
                GROUP BY port ORDER BY cnt DESC LIMIT 20
            """)
            stats["top_ports"] = [{"port": r["port"], "count": r["cnt"]} for r in cursor.fetchall()]

            # Top指纹
            cursor.execute("""
                SELECT name, category, COUNT(*) as cnt FROM fingerprints
                GROUP BY name ORDER BY cnt DESC LIMIT 20
            """)
            stats["top_fingerprints"] = [
                {"name": r["name"], "category": r["category"], "count": r["cnt"]}
                for r in cursor.fetchall()
            ]

            # 漏洞统计
            cursor.execute("SELECT COUNT(*) as cnt FROM cves")
            stats["total_vulnerabilities"] = cursor.fetchone()["cnt"]

            cursor.execute("""
                SELECT severity, COUNT(*) as cnt FROM cves
                GROUP BY severity ORDER BY cnt DESC
            """)
            stats["vulnerability_severity"] = {r["severity"]: r["cnt"] for r in cursor.fetchall()}

            # 有漏洞的资产数
            cursor.execute("SELECT COUNT(DISTINCT asset_id) as cnt FROM cves")
            stats["vulnerable_assets"] = cursor.fetchone()["cnt"]

            # 操作系统分布
            cursor.execute("""
                SELECT os, COUNT(*) as cnt FROM assets
                WHERE os != '' GROUP BY os ORDER BY cnt DESC LIMIT 10
            """)
            stats["os_distribution"] = [{"os": r["os"], "count": r["cnt"]} for r in cursor.fetchall()]

            # 扫描次数
            cursor.execute("SELECT COUNT(*) as cnt FROM scans")
            stats["total_scans"] = cursor.fetchone()["cnt"]

            # 最近扫描时间
            cursor.execute("SELECT MAX(completed_at) as latest FROM scans")
            stats["last_scan_time"] = cursor.fetchone()["latest"]

            return stats
    def create_tag(self, name: str, color: str = "#3b82f6", description: str = "") -> int:
        """创建标签"""
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            now = time.time()
            try:
                cursor.execute("INSERT INTO tags (name, color, description, created_at) VALUES (?, ?, ?, ?)",
                               (name, color, description, now))
                conn.commit()
                return cursor.lastrowid
            except sqlite3.IntegrityError:
                cursor.execute("SELECT id FROM tags WHERE name = ?", (name,))
                return cursor.fetchone()["id"]
