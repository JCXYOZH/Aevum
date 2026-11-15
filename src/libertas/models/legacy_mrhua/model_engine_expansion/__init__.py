"""
models/model_engine_expansion.py - 模型引擎综合扩展模块

高级模型管理功能：模型路由调度器、多模型负载均衡、模型健康监控、
模型性能基准测试、模型缓存层、模型请求队列、模型成本追踪器。
"""
import os
import json
import time
import uuid
import math
import hashlib
import threading
import queue
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter
from enum import Enum
from libertas.foundation.terminal import terminal


# ================================================================
# 模型状态
# ================================================================

from .models import *  # noqa: F401,F403
from .model_router import *  # noqa: F401,F403
from .model_health_monitor import *  # noqa: F401,F403
from .model_cost_tracker import *  # noqa: F401,F403
from .get_model_router import *  # noqa: F401,F403

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + "." + 'models'], _sys.modules[__name__ + "." + 'model_router'], _sys.modules[__name__ + "." + 'model_health_monitor'], _sys.modules[__name__ + "." + 'model_cost_tracker'], _sys.modules[__name__ + "." + 'get_model_router']]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(_pkg.__dict__.items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
