"""
security/security_bypass_engine.py - 安全验证绕过引擎

核心能力：
- SecurityBypassEngine: 统一安全验证绕过引擎
  - WAF绕过（编码绕过/参数污染/分块传输/协议层绕过）
  - 认证绕过（SQL注入认证/JWT伪造/会话固定/权限提升）
  - 验证码绕过（重放/空值/绕过检查/机器学习识别）
  - 速率限制绕过（IP轮换/请求分散/慢攻击/缓存投毒）
  - 403/401绕过（路径遍历/Header注入/方法替换）
- PayloadObfuscator: Payload混淆器
  - 多种编码（URL/Unicode/HTML/Base64/Hex）
  - 字符串拆分与拼接
  - 注释注入
  - 大小写混淆
- BypassTester: 绕过测试器
  - 自动测试多种绕过技术
  - 成功率统计
  - 最优绕过方案推荐
"""
import os
import re
import sys
import json
import time
import uuid
import random
import hashlib
import base64
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from collections import defaultdict, Counter
from enum import Enum

from .models import *  # noqa: F401,F403
from .constants import *  # noqa: F401,F403
from .security_bypass_engine import *  # noqa: F401,F403

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + ".models"], _sys.modules[__name__ + ".constants"], _sys.modules[__name__ + ".security_bypass_engine"]]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(vars(_pkg).items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
