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

class MutationStrategy(Enum):
    """变异策略枚举"""
    BIT_FLIP = "bit_flip"
    BYTE_FLIP = "byte_flip"
    ARITHMETIC = "arithmetic"
    INTERESTING_VALUE = "interesting_value"
    OVERWRITE = "overwrite"
    INSERT = "insert"
    DELETE = "delete"
    DUPLICATE = "duplicate"
    TRUNCATE = "truncate"
    EXTEND = "extend"
    REPLACE_CHAR = "replace_char"
    INSERT_SPECIAL = "insert_special"
    FORMAT_STRING = "format_string"
    SQL_INJECTION = "sql_injection"
    XSS_PAYLOAD = "xss_payload"
    COMMAND_INJECTION = "command_injection"
    PATH_TRAVERSAL = "path_traversal"
    NULL_BYTE = "null_byte"
    UNICODE_MANGLE = "unicode_mangle"
    ENCODING_BYPASS = "encoding_bypass"
