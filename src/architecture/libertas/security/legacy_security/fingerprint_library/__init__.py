"""
花先生 - 指纹库运维管理系统
============================
资产指纹规则的全生命周期管理。

核心能力：
1. 指纹规则CRUD（增删改查，不碰代码）
2. 规则导入导出（兼容Wappalyzer/WhatWeb/EHole格式）
3. 版本管理（版本号、变更日志、回滚）
4. 热更新（运行时加载新规则，无需重启）
5. 自动学习（从扫描结果中提取未知指纹模式）
6. 质量评估（命中率/误报率统计）
7. 规则冲突检测与优先级
8. 指纹库统计分析

作者：花先生
版本：2.0.0
"""

import json
import os
import time
import re
import hashlib
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Tuple, Any, Set
from enum import Enum
from collections import defaultdict, Counter
import logging
import threading

from .convert_mapper_match import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403
from .methods_1 import *  # noqa: F401,F403
from .methods_2 import *  # noqa: F401,F403
from .methods_3 import *  # noqa: F401,F403

class FingerprintLibrary(FingerprintLibraryPart1, FingerprintLibraryPart2, FingerprintLibraryPart3, FingerprintLibraryBase):
    pass

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + ".convert_mapper_match"], _sys.modules[__name__ + ".core"], _sys.modules[__name__ + ".methods_1"], _sys.modules[__name__ + ".methods_2"], _sys.modules[__name__ + ".methods_3"]]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(vars(_pkg).items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
