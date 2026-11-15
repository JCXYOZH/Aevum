"""
花先生 - 指纹库运维管理系统
============================
资产指纹规则的全生命周期管理。

核心能力：
1. 指纹规则CRUD（增删改查，不碰代码）
2. 规则导入导出（兼容Wappalyzer/WhatWeb/EHole格式）
3. 版本管理（版本号、变更日志、回滚）
4. 热更新（运行时加载新规则，无需重启）
5. 自动学习（从扫描结果中提取未知指纹模式）
6. 质量评估（命中率/误报率统计）
7. 规则冲突检测与优先级
8. 指纹库统计分析

作者：花先生
版本：2.0.0
"""

import json
import os
import time
import re
import hashlib
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Tuple, Any, Set
from enum import Enum
from collections import defaultdict, Counter
import logging
import threading

logger = logging.getLogger(__name__)

def _convert_mapper_match(m) -> Optional[Dict]:
    """把网络测绘引擎的匹配项转换为指纹库的匹配项结构。

    两套子系统的字段语义不同，这里做等价映射：
      header: key + value(子串,不区分大小写) -> name + pattern(正则)
      cookie: key(存在即匹配)                -> name + pattern(空正则)
      path:   value(子串)                    -> url + pattern(正则)
      port:   value(整数)                    -> port + pattern(字符串)
      content / banner: pattern 语义一致，原样保留
    转换失败返回 None（仅丢弃该匹配项，不影响同一规则的其它匹配项）。
    """
    if not isinstance(m, dict):
        return None
    mtype = m.get("type", "")
    if mtype == "header":
        key = m.get("key", "")
        if not key:
            return None
        value = m.get("value", "")
        return {"type": "header", "name": key,
                "pattern": re.escape(str(value)) if value else ""}
    if mtype == "content":
        pattern = m.get("pattern", "")
        return {"type": "content", "pattern": pattern} if pattern else None
    if mtype == "cookie":
        key = m.get("key", "")
        return {"type": "cookie", "name": key, "pattern": ""} if key else None
    if mtype == "path":
        value = m.get("value", "")
        return {"type": "url", "pattern": re.escape(str(value))} if value else None
    if mtype == "port":
        value = m.get("value")
        return {"type": "port", "pattern": str(int(value))} if value else None
    if mtype == "banner":
        pattern = m.get("pattern", "")
        return {"type": "banner", "pattern": pattern} if pattern else None
    return None

class FingerprintCategory(Enum):
    CMS = "cms"
    FRAMEWORK = "framework"
    MIDDLEWARE = "middleware"
    DATABASE = "database"
    DEVICE = "device"
    DEVOPS = "devops"
    SECURITY = "security"
    LANGUAGE = "language"
    CDN = "cdn"
    WAF = "waf"
    OTHER = "other"

class MatchType(Enum):
    HEADER = "header"
    CONTENT = "content"
    COOKIE = "cookie"
    URL = "url"
    PORT = "port"
    BANNER = "banner"
    FAVICON = "favicon"
    CERT = "cert"
    SCRIPT = "script"
    META = "meta"

@dataclass
class MatchRule:
    """单条匹配规则"""
    type: str  # header/content/cookie/url/port/banner/favicon/cert/script/meta
    pattern: str  # 正则表达式或字符串
    name: str = ""  # 对于header/cookie，指定名称
    confidence: float = 1.0  # 该规则的置信度
    negate: bool = False  # 取反匹配

@dataclass
class FingerprintRule:
    """指纹规则"""
    id: Optional[int] = None
    name: str = ""  # 产品名称
    category: str = "other"  # 类别
    vendor: str = ""  # 厂商
    website: str = ""  # 官网
    icon: str = ""  # 图标
    description: str = ""  # 描述
    match_rules: List[Dict] = field(default_factory=list)  # 匹配规则列表
    condition: str = "or"  # 规则组合条件：and/or
    priority: int = 100  # 优先级（数字越小越优先）
    confidence: float = 1.0  # 整体置信度
    version_pattern: str = ""  # 版本提取正则
    cpe: str = ""  # CPE标识
    tags: List[str] = field(default_factory=list)
    enabled: bool = True
    created_at: float = 0.0
    updated_at: float = 0.0
    author: str = ""
    source: str = "manual"  # manual/imported/learned
    hits: int = 0  # 命中次数
    false_positives: int = 0  # 误报次数
    version: str = "1.0"  # 规则版本

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict) -> "FingerprintRule":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})

@dataclass
class FingerprintLibraryVersion:
    """指纹库版本"""
    version: str
    created_at: float
    rule_count: int
    changelog: str
    author: str = ""

@dataclass
class LearnedPattern:
    """自动学习到的模式"""
    pattern: str = ""
    match_type: str = ""
    id: Optional[int] = None
    occurrences: int = 0
    sample_urls: List[str] = field(default_factory=list)
    confidence: float = 0.0
    suggested_name: str = ""
    suggested_category: str = "other"
    status: str = "pending"  # pending/approved/rejected
    created_at: float = 0.0
    reviewed_by: str = ""
