"""
security/advanced_security.py - 高级安全实战模块

核心能力：
- CodeFixGenerator: 漏洞修复代码自动生成器（静态扫描→自动生成修复补丁）
- CVEMatcher: CVE漏洞匹配器（根据服务版本匹配已知CVE）
- ConcurrentScanner: 并发扫描增强器（多目标/多参数并发扫描）
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
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor, as_completed


# ================================================================
# 漏洞修复代码自动生成器
# ================================================================

from .code_fix import *  # noqa: F401,F403
from .cve_match import *  # noqa: F401,F403
from .concurrent_scanner import *  # noqa: F401,F403

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + ".code_fix"], _sys.modules[__name__ + ".cve_match"], _sys.modules[__name__ + ".concurrent_scanner"]]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(vars(_pkg).items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
