"""代码库模块职责：singleton。"""

from __future__ import annotations

import ast
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Type, Union

from libertas.foundation.byte_stream import safe_decode
from libertas.foundation.terminal import terminal

from .core import Codebase

def get_codebase(project_root: str = "", auto_index: bool = True) -> Codebase:
    global _codebase
    if _codebase is None:
        _codebase = Codebase(project_root, auto_index)
    return _codebase

def init_codebase(project_root: str = "", auto_index: bool = True) -> Codebase:
    global _codebase
    _codebase = Codebase(project_root, auto_index)
    return _codebase
