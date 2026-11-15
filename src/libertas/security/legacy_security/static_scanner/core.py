"""
security/static_scanner.py - 静态代码漏洞扫描器

核心能力：
- 扫描源代码文件中的漏洞模式
- 支持Python、JavaScript、Java、PHP、C/C++等多语言
- 检测SQL注入、XSS、命令注入、硬编码凭证、路径遍历、SSRF、
  不安全反序列化、弱加密、XXE、开放重定向等漏洞
- 基础数据流分析（source到sink追踪）
- 漏洞报告生成（JSON/Markdown/HTML）
- 与Codebase模块集成，支持整个项目扫描
"""
import os
import re
import sys
import json
import time
import uuid
import ast
import hashlib
import threading
from typing import Any, Dict, List, Optional, Tuple, Set, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict, Counter


# ================================================================
# 枚举和数据结构
# ================================================================
from .models import *  # noqa: F401,F403

class VulnPatternLibraryBase:
    """漏洞模式库 - 包含多语言的漏洞检测正则模式"""
