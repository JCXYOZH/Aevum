"""
security/browser_automation.py - 浏览器自动化与实战执行引擎

核心能力：
- BrowserAutomation: 浏览器自动化（Playwright/Selenium/requests三级降级）
  - JS渲染页面抓取
  - 页面截图（AI可"看见"渲染结果）
  - 表单自动填写与提交
  - Cookie/会话管理
  - 等待JS加载完成
  - 元素交互（点击/输入/滚动）
- CaptchaSolver: 验证码识别（OCR/AI模型/人工介入三级）
- ManualBypassHelper: 人工手动操作绕过辅助
- RealBypassExecutor: 绕过技术实际执行引擎（真实发送请求测试）
"""
import os
import re
import sys
import json
import time
import uuid
import random
import base64
import hashlib
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from collections import defaultdict, Counter
from enum import Enum

from .models import *  # noqa: F401,F403
from .browser_automation import *  # noqa: F401,F403
from .captcha_solver import *  # noqa: F401,F403
from .real_bypass_executor import *  # noqa: F401,F403

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + ".models"], _sys.modules[__name__ + ".browser_automation"], _sys.modules[__name__ + ".captcha_solver"], _sys.modules[__name__ + ".real_bypass_executor"]]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(vars(_pkg).items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
