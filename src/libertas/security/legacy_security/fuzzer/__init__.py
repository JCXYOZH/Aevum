"""
security/fuzzer.py - 模糊测试引擎

核心能力：
- ParameterFuzzer: 参数模糊测试（超长字符串、特殊字符、类型混淆、边界值）
- FormatFuzzer: 格式模糊测试（JSON/XML/CSV/Multipart格式变异）
- MutationEngine: 变异引擎（15种变异策略，基于种子的智能变异）
- FuzzerOrchestrator: 模糊测试编排器（并发、进度、结果聚合、崩溃检测）
"""
import os
import re
import sys
import json
import time
import uuid
import random
import string
import threading
from typing import Any, Dict, List, Optional, Tuple, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse


# ================================================================
# 变异引擎
# ================================================================

from .mutation_strategy import *  # noqa: F401,F403
from .mutation_engine import *  # noqa: F401,F403
from .fuzz_result import *  # noqa: F401,F403
from .format_fuzzer import *  # noqa: F401,F403

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + ".mutation_strategy"], _sys.modules[__name__ + ".mutation_engine"], _sys.modules[__name__ + ".fuzz_result"], _sys.modules[__name__ + ".format_fuzzer"]]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(vars(_pkg).items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
