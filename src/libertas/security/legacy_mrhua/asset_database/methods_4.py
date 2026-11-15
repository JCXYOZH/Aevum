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
from .methods_3 import *  # noqa: F401,F403

class AssetDatabasePart4(object):
    def add_tag_to_asset(self, asset_id: int, tag_name: str):
        """给资产打标签"""
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()

            cursor.execute("SELECT id FROM tags WHERE name = ?", (tag_name,))
            tag = cursor.fetchone()
            if not tag:
                tag_id = self.create_tag(tag_name)
            else:
                tag_id = tag["id"]

            cursor.execute("INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)",
                           (asset_id, tag_id))

            # 更新资产的tags字段
            cursor.execute("SELECT tags FROM assets WHERE id = ?", (asset_id,))
            row = cursor.fetchone()
            if row:
                tags = json.loads(row["tags"] or "[]")
                if tag_name not in tags:
                    tags.append(tag_name)
                    cursor.execute("UPDATE assets SET tags = ? WHERE id = ?",
                                   (json.dumps(tags, ensure_ascii=False), asset_id))

            conn.commit()
    def remove_tag_from_asset(self, asset_id: int, tag_name: str):
        """移除资产标签"""
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()

            cursor.execute("SELECT id FROM tags WHERE name = ?", (tag_name,))
            tag = cursor.fetchone()
            if tag:
                cursor.execute("DELETE FROM asset_tags WHERE asset_id = ? AND tag_id = ?",
                               (asset_id, tag["id"]))

            cursor.execute("SELECT tags FROM assets WHERE id = ?", (asset_id,))
            row = cursor.fetchone()
            if row:
                tags = json.loads(row["tags"] or "[]")
                if tag_name in tags:
                    tags.remove(tag_name)
                    cursor.execute("UPDATE assets SET tags = ? WHERE id = ?",
                                   (json.dumps(tags, ensure_ascii=False), asset_id))

            conn.commit()
    def list_tags(self) -> List[Dict]:
        """列出所有标签"""
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("""
                SELECT t.*, COUNT(at.asset_id) as asset_count
                FROM tags t LEFT JOIN asset_tags at ON at.tag_id = t.id
                GROUP BY t.id ORDER BY asset_count DESC
            """)
            return [dict(r) for r in cursor.fetchall()]
    def record_scan(self, scan_data: Dict) -> str:
        """记录扫描任务"""
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()

            import uuid
            scan_id = scan_data.get("scan_id") or str(uuid.uuid4())[:8]

            cursor.execute("""
                INSERT OR REPLACE INTO scans (
                    scan_id, name, target, scan_type, status,
                    started_at, completed_at, total_targets, alive_hosts,
                    open_ports, vulnerabilities, options
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                scan_id,
                scan_data.get("name", ""),
                scan_data.get("target", ""),
                scan_data.get("scan_type", "quick"),
                scan_data.get("status", "completed"),
                scan_data.get("started_at", time.time()),
                scan_data.get("completed_at", time.time()),
                scan_data.get("total_targets", 0),
                scan_data.get("alive_hosts", 0),
                scan_data.get("open_ports", 0),
                scan_data.get("vulnerabilities", 0),
                json.dumps(scan_data.get("options", {}), ensure_ascii=False),
            ))
            conn.commit()
            return scan_id
    def save_snapshot(self, scan_id: str, asset_ip: str, snapshot_data: Dict):
        """保存资产快照"""
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO asset_snapshots (scan_id, asset_ip, snapshot_data, created_at)
                VALUES (?, ?, ?, ?)
            """, (scan_id, asset_ip, json.dumps(snapshot_data, ensure_ascii=False), time.time()))
            conn.commit()
    def get_asset_history(self, ip: str, limit: int = 20) -> List[Dict]:
        """获取资产历史快照（时间线回溯）"""
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("""
                SELECT s.*, sc.name as scan_name, sc.scan_type
                FROM asset_snapshots s
                LEFT JOIN scans sc ON sc.scan_id = s.scan_id
                WHERE s.asset_ip = ?
                ORDER BY s.created_at DESC LIMIT ?
            """, (ip, limit))
            results = []
            for row in cursor.fetchall():
                d = dict(row)
                d["snapshot_data"] = json.loads(d.get("snapshot_data", "{}"))
                results.append(d)
            return results
    def list_scans(self, limit: int = 50) -> List[Dict]:
        """列出扫描记录"""
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM scans ORDER BY started_at DESC LIMIT ?", (limit,))
            results = []
            for row in cursor.fetchall():
                d = dict(row)
                d["options"] = json.loads(d.get("options", "{}"))
                results.append(d)
            return results
    def export_json(self, filepath: str, filters: Optional[Dict] = None):
        """导出为JSON"""
        result = self.query_assets(filters=filters, page=1, page_size=100000)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(result["assets"], f, ensure_ascii=False, indent=2)
    def export_csv(self, filepath: str, filters: Optional[Dict] = None):
        """导出为CSV"""
        result = self.query_assets(filters=filters, page=1, page_size=100000)
        with open(filepath, 'w', encoding='utf-8-sig', newline='') as f:
            if result["assets"]:
                fieldnames = ["ip", "hostname", "domain", "os", "status", "risk_score",
                              "risk_level", "open_port_count", "cve_count", "first_seen", "last_seen"]
                writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
                writer.writeheader()
                for asset in result["assets"]:
                    writer.writerow(asset)
    def export_xml(self, filepath: str, filters: Optional[Dict] = None):
        """导出为XML"""
        result = self.query_assets(filters=filters, page=1, page_size=100000)
        import xml.etree.ElementTree as ET
        root = ET.Element("assets")
        for asset in result["assets"]:
            asset_elem = ET.SubElement(root, "asset")
            for key, value in asset.items():
                if key not in ("extra", "tags"):
                    elem = ET.SubElement(asset_elem, key)
                    elem.text = str(value)
        tree = ET.ElementTree(root)
        tree.write(filepath, encoding='utf-8', xml_declaration=True)
    def cleanup(self, days: int = 90):
        """清理过期数据"""
        with self._lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cutoff = time.time() - days * 86400

            # 清理过期快照
            cursor.execute("DELETE FROM asset_snapshots WHERE created_at < ?", (cutoff,))
            # 清理过期扫描记录
            cursor.execute("DELETE FROM scans WHERE completed_at < ? AND completed_at > 0", (cutoff,))

            conn.commit()
    def vacuum(self):
        """优化数据库（VACUUM）"""
        with self._lock:
            conn = self._get_conn()
            conn.execute("VACUUM")
    def get_db_size(self) -> int:
        """获取数据库大小（字节）"""
        return os.path.getsize(self.db_path) if os.path.exists(self.db_path) else 0
    def close(self):
        """关闭数据库连接（执行 WAL checkpoint，确保数据持久化）"""
        if self._closed:
            return
        self._closed = True
        if self._conn:
            try:
                # 停止恢复线程
                if self._recovery_thread and self._recovery_thread.is_alive():
                    self._fallback_in_memory = False
                    self._recovery_thread.join(timeout=5)
            except Exception:
                pass
            try:
                # 执行 WAL checkpoint，将 WAL 文件合并到主数据库
                self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            except Exception as e:
                logger.warning("WAL checkpoint 失败: %s", e)
            try:
                self._conn.close()
            except Exception as e:
                logger.warning("数据库连接关闭失败: %s", e)
            self._conn = None
            logger.info("资产数据库已安全关闭")
