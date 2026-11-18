"""模型验证职责：calculation。"""

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

from .math3d import Math3D
from .models import ValidationIssue

class CalculationVerifier:
    """前端计算库结果校验器

    后端独立计算预期结果，与前端上报的结果对比，检测前端计算错误。
    这是检查自研渲染引擎计算正确性的核心方法。
    """

    def __init__(self):
        self.issues: List[ValidationIssue] = []

    def verify_bone_matrix(self, bone: Dict, reported_matrix: List[List[float]],
                             tolerance: float = 0.01) -> Dict:
        """校验前端上报的骨骼变换矩阵

        后端独立计算预期矩阵，与前端结果对比。
        """
        # 后端独立计算
        expected = self._compute_bone_matrix(bone)

        # 对比
        max_diff = 0
        for i in range(4):
            for j in range(4):
                diff = abs(expected[i][j] - reported_matrix[i][j])
                max_diff = max(max_diff, diff)

        result = {
            "bone_name": bone.get("name", ""),
            "expected": expected,
            "reported": reported_matrix,
            "max_difference": max_diff,
            "tolerance": tolerance,
            "passed": max_diff <= tolerance,
        }

        if max_diff > tolerance:
            self.issues.append(ValidationIssue(
                category="calculation", severity="high",
                title="骨骼矩阵计算错误",
                description=f"骨骼'{bone.get('name', '')}'的变换矩阵与后端计算结果差异{max_diff:.6f}，超过容差{tolerance}",
                location=bone.get("name", ""),
                expected=f"差异<={tolerance}",
                actual=f"差异={max_diff:.6f}",
            ))

        return result

    def verify_vertex_skinning(self, vertex: Dict, bone_matrices: List[List[List[float]]],
                                 reported_position: Tuple[float, float, float],
                                 tolerance: float = 0.01) -> Dict:
        """校验前端上报的蒙皮变形顶点位置

        后端独立计算预期顶点位置，与前端结果对比。
        """
        expected = self._compute_skinned_vertex(vertex, bone_matrices)

        diff = Math3D.vec3_length((
            expected[0] - reported_position[0],
            expected[1] - reported_position[1],
            expected[2] - reported_position[2],
        ))

        result = {
            "vertex_index": vertex.get("index", 0),
            "expected": expected,
            "reported": reported_position,
            "difference": diff,
            "tolerance": tolerance,
            "passed": diff <= tolerance,
        }

        if diff > tolerance:
            self.issues.append(ValidationIssue(
                category="calculation", severity="high",
                title="蒙皮变形计算错误",
                description=f"顶点{vertex.get('index', 0)}的蒙皮变形位置与后端计算结果差异{diff:.6f}",
                location=f"vertex[{vertex.get('index', 0)}]",
                expected=f"差异<={tolerance}",
                actual=f"差异={diff:.6f}",
            ))

        return result

    def verify_normal_transform(self, normal: Tuple[float, float, float],
                                  bone_matrix: List[List[float]],
                                  reported_normal: Tuple[float, float, float],
                                  tolerance: float = 0.01) -> Dict:
        """校验法线变换计算"""
        # 法线使用逆转置矩阵变换
        expected = self._compute_normal_transform(normal, bone_matrix)

        diff = Math3D.vec3_length((
            expected[0] - reported_normal[0],
            expected[1] - reported_normal[1],
            expected[2] - reported_normal[2],
        ))

        result = {
            "expected": expected,
            "reported": reported_normal,
            "difference": diff,
            "passed": diff <= tolerance,
        }

        if diff > tolerance:
            self.issues.append(ValidationIssue(
                category="calculation", severity="medium",
                title="法线变换计算错误",
                description=f"法线变换结果与后端计算差异{diff:.6f}",
                expected=f"差异<={tolerance}",
                actual=f"差异={diff:.6f}",
            ))

        return result

    def verify_ik_solution(self, ik_chain: Dict, bone_positions: Dict,
                            reported_effector_pos: Tuple[float, float, float],
                            tolerance: float = 0.1) -> Dict:
        """校验IK求解结果"""
        target_pos = ik_chain.get("target_position", (0, 0, 0))
        diff = Math3D.vec3_length((
            target_pos[0] - reported_effector_pos[0],
            target_pos[1] - reported_effector_pos[1],
            target_pos[2] - reported_effector_pos[2],
        ))

        result = {
            "target": target_pos,
            "reported_effector": reported_effector_pos,
            "distance_to_target": diff,
            "tolerance": tolerance,
            "converged": diff <= tolerance,
        }

        if diff > tolerance:
            self.issues.append(ValidationIssue(
                category="ik", severity="medium",
                title="IK求解未收敛",
                description=f"IK末端骨骼距离目标{diff:.4f}单位，超过容差{tolerance}，IK求解器可能有错误",
                expected=f"距离<={tolerance}",
                actual=f"距离={diff:.4f}",
            ))

        return result

    def _compute_bone_matrix(self, bone: Dict) -> List[List[float]]:
        """后端独立计算骨骼变换矩阵"""
        position = bone.get("position", (0, 0, 0))
        rotation = bone.get("rotation", (0, 0, 0, 1))
        scale = bone.get("scale", (1, 1, 1))

        # 平移矩阵
        trans = Math3D.mat4_translate(position[0], position[1], position[2])

        # 旋转矩阵（四元数转矩阵）
        rot = self._quaternion_to_matrix(rotation)

        # 缩放矩阵
        scl = Math3D.mat4_identity()
        scl[0][0] = scale[0]
        scl[1][1] = scale[1]
        scl[2][2] = scale[2]

        # M = T * R * S
        return Math3D.mat4_multiply(trans, Math3D.mat4_multiply(rot, scl))

    def _quaternion_to_matrix(self, q: Tuple[float, float, float, float]) -> List[List[float]]:
        """四元数转旋转矩阵"""
        x, y, z, w = q
        return [
            [1-2*(y*y+z*z), 2*(x*y-w*z), 2*(x*z+w*y), 0],
            [2*(x*y+w*z), 1-2*(x*x+z*z), 2*(y*z-w*x), 0],
            [2*(x*z-w*y), 2*(y*z+w*x), 1-2*(x*x+y*y), 0],
            [0, 0, 0, 1],
        ]

    def _compute_skinned_vertex(self, vertex: Dict,
                                  bone_matrices: List[List[List[float]]]) -> Tuple[float, float, float]:
        """后端独立计算蒙皮变形顶点"""
        original = vertex.get("original_position", (0, 0, 0))
        weights = vertex.get("weights", [])

        if not weights:
            return original

        result = [0.0, 0.0, 0.0]
        for bone_idx, weight in weights:
            if bone_idx < 0 or bone_idx >= len(bone_matrices):
                continue
            m = bone_matrices[bone_idx]
            # 顶点变换：v' = M * v
            transformed = (
                m[0][0]*original[0] + m[0][1]*original[1] + m[0][2]*original[2] + m[0][3],
                m[1][0]*original[0] + m[1][1]*original[1] + m[1][2]*original[2] + m[1][3],
                m[2][0]*original[0] + m[2][1]*original[1] + m[2][2]*original[2] + m[2][3],
            )
            result[0] += transformed[0] * weight
            result[1] += transformed[1] * weight
            result[2] += transformed[2] * weight

        return tuple(result)

    def _compute_normal_transform(self, normal: Tuple[float, float, float],
                                    bone_matrix: List[List[float]]) -> Tuple[float, float, float]:
        """计算法线变换（使用逆转置矩阵的3x3部分）"""
        # 简化：直接使用旋转部分
        transformed = (
            bone_matrix[0][0]*normal[0] + bone_matrix[0][1]*normal[1] + bone_matrix[0][2]*normal[2],
            bone_matrix[1][0]*normal[0] + bone_matrix[1][1]*normal[1] + bone_matrix[1][2]*normal[2],
            bone_matrix[2][0]*normal[0] + bone_matrix[2][1]*normal[1] + bone_matrix[2][2]*normal[2],
        )
        return Math3D.vec3_normalize(transformed)
