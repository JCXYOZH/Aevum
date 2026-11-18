"""
花先生 - 广域网异步扫描引擎
============================
大规模网络空间测绘的核心扫描层。

核心能力：
1. 异步IO扫描引擎（asyncio + 自定义连接池），支持万级并发
2. 多种扫描技术：ICMP ping sweep、TCP connect、TCP SYN/ACK/FIN、UDP、ARP
3. 断点续扫（进度持久化），支持暂停/恢复/取消
4. 扫描速率自适应、随机化顺序、超时重试
5. 端口范围预设：Top 100/1000/全端口
6. 广域网情报收集：子域名枚举、ASN/WHOIS、SSL证书提取、IP反查域名
7. 扫描任务管理：任务队列、优先级、实时进度回调
8. 扫描结果流式输出

作者：花先生
版本：2.0.0
"""

import asyncio
import socket
import struct
import random
import time
import json
import os
import re
import ssl
import ipaddress
import concurrent.futures
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Tuple, Set, Callable, Any, Union
from enum import Enum
from collections import defaultdict
import logging

from .generate_top_1000_ports import *  # noqa: F401,F403
from .async_port_scanner import *  # noqa: F401,F403
from .icmp_pinger import *  # noqa: F401,F403
from .intelligence_collector import *  # noqa: F401,F403
from .scan_task_manager import *  # noqa: F401,F403
from .wan_scanner import *  # noqa: F401,F403

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + ".generate_top_1000_ports"], _sys.modules[__name__ + ".async_port_scanner"], _sys.modules[__name__ + ".icmp_pinger"], _sys.modules[__name__ + ".intelligence_collector"], _sys.modules[__name__ + ".scan_task_manager"], _sys.modules[__name__ + ".wan_scanner"]]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(vars(_pkg).items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
