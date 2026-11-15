"""
security/asset_discovery.py - 资产发现与目录爆破

核心能力：
- 子域名枚举（字典爆破、DNS解析、证书透明度、搜索引擎）
- 目录爆破（常见路径、管理后台、备份文件、配置文件）
- 端口扫描（基础版）
- 服务识别
- 资产信息聚合
"""
import os
import re
import sys
import json
import time
import uuid
import socket
import threading
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple, Set
from dataclasses import dataclass, field
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor, as_completed


# ================================================================
# 数据结构
# ================================================================

from .models import *  # noqa: F401,F403
from .constants import *  # noqa: F401,F403
from .asset_discovery import *  # noqa: F401,F403

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + ".models"], _sys.modules[__name__ + ".constants"], _sys.modules[__name__ + ".asset_discovery"]]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(vars(_pkg).items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
