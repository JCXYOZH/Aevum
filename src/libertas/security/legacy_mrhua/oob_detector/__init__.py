"""
security/oob_detector.py - 带外检测(OOB)与利用代码生成器

核心能力：
- DNS回调检测（验证盲SSRF、盲XXE、盲命令注入）
- HTTP回调检测（验证盲漏洞）
- 利用代码生成器（根据漏洞类型生成PoC/Exploit）
- 支持SQL注入、XSS、命令注入、SSRF、目录遍历、文件上传等漏洞类型
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
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict


# ================================================================
# 数据结构
# ================================================================

from .oob_channel_type import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403
from .methods_1 import *  # noqa: F401,F403
from .methods_2 import *  # noqa: F401,F403

class ExploitGenerator(ExploitGeneratorPart1, ExploitGeneratorPart2, ExploitGeneratorBase):
    pass

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + ".oob_channel_type"], _sys.modules[__name__ + ".core"], _sys.modules[__name__ + ".methods_1"], _sys.modules[__name__ + ".methods_2"]]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(vars(_pkg).items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
