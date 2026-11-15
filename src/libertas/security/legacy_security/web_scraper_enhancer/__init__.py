"""
security/web_scraper_enhancer.py - 网页抓取增强与反爬绕过

核心能力：
- WebScraperEnhancer: 增强型网页抓取
  - JS渲染页面抓取（模拟浏览器行为）
  - 反爬绕过（User-Agent轮换/请求间隔/代理池/Referer伪造）
  - 会话管理（Cookie持久化/CSRF Token自动处理）
  - 深度抓取（链接发现/递归爬取/内容去重）
  - 动态内容提取（AJAX/API端点发现）
  - 登录态抓取（表单自动提交/会话保持）
- ContentExtractor: 结构化内容提取
  - 正文提取（去除导航/广告/页脚）
  - 表格提取
  - 链接提取与分类
  - 元数据提取（title/description/keywords）
  - 表单提取（输入框/按钮/隐藏字段）
"""
import os
import re
import sys
import json
import time
import uuid
import random
import hashlib
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from collections import defaultdict, Counter
from html.parser import HTMLParser


# ================================================================
# User-Agent池
# ================================================================

from .scraped_page import *  # noqa: F401,F403
from .web_scraper_enhancer import *  # noqa: F401,F403

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + ".scraped_page"], _sys.modules[__name__ + ".web_scraper_enhancer"]]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(vars(_pkg).items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
