"""
security/security_expansion.py - 安全模块综合扩展

高级安全功能：威胁情报中心、攻击链分析器、漏洞利用模拟器、
安全事件响应引擎、入侵检测规则引擎、安全合规检查器、
蜜罐管理系统、安全评分卡系统。
"""
import os
import json
import time
import uuid
import math
import hashlib
import threading
import re
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter, defaultdict
from enum import Enum
from libertas.foundation.terminal import terminal


# ================================================================
# 威胁等级
# ================================================================

from .threat_level import *  # noqa: F401,F403
from .attack_chain_analyzer import *  # noqa: F401,F403
from .ids_rule_engine import *  # noqa: F401,F403
from .incident_response_engine import *  # noqa: F401,F403
from .get_threat_intel_center import *  # noqa: F401,F403

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + ".threat_level"], _sys.modules[__name__ + ".attack_chain_analyzer"], _sys.modules[__name__ + ".ids_rule_engine"], _sys.modules[__name__ + ".incident_response_engine"], _sys.modules[__name__ + ".get_threat_intel_center"]]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(vars(_pkg).items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
