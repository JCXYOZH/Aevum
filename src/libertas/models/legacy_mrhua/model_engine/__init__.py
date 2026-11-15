# models/model_engine.py
# 模型引擎：负责本地/云端模型的加载、推理、流式生成
# 支持量化加载（4bit/8bit）、CPU/GPU 混合、自动降级
import os
import sys
import json
import time
import math
import random
import threading
import hashlib
import re
from collections import deque, OrderedDict
from datetime import datetime
from typing import Dict, List, Optional, Any, Callable
try:
    import jieba
except ImportError:
    jieba = None

# 尝试导入 transformers 相关
try:
    import torch
except ImportError:
    torch = None

try:
    from transformers import AutoModelForCausalLM, AutoTokenizer, GenerationConfig, TextIteratorStreamer
    try:
        from transformers import logging as _transformers_logging
        logger = _transformers_logging.get_logger(__name__)
    except Exception:
        logger = None
except ImportError:
    AutoModelForCausalLM = None
    AutoTokenizer = None
    GenerationConfig = None
    TextIteratorStreamer = None
    logger = None

# 兜底：纯云端安装（未安装 transformers）时 logger 会是 None，
# 会让下面所有 logger.warning/info 抛 AttributeError，把真正的错误盖掉。
if logger is None:
    import logging as _std_logging
    logger = _std_logging.getLogger(__name__)

# 尝试导入 bitsandbytes（量化）
# bitsandbytes 与某些 torch 版本不兼容时，可能在导入阶段抛出 AttributeError
# （例如 module 'torch' has no attribute 'library'），这不应导致整个模型引擎无法加载。
bitsandbytes = None
bitsandbytes_import_error = None
try:
    import bitsandbytes
except Exception as exc:  # noqa: BLE001 - optional dependency may fail under incompatible envs
    bitsandbytes_import_error = exc
    bitsandbytes = None
    if logger is not None:
        logger.warning("bitsandbytes 不可用，跳过 8-bit/4-bit 量化: %s", exc)

# 尝试导入 llama-cpp-python（GGUF格式支持，加载速度快3-5倍，显存占用小）
# 某些 Windows / 打包环境下，llama_cpp 的原生库路径可能不存在，导致 FileNotFoundError
# 或其他加载错误；这不应让整个 MrHua 在启动时崩溃。
LlamaCpp = None
_llama_cpp_available = False
llama_cpp_import_error = None
try:
    from llama_cpp import Llama as LlamaCpp
    _llama_cpp_available = True
except Exception as exc:  # noqa: BLE001 - optional native dependency may fail on missing DLLs
    llama_cpp_import_error = exc
    LlamaCpp = None
    _llama_cpp_available = False
    if logger is not None:
        logger.warning("llama_cpp 不可用，GGUF 模型加载已禁用: %s", exc)

# 尝试导入 requests（云端调用）
try:
    import requests
except ImportError:
    requests = None

# SSH隧道管理器
try:
    from libertas.network.ssh_tunnel import SSHTunnelManager
except Exception:
    SSHTunnelManager = None

# 隐私脱敏引擎
try:
    from libertas.security.privacy import PrivacySanitizer
except Exception:
    PrivacySanitizer = None

# 导入用户管理（用于规则加载）
from libertas.identity.user import UserManager
from libertas.tools.batch_executor import extract_tasks_from_reply, BatchExecutor
from libertas.foundation.config import get_data_dir

# ==================== 模型LRU缓存 ====================

from .model_cache import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403
from .methods_1 import *  # noqa: F401,F403
from .methods_2 import *  # noqa: F401,F403
from .methods_3 import *  # noqa: F401,F403
from .methods_4 import *  # noqa: F401,F403
from .methods_5 import *  # noqa: F401,F403
from .methods_6 import *  # noqa: F401,F403
from .methods_7 import *  # noqa: F401,F403
from .methods_8 import *  # noqa: F401,F403
from .methods_9 import *  # noqa: F401,F403
from .methods_10 import *  # noqa: F401,F403
from .methods_11 import *  # noqa: F401,F403
from .methods_12 import *  # noqa: F401,F403
from .methods_13 import *  # noqa: F401,F403
from .methods_14 import *  # noqa: F401,F403
from .methods_15 import *  # noqa: F401,F403

class ModelEngine(ModelEnginePart1, ModelEnginePart2, ModelEnginePart3, ModelEnginePart4, ModelEnginePart5, ModelEnginePart6, ModelEnginePart7, ModelEnginePart8, ModelEnginePart9, ModelEnginePart10, ModelEnginePart11, ModelEnginePart12, ModelEnginePart13, ModelEnginePart14, ModelEnginePart15, ModelEngineBase):
    pass

# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys
_pkg = _sys.modules[__name__]
_modules = [_sys.modules[__name__ + "." + 'model_cache'], _sys.modules[__name__ + "." + 'core'], _sys.modules[__name__ + "." + 'methods_1'], _sys.modules[__name__ + "." + 'methods_2'], _sys.modules[__name__ + "." + 'methods_3'], _sys.modules[__name__ + "." + 'methods_4'], _sys.modules[__name__ + "." + 'methods_5'], _sys.modules[__name__ + "." + 'methods_6'], _sys.modules[__name__ + "." + 'methods_7'], _sys.modules[__name__ + "." + 'methods_8'], _sys.modules[__name__ + "." + 'methods_9'], _sys.modules[__name__ + "." + 'methods_10'], _sys.modules[__name__ + "." + 'methods_11'], _sys.modules[__name__ + "." + 'methods_12'], _sys.modules[__name__ + "." + 'methods_13'], _sys.modules[__name__ + "." + 'methods_14'], _sys.modules[__name__ + "." + 'methods_15']]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(_pkg.__dict__.items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)
