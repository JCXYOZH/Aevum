"""能力增强职责：core。"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
import time
import uuid
from collections import OrderedDict, defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from libertas.foundation.byte_stream import safe_decode

from .brain import BrainEnhancer
from .code import CodeEnhancer
from .memory import MemoryEnhancer
from .tool import ToolEnhancer

class CapabilityEnhancer:
    """四大能力统一增强入口"""

    def __init__(self):
        self.memory = MemoryEnhancer()
        self.tool = ToolEnhancer()
        self.code = CodeEnhancer()
        self.brain = BrainEnhancer()

    def enhance_all(self) -> Dict:
        """执行所有增强"""
        return {
            "memory": self.memory.get_statistics(),
            "tool": self.tool.get_statistics(),
            "code": {"quality_scores": len(self.code.quality_scores)},
            "brain": self.brain.get_statistics(),
        }

    def get_status(self) -> Dict:
        """获取增强状态"""
        return {
            "memory_enhanced": len(self.memory.memories) > 0,
            "tool_enhanced": len(self.tool.tools) > 0,
            "code_enhanced": len(self.code.quality_scores) > 0,
            "brain_enhanced": len(self.brain.conversation_state) > 0,
            "statistics": self.enhance_all(),
        }
