"""
security/security_facade.py - 统一安全API入口与漏洞优先级排序

核心能力：
- VulnerabilityPrioritizer: 漏洞优先级排序器（CVSS+可利用性+影响面+资产价值）
- SecurityFacade: 统一安全API入口（一键扫描/统一结果格式/多模块协调）
"""
import os
import re
import sys
import json
import time
import uuid
import threading
from typing import Any, Dict, List, Optional, Tuple, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed


# ================================================================
# 漏洞优先级排序器
# ================================================================

from .models import *  # noqa: F401,F403
from .vulnerability_prioritizer import *  # noqa: F401,F403
from .security_facade import *  # noqa: F401,F403

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + ".models"], _sys.modules[__name__ + ".vulnerability_prioritizer"], _sys.modules[__name__ + ".security_facade"]]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(vars(_pkg).items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
