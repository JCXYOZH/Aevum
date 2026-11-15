"""模型解析职责：reader。"""

from __future__ import annotations

import json
import math
import os
import re
import struct
import sys
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, BinaryIO, Dict, List, Optional, Tuple


class BinaryReader:
    """二进制读取工具"""

    def __init__(self, data: bytes):
        self.data = data
        self.offset = 0
        self.size = len(data)

    def read(self, size: int) -> bytes:
        if self.offset + size > self.size:
            raise EOFError(f"读取超出范围: offset={self.offset}, size={size}, total={self.size}")
        result = self.data[self.offset:self.offset + size]
        self.offset += size
        return result

    def read_byte(self) -> int:
        return struct.unpack('<B', self.read(1))[0]

    def read_short(self) -> int:
        return struct.unpack('<h', self.read(2))[0]

    def read_ushort(self) -> int:
        return struct.unpack('<H', self.read(2))[0]

    def read_int(self) -> int:
        return struct.unpack('<i', self.read(4))[0]

    def read_uint(self) -> int:
        return struct.unpack('<I', self.read(4))[0]

    def read_float(self) -> float:
        return struct.unpack('<f', self.read(4))[0]

    def read_vec2(self) -> Tuple[float, float]:
        return struct.unpack('<2f', self.read(8))

    def read_vec3(self) -> Tuple[float, float, float]:
        return struct.unpack('<3f', self.read(12))

    def read_vec4(self) -> Tuple[float, float, float, float]:
        return struct.unpack('<4f', self.read(16))

    def read_text(self, encoding: str = "utf-16-le") -> str:
        length = self.read_int()
        if length <= 0:
            return ""
        raw = self.read(length)
        try:
            return raw.decode(encoding, errors='replace')
        except Exception:
            return raw.decode('utf-8', errors='replace')

    def read_text_bytes(self, length: int, encoding: str = "shift-jis") -> str:
        raw = self.read(length)
        # 去除null终止
        null_pos = raw.find(b'\x00')
        if null_pos >= 0:
            raw = raw[:null_pos]
        try:
            return raw.decode(encoding, errors='replace')
        except Exception:
            return raw.decode('utf-8', errors='replace')

    def skip(self, size: int):
        self.offset += size

    def remaining(self) -> int:
        return self.size - self.offset

    def eof(self) -> bool:
        return self.offset >= self.size
