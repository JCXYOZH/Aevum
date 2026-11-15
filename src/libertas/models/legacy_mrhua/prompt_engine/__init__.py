# models/prompt_engine.py
"""
提示词引擎 - 多层提示词构建系统
层级：身份层 → 用户人格层 → 预设行为层 → 场景层 → 服从层 → 沉浸感层 → 指令层 → 硬规则层
预设人格只作为行为风格层叠加，不覆盖用户自定义的身份和人格设定。
"""
import time
from typing import Dict, List, Any, Optional


# 预设人格：只定义行为风格和专业准则，不定义用户身份

from .constants import *  # noqa: F401,F403
from .prompt_engine import *  # noqa: F401,F403

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + "." + 'constants'], _sys.modules[__name__ + "." + 'prompt_engine']]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(_pkg.__dict__.items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
