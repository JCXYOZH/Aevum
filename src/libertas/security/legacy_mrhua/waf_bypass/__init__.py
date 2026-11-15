"""
security/waf_bypass.py - WAF绕过自动化闭环

核心能力：
- 整合12种payload变换技术
- 自动发送变换后的payload并判断是否绕过
- 记录每种变换的成功率，自适应选择最有效组合
- 支持多种WAF产品的指纹识别和针对性绕过
- 绕过结果统计和报告生成
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
from collections import defaultdict, Counter


# ================================================================
# 枚举和数据结构
# ================================================================

from .models import *  # noqa: F401,F403
from .payload_transformer import *  # noqa: F401,F403
from .waf_bypass_automator import *  # noqa: F401,F403

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + ".models"], _sys.modules[__name__ + ".payload_transformer"], _sys.modules[__name__ + ".waf_bypass_automator"]]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(vars(_pkg).items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
