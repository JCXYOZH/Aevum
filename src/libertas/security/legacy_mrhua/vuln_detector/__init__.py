"""
security/vuln_detector.py - 漏洞探测与验证引擎

核心能力：
- 自动发送payload到目标的多个注入点（URL参数、POST数据、Header、Cookie）
- 分析响应判断漏洞是否存在（状态码、内容、时间延迟、错误信息、特定模式）
- 漏洞验证（确认漏洞真实存在，排除误报）
- 支持SQL注入、XSS、命令注入、目录遍历、SSRF、文件上传、CRLF、SSTI等漏洞类型
- 扫描报告生成
"""
import os
import re
import sys
import json
import time
import uuid
import socket
import hashlib
import threading
import urllib.parse
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Tuple, Set, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict


# ================================================================
# 漏洞类型和严重程度枚举
# ================================================================

from .models import *  # noqa: F401,F403
from .http_client import *  # noqa: F401,F403
from .response_analyzer import *  # noqa: F401,F403
from .vulnerability_verifier import *  # noqa: F401,F403
from .vulnerability_detector import *  # noqa: F401,F403
from .scan_report_generator import *  # noqa: F401,F403

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + ".models"], _sys.modules[__name__ + ".http_client"], _sys.modules[__name__ + ".response_analyzer"], _sys.modules[__name__ + ".vulnerability_verifier"], _sys.modules[__name__ + ".vulnerability_detector"], _sys.modules[__name__ + ".scan_report_generator"]]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(vars(_pkg).items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
