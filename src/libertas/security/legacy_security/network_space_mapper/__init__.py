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
from .topology_generator import *  # noqa: F401,F403

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + ".models"], _sys.modules[__name__ + ".asset_fingerprint"], _sys.modules[__name__ + ".network_space_mapper"], _sys.modules[__name__ + ".topology_generator"]]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(vars(_pkg).items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
