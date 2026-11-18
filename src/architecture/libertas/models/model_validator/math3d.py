"""模型验证职责：math3d。"""

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
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple


class Math3D:
    """3D数学工具"""

    @staticmethod
    def vec3_length(v: Tuple[float, float, float]) -> float:
        return math.sqrt(v[0]**2 + v[1]**2 + v[2]**2)

    @staticmethod
    def vec3_normalize(v: Tuple[float, float, float]) -> Tuple[float, float, float]:
        l = Math3D.vec3_length(v)
        if l < 1e-8:
            return (0.0, 0.0, 0.0)
        return (v[0]/l, v[1]/l, v[2]/l)

    @staticmethod
    def vec3_dot(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> float:
        return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]

    @staticmethod
    def vec3_cross(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> Tuple[float, float, float]:
        return (
            a[1]*b[2] - a[2]*b[1],
            a[2]*b[0] - a[0]*b[2],
            a[0]*b[1] - a[1]*b[0],
        )

    @staticmethod
    def mat4_identity() -> List[List[float]]:
        return [[1 if i == j else 0 for j in range(4)] for i in range(4)]

    @staticmethod
    def mat4_multiply(a: List[List[float]], b: List[List[float]]) -> List[List[float]]:
        result = Math3D.mat4_identity()
        for i in range(4):
            for j in range(4):
                result[i][j] = sum(a[i][k] * b[k][j] for k in range(4))
        return result

    @staticmethod
    def mat4_translate(x: float, y: float, z: float) -> List[List[float]]:
        m = Math3D.mat4_identity()
        m[0][3] = x
        m[1][3] = y
        m[2][3] = z
        return m

    @staticmethod
    def mat4_rotate_y(angle: float) -> List[List[float]]:
        c, s = math.cos(angle), math.sin(angle)
        return [
            [c, 0, s, 0],
            [0, 1, 0, 0],
            [-s, 0, c, 0],
            [0, 0, 0, 1],
        ]

    @staticmethod
    def is_identity_matrix(m: List[List[float]], tolerance: float = 1e-6) -> bool:
        identity = Math3D.mat4_identity()
        for i in range(4):
            for j in range(4):
                if abs(m[i][j] - identity[i][j]) > tolerance:
                    return False
        return True

    @staticmethod
    def is_orthogonal_matrix(m: List[List[float]], tolerance: float = 1e-4) -> bool:
        """检查3x3旋转矩阵是否正交"""
        for i in range(3):
            row = (m[i][0], m[i][1], m[i][2])
            if abs(Math3D.vec3_length(row) - 1.0) > tolerance:
                return False
        for i in range(3):
            for j in range(i+1, 3):
                row_i = (m[i][0], m[i][1], m[i][2])
                row_j = (m[j][0], m[j][1], m[j][2])
                if abs(Math3D.vec3_dot(row_i, row_j)) > tolerance:
                    return False
        return True

    @staticmethod
    def quaternion_normalize(q: Tuple[float, float, float, float]) -> Tuple[float, float, float, float]:
        l = math.sqrt(sum(x*x for x in q))
        if l < 1e-8:
            return (1.0, 0.0, 0.0, 0.0)
        return tuple(x/l for x in q)

    @staticmethod
    def quaternion_is_valid(q: Tuple[float, float, float, float], tolerance: float = 1e-4) -> bool:
        l = math.sqrt(sum(x*x for x in q))
        return abs(l - 1.0) <= tolerance
