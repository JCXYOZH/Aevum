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

class AssetDatabasePart2(object):
    def _init_database(self):
        """初始化数据库表结构"""
        conn = self._get_conn()
        cursor = conn.cursor()

        # 资产表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip TEXT NOT NULL,
                hostname TEXT DEFAULT '',
                domain TEXT DEFAULT '',
                os TEXT DEFAULT '',
                os_version TEXT DEFAULT '',
                status TEXT DEFAULT 'unknown',
                risk_score REAL DEFAULT 0.0,
                risk_level TEXT DEFAULT 'info',
                latitude REAL DEFAULT 0.0,
                longitude REAL DEFAULT 0.0,
                country TEXT DEFAULT '',
                region TEXT DEFAULT '',
                city TEXT DEFAULT '',
                isp TEXT DEFAULT '',
                asn TEXT DEFAULT '',
                org TEXT DEFAULT '',
                first_seen REAL DEFAULT 0,
                last_seen REAL DEFAULT 0,
                scan_count INTEGER DEFAULT 0,
                tags TEXT DEFAULT '[]',
                extra TEXT DEFAULT '{}',
                UNIQUE(ip)
            )
        """)

        # 端口表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS ports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_id INTEGER NOT NULL,
                port INTEGER NOT NULL,
                protocol TEXT DEFAULT 'tcp',
                state TEXT DEFAULT 'closed',
                service TEXT DEFAULT '',
                version TEXT DEFAULT '',
                banner TEXT DEFAULT '',
                product TEXT DEFAULT '',
                cpe TEXT DEFAULT '',
                first_seen REAL DEFAULT 0,
                last_seen REAL DEFAULT 0,
                extra TEXT DEFAULT '{}',
                FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
                UNIQUE(asset_id, port, protocol)
            )
        """)

        # 指纹表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS fingerprints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_id INTEGER NOT NULL,
                port INTEGER DEFAULT 0,
                name TEXT NOT NULL,
                category TEXT DEFAULT '',
                confidence REAL DEFAULT 0.0,
                version TEXT DEFAULT '',
                icon TEXT DEFAULT '',
                website TEXT DEFAULT '',
                first_seen REAL DEFAULT 0,
                last_seen REAL DEFAULT 0,
                FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
            )
        """)

        # CVE表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS cves (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_id INTEGER NOT NULL,
                cve_id TEXT NOT NULL,
                severity TEXT DEFAULT 'medium',
                cvss_score REAL DEFAULT 0.0,
                description TEXT DEFAULT '',
                affected_product TEXT DEFAULT '',
                affected_version TEXT DEFAULT '',
                exploit_available INTEGER DEFAULT 0,
                patch_available INTEGER DEFAULT 1,
                refs TEXT DEFAULT '[]',
                first_seen REAL DEFAULT 0,
                last_seen REAL DEFAULT 0,
                FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
                UNIQUE(asset_id, cve_id)
            )
        """)

        # 扫描记录表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS scans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scan_id TEXT UNIQUE,
                name TEXT DEFAULT '',
                target TEXT DEFAULT '',
                scan_type TEXT DEFAULT 'quick',
                status TEXT DEFAULT 'completed',
                started_at REAL DEFAULT 0,
                completed_at REAL DEFAULT 0,
                total_targets INTEGER DEFAULT 0,
                alive_hosts INTEGER DEFAULT 0,
                open_ports INTEGER DEFAULT 0,
                vulnerabilities INTEGER DEFAULT 0,
                options TEXT DEFAULT '{}'
            )
        """)

        # 资产快照表（历史版本）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS asset_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scan_id TEXT NOT NULL,
                asset_ip TEXT NOT NULL,
                snapshot_data TEXT NOT NULL,
                created_at REAL DEFAULT 0,
                FOREIGN KEY (scan_id) REFERENCES scans(scan_id) ON DELETE CASCADE
            )
        """)

        # 标签表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                color TEXT DEFAULT '#3b82f6',
                description TEXT DEFAULT '',
                created_at REAL DEFAULT 0
            )
        """)

        # 资产-标签关联表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS asset_tags (
                asset_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (asset_id, tag_id),
                FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            )
        """)

        # 索引
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_assets_ip ON assets(ip)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_assets_risk ON assets(risk_score)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_ports_asset ON ports(asset_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_ports_port ON ports(port)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_ports_service ON ports(service)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_fingerprints_asset ON fingerprints(asset_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_fingerprints_name ON fingerprints(name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_cves_asset ON cves(asset_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_cves_severity ON cves(severity)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_scans_scan_id ON scans(scan_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_scan ON asset_snapshots(scan_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_ip ON asset_snapshots(asset_ip)")

        # FTS5全文搜索虚拟表
        try:
            cursor.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
                    ip, hostname, domain, os, isp, org,
                    content='assets', content_rowid='id'
                )
            """)
        except sqlite3.OperationalError:
            # FTS5不可用时跳过
            pass

        # 元数据表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        cursor.execute("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)",
                       ("schema_version", self.SCHEMA_VERSION))

        conn.commit()
    def upsert_asset(self, asset_data: Dict) -> int:
        """
        插入或更新资产（UPSERT）

        Args:
            asset_data: 资产数据字典

        Returns:
            资产ID
        """
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            now = time.time()

            ip = asset_data.get("ip", "")
            if not ip:
                return 0

            # 检查是否已存在
            cursor.execute("SELECT id, first_seen, scan_count FROM assets WHERE ip = ?", (ip,))
            existing = cursor.fetchone()

            if existing:
                asset_id = existing["id"]
                first_seen = existing["first_seen"]
                scan_count = existing["scan_count"] + 1

                # 更新资产
                cursor.execute("""
                    UPDATE assets SET
                        hostname = COALESCE(?, hostname),
                        domain = COALESCE(?, domain),
                        os = COALESCE(?, os),
                        os_version = COALESCE(?, os_version),
                        status = ?,
                        risk_score = ?,
                        risk_level = ?,
                        last_seen = ?,
                        scan_count = ?,
                        tags = ?,
                        extra = ?
                    WHERE id = ?
                """, (
                    asset_data.get("hostname") or None,
                    asset_data.get("domain") or None,
                    asset_data.get("os") or None,
                    asset_data.get("os_version") or None,
                    asset_data.get("status", "up"),
                    asset_data.get("risk_score", 0.0),
                    asset_data.get("risk_level", "info"),
                    now,
                    scan_count,
                    json.dumps(asset_data.get("tags", []), ensure_ascii=False),
                    json.dumps(asset_data.get("extra", {}), ensure_ascii=False),
                    asset_id,
                ))
            else:
                # 新资产
                cursor.execute("""
                    INSERT INTO assets (
                        ip, hostname, domain, os, os_version, status,
                        risk_score, risk_level, first_seen, last_seen, scan_count, tags, extra
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    ip,
                    asset_data.get("hostname", ""),
                    asset_data.get("domain", ""),
                    asset_data.get("os", ""),
                    asset_data.get("os_version", ""),
                    asset_data.get("status", "up"),
                    asset_data.get("risk_score", 0.0),
                    asset_data.get("risk_level", "info"),
                    now, now, 1,
                    json.dumps(asset_data.get("tags", []), ensure_ascii=False),
                    json.dumps(asset_data.get("extra", {}), ensure_ascii=False),
                ))
                asset_id = cursor.lastrowid

            # 入库端口
            ports = asset_data.get("ports", [])
            for port_data in ports:
                self._upsert_port(cursor, asset_id, port_data, now)

            # 入库指纹
            fingerprints = asset_data.get("fingerprints", [])
            for fp_data in fingerprints:
                self._upsert_fingerprint(cursor, asset_id, fp_data, now)

            # 入库CVE
            cves = asset_data.get("cves", [])
            for cve_data in cves:
                self._upsert_cve(cursor, asset_id, cve_data, now)

            conn.commit()
            return asset_id
    def _upsert_port(self, cursor, asset_id: int, port_data: Dict, now: float):
        """插入或更新端口"""
        port = port_data.get("port", 0)
        protocol = port_data.get("protocol", "tcp")

        cursor.execute("""
            SELECT id, first_seen FROM ports WHERE asset_id = ? AND port = ? AND protocol = ?
        """, (asset_id, port, protocol))
        existing = cursor.fetchone()

        if existing:
            cursor.execute("""
                UPDATE ports SET
                    state = ?, service = ?, version = ?, banner = ?,
                    product = ?, cpe = ?, last_seen = ?, extra = ?
                WHERE id = ?
            """, (
                port_data.get("state", "open"),
                port_data.get("service", ""),
                port_data.get("version", ""),
                port_data.get("banner", ""),
                port_data.get("product", ""),
                port_data.get("cpe", ""),
                now,
                json.dumps(port_data.get("extra", {}), ensure_ascii=False),
                existing["id"],
            ))
        else:
            cursor.execute("""
                INSERT INTO ports (
                    asset_id, port, protocol, state, service, version,
                    banner, product, cpe, first_seen, last_seen, extra
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                asset_id, port, protocol,
                port_data.get("state", "open"),
                port_data.get("service", ""),
                port_data.get("version", ""),
                port_data.get("banner", ""),
                port_data.get("product", ""),
                port_data.get("cpe", ""),
                now, now,
                json.dumps(port_data.get("extra", {}), ensure_ascii=False),
            ))
    def _upsert_fingerprint(self, cursor, asset_id: int, fp_data: Dict, now: float):
        """插入或更新指纹"""
        name = fp_data.get("name", "")
        port = fp_data.get("port", 0)

        cursor.execute("""
            SELECT id FROM fingerprints WHERE asset_id = ? AND name = ? AND port = ?
        """, (asset_id, name, port))
        existing = cursor.fetchone()

        if existing:
            cursor.execute("""
                UPDATE fingerprints SET
                    category = ?, confidence = ?, version = ?, last_seen = ?
                WHERE id = ?
            """, (
                fp_data.get("category", ""),
                fp_data.get("confidence", 0.0),
                fp_data.get("version", ""),
                now,
                existing["id"],
            ))
        else:
            cursor.execute("""
                INSERT INTO fingerprints (
                    asset_id, port, name, category, confidence, version,
                    icon, website, first_seen, last_seen
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                asset_id, port, name,
                fp_data.get("category", ""),
                fp_data.get("confidence", 0.0),
                fp_data.get("version", ""),
                fp_data.get("icon", ""),
                fp_data.get("website", ""),
                now, now,
            ))
