"""WAF/IDS/IPS 集中防护引擎 - 统一入口，整合指纹识别、载荷分析、沙箱测试、流量监控。

防护模式：
- off: 关闭
- detect: 仅检测记录（默认）
- alert: 检测+告警
- protect: 检测+告警+阻断（IPS模式）
"""

import time
import json
import threading
import logging
from typing import Dict, List, Optional, Any
from collections import deque

from libertas.security.legacy_security.waf_fingerprint import detect_waf, is_blocked_by_waf
from libertas.security.legacy_security.payload_analyzer import analyze_request, analyze_response, PAYLOAD_CATEGORIES
from libertas.security.legacy_security.waf_sandbox import get_waf_sandbox
from libertas.security.legacy_security.traffic_monitor import get_traffic_detector

from .constants import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403
from .methods_1 import *  # noqa: F401,F403
from .methods_2 import *  # noqa: F401,F403

class SecurityEngine(SecurityEnginePart1, SecurityEnginePart2, SecurityEngineBase):
    pass
from .get_security_engine import *  # noqa: F401,F403

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + ".constants"], _sys.modules[__name__ + ".core"], _sys.modules[__name__ + ".methods_1"], _sys.modules[__name__ + ".methods_2"], _sys.modules[__name__ + ".get_security_engine"]]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(vars(_pkg).items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
