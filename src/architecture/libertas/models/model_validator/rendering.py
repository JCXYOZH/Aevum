"""模型验证职责：rendering。"""

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

class RenderingValidator:
    """渲染问题检测

    通过前端上报的计算结果，检测渲染异常。
    前端计算库（自研渲染引擎）的计算错误是渲染问题的主要原因。
    """

    def __init__(self):
        self.issues: List[ValidationIssue] = []

    def validate_render_result(self, render_data: Dict) -> List[ValidationIssue]:
        """验证前端上报的渲染计算结果

        Args:
            render_data: 前端上报的渲染数据，包含
                - vertices: 变换后的顶点位置
                - normals: 变换后的法线
                - bone_matrices: 骨骼变换矩阵
                - draw_calls: 绘制调用
                - errors: 前端报告的错误
        """
        self.issues = []

        # 检查前端报告的错误
        errors = render_data.get("errors", [])
        for err in errors:
            self.issues.append(ValidationIssue(
                category="rendering", severity="high",
                title="前端渲染错误",
                description=err.get("message", str(err)),
                location=err.get("location", "renderer"),
            ))

        # 验证顶点
        vertices = render_data.get("vertices", [])
        if vertices:
            self._validate_vertices(vertices)

        # 验证法线
        normals = render_data.get("normals", [])
        if normals:
            self._validate_normals(normals)

        # 验证骨骼矩阵
        bone_matrices = render_data.get("bone_matrices", [])
        if bone_matrices:
            self._validate_bone_matrices(bone_matrices)

        # 验证蒙皮变形
        if vertices and render_data.get("original_vertices"):
            self._validate_skin_deformation(
                render_data.get("original_vertices", []),
                vertices,
                render_data.get("bone_matrices", []),
            )

        return self.issues

    def _validate_vertices(self, vertices: List[Tuple[float, float, float]]):
        """验证变换后的顶点"""
        nan_count = 0
        inf_count = 0
        outlier_count = 0
        for i, v in enumerate(vertices):
            if not isinstance(v, (list, tuple)) or len(v) != 3:
                continue
            for j, val in enumerate(v):
                if math.isnan(val):
                    nan_count += 1
                    if nan_count <= 5:
                        self.issues.append(ValidationIssue(
                            category="calculation", severity="critical",
                            title="顶点位置包含NaN",
                            description=f"顶点{i}的{['x','y','z'][j]}分量为NaN，渲染引擎计算错误",
                            location=f"vertex[{i}]",
                        ))
                elif math.isinf(val):
                    inf_count += 1
                    if inf_count <= 5:
                        self.issues.append(ValidationIssue(
                            category="calculation", severity="critical",
                            title="顶点位置包含Inf",
                            description=f"顶点{i}的{['x','y','z'][j]}分量为Inf，渲染引擎计算溢出",
                            location=f"vertex[{i}]",
                        ))

        if nan_count > 5:
            self.issues.append(ValidationIssue(
                category="calculation", severity="critical",
                title="大量顶点包含NaN",
                description=f"共有{nan_count}个顶点分量为NaN，渲染引擎的骨骼蒙皮或矩阵计算有严重错误",
                expected="0",
                actual=str(nan_count),
            ))

    def _validate_normals(self, normals: List[Tuple[float, float, float]]):
        """验证变换后的法线"""
        unnormalized = 0
        for i, n in enumerate(normals):
            if not isinstance(n, (list, tuple)) or len(n) != 3:
                continue
            length = Math3D.vec3_length(n)
            if length > 0 and abs(length - 1.0) > 0.1:
                unnormalized += 1
                if unnormalized <= 3:
                    self.issues.append(ValidationIssue(
                        category="calculation", severity="medium",
                        title="法线未归一化",
                        description=f"法线{i}的长度为{length:.4f}，应为1.0，光照计算会出错",
                        location=f"normal[{i}]",
                        expected="1.0",
                        actual=f"{length:.4f}",
                        auto_fixable=True,
                        fix_suggestion="对法线进行归一化",
                    ))

    def _validate_bone_matrices(self, matrices: List[List[List[float]]]):
        """验证骨骼变换矩阵"""
        for i, m in enumerate(matrices):
            if not isinstance(m, (list, tuple)) or len(m) != 4:
                continue
            # 检查NaN/Inf
            has_nan = any(math.isnan(v) or math.isinf(v) for row in m for v in row)
            if has_nan:
                self.issues.append(ValidationIssue(
                    category="calculation", severity="critical",
                    title=f"骨骼矩阵{i}包含NaN/Inf",
                    description=f"骨骼{i}的变换矩阵包含NaN或Inf，矩阵乘法或四元数转换有错误",
                    location=f"bone_matrix[{i}]",
                ))
                continue

            # 检查旋转部分是否正交
            if not Math3D.is_orthogonal_matrix(m, tolerance=0.05):
                self.issues.append(ValidationIssue(
                    category="calculation", severity="high",
                    title=f"骨骼矩阵{i}旋转部分不正交",
                    description=f"骨骼{i}的变换矩阵旋转部分不是正交矩阵，骨骼旋转计算有错误",
                    location=f"bone_matrix[{i}]",
                    expected="正交矩阵",
                ))

    def _validate_skin_deformation(self, original: List, deformed: List, matrices: List):
        """验证蒙皮变形的合理性"""
        if len(original) != len(deformed):
            self.issues.append(ValidationIssue(
                category="calculation", severity="high",
                title="蒙皮变形前后顶点数不一致",
                description=f"原始顶点{len(original)}个，变形后{len(deformed)}个，蒙皮计算有错误",
                expected=f"{len(original)}",
                actual=f"{len(deformed)}",
            ))
            return

        # 检查变形距离异常
        max_deform = 0
        for i in range(min(len(original), len(deformed))):
            o = original[i]
            d = deformed[i]
            if isinstance(o, (list, tuple)) and isinstance(d, (list, tuple)) and len(o) == 3 and len(d) == 3:
                dist = Math3D.vec3_length((d[0]-o[0], d[1]-o[1], d[2]-o[2]))
                max_deform = max(max_deform, dist)
                if dist > 100:
                    self.issues.append(ValidationIssue(
                        category="calculation", severity="high",
                        title="顶点蒙皮变形距离过大",
                        description=f"顶点{i}变形距离{dist:.1f}单位，蒙皮权重或骨骼矩阵计算有错误",
                        location=f"vertex[{i}]",
                        expected="<100",
                        actual=f"{dist:.1f}",
                    ))
