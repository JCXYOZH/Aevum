"""活的记忆系统职责：singleton。"""

from __future__ import annotations

import hashlib
import json
import math
import os
import pickle
import re
import threading
import time
import uuid
from collections import Counter, defaultdict, deque
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from libertas.foundation.terminal import terminal

from .core import LivingMemory

def get_living_memory(storage_dir: str = "data/memory",
                      **kwargs) -> LivingMemory:
    global _living_memory
    if _living_memory is None:
        _living_memory = LivingMemory(storage_dir=storage_dir, **kwargs)
    return _living_memory

def init_living_memory(storage_dir: str = "data/memory",
                       **kwargs) -> LivingMemory:
    global _living_memory
    _living_memory = LivingMemory(storage_dir=storage_dir, **kwargs)
    return _living_memory
