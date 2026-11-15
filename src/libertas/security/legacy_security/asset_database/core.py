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

class AssetDatabaseBase:
    """
    资产数据库（SQLite）
    线程安全，支持多线程并发访问
    """

    SCHEMA_VERSION = "2.0"
