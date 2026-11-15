"""
models/prompt_engine_expansion.py - 提示词引擎综合扩展模块

高级提示词管理：提示词模板库、提示词优化器、少样本示例管理器、
提示词版本控制、提示词A/B测试、提示词效果评估器、动态提示词组装器。
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
from collections import deque, Counter
from enum import Enum
from libertas.foundation.terminal import terminal


# ================================================================
# 提示词类型
# ================================================================

from .prompt_type import *  # noqa: F401,F403
from .prompt_optimizer import *  # noqa: F401,F403
from .prompt_ab_tester import *  # noqa: F401,F403
from .get_prompt_ab_tester import *  # noqa: F401,F403

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + "." + 'prompt_type'], _sys.modules[__name__ + "." + 'prompt_optimizer'], _sys.modules[__name__ + "." + 'prompt_ab_tester'], _sys.modules[__name__ + "." + 'get_prompt_ab_tester']]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(_pkg.__dict__.items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
