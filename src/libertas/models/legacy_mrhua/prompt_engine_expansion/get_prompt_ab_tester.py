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

from .prompt_ab_tester import _prompt_ab_tester, _dynamic_prompt_assembler

def get_prompt_ab_tester() -> PromptABTester:
    return _prompt_ab_tester

def get_dynamic_prompt_assembler() -> DynamicPromptAssembler:
    return _dynamic_prompt_assembler
