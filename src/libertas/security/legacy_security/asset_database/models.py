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

logger = logging.getLogger(__name__)

class RiskLevel(Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"

@dataclass
class AssetRecord:
    """资产记录"""
    id: Optional[int] = None
    ip: str = ""
    hostname: str = ""
    domain: str = ""
    os: str = ""
    os_version: str = ""
    status: str = "unknown"
    risk_score: float = 0.0
    risk_level: str = "info"
    latitude: float = 0.0
    longitude: float = 0.0
    country: str = ""
    region: str = ""
    city: str = ""
    isp: str = ""
    asn: str = ""
    org: str = ""
    first_seen: float = 0.0
    last_seen: float = 0.0
    scan_count: int = 0
    tags: List[str] = field(default_factory=list)
    extra: Dict = field(default_factory=dict)

@dataclass
class PortRecord:
    """端口记录"""
    id: Optional[int] = None
    asset_id: int = 0
    port: int = 0
    protocol: str = "tcp"
    state: str = "closed"
    service: str = ""
    version: str = ""
    banner: str = ""
    product: str = ""
    cpe: str = ""
    first_seen: float = 0.0
    last_seen: float = 0.0
    extra: Dict = field(default_factory=dict)

@dataclass
class FingerprintRecord:
    """指纹记录"""
    id: Optional[int] = None
    asset_id: int = 0
    port: int = 0
    name: str = ""
    category: str = ""
    confidence: float = 0.0
    version: str = ""
    icon: str = ""
    website: str = ""
    first_seen: float = 0.0
    last_seen: float = 0.0

@dataclass
class CveRecord:
    """CVE记录"""
    id: Optional[int] = None
    asset_id: int = 0
    cve_id: str = ""
    severity: str = "medium"
    cvss_score: float = 0.0
    description: str = ""
    affected_product: str = ""
    affected_version: str = ""
    exploit_available: bool = False
    patch_available: bool = True
    references: List[str] = field(default_factory=list)
    first_seen: float = 0.0
    last_seen: float = 0.0

@dataclass
class ScanRecord:
    """扫描记录"""
    id: Optional[int] = None
    scan_id: str = ""
    name: str = ""
    target: str = ""
    scan_type: str = "quick"
    status: str = "completed"
    started_at: float = 0.0
    completed_at: float = 0.0
    total_targets: int = 0
    alive_hosts: int = 0
    open_ports: int = 0
    vulnerabilities: int = 0
    options: Dict = field(default_factory=dict)
