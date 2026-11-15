"""模型验证职责：skeleton。"""

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

class SkeletonValidator:
    """骨骼结构验证器

    检查骨骼层级、命名、约束、自由度等。
    支持MMD标准骨骼和VRM Humanoid骨骼。
    """

    # VRM Humanoid标准骨骼（必须存在的骨骼）
    VRM_REQUIRED_BONES = [
        "hips", "spine", "chest", "neck", "head",
        "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
        "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
        "leftUpperLeg", "leftLowerLeg", "leftFoot",
        "rightUpperLeg", "rightLowerLeg", "rightFoot",
    ]

    # MMD标准骨骼（中文/日文/英文别名）
    MMD_STANDARD_BONES = {
        "全ての親": "parent",
        "センター": "center",
        "上半身": "upper_body",
        "下半身": "lower_body",
        "首": "neck",
        "頭": "head",
        "左腕": "left_arm",
        "左ひじ": "left_elbow",
        "左手首": "left_wrist",
        "右腕": "right_arm",
        "右ひじ": "right_elbow",
        "右手首": "right_wrist",
        "左足": "left_leg",
        "左ひざ": "left_knee",
        "左足首": "left_ankle",
        "右足": "right_leg",
        "右ひざ": "right_knee",
        "右足首": "right_ankle",
    }

    def __init__(self):
        self.issues: List[ValidationIssue] = []

    def validate(self, bones: List[Dict], format_type: str = "auto") -> List[ValidationIssue]:
        """验证骨骼结构

        Args:
            bones: 骨骼列表，每个骨骼包含 name, parent_index, position, rotation, scale, ik等
            format_type: pmx/vrm/auto
        """
        self.issues = []

        if not bones:
            self.issues.append(ValidationIssue(
                category="skeleton", severity="critical",
                title="模型无骨骼",
                description="模型不包含任何骨骼，无法进行骨骼动画",
                location="model",
            ))
            return self.issues

        # 基础检查
        self._check_bone_count(bones)
        self._check_bone_names(bones)
        self._check_bone_hierarchy(bones)
        self._check_bone_positions(bones)
        self._check_bone_transforms(bones)
        self._check_duplicate_bones(bones)

        # 格式特定检查
        if format_type in ("vrm", "auto"):
            self._check_vrm_humanoid(bones)
        if format_type in ("pmx", "pmd", "auto"):
            self._check_mmd_standard(bones)

        # 左右对称检查
        self._check_symmetry(bones)

        return self.issues

    def _check_bone_count(self, bones: List[Dict]):
        if len(bones) < 10:
            self.issues.append(ValidationIssue(
                category="skeleton", severity="high",
                title="骨骼数量过少",
                description=f"模型仅有{len(bones)}个骨骼，可能无法支持完整的人形动画",
                expected="至少20个骨骼",
                actual=f"{len(bones)}个",
            ))
        elif len(bones) > 1000:
            self.issues.append(ValidationIssue(
                category="skeleton", severity="low",
                title="骨骼数量过多",
                description=f"模型有{len(bones)}个骨骼，可能影响性能",
                actual=f"{len(bones)}个",
            ))

    def _check_bone_names(self, bones: List[Dict]):
        for i, bone in enumerate(bones):
            name = bone.get("name", "")
            if not name:
                self.issues.append(ValidationIssue(
                    category="skeleton", severity="high",
                    title="骨骼无名称",
                    description=f"第{i}个骨骼没有名称，无法被动作数据引用",
                    location=f"bone[{i}]",
                ))
            elif len(name) > 100:
                self.issues.append(ValidationIssue(
                    category="skeleton", severity="low",
                    title="骨骼名称过长",
                    description=f"骨骼名称'{name[:30]}...'过长（{len(name)}字符）",
                    location=name,
                ))

    def _check_bone_hierarchy(self, bones: List[Dict]):
        """检查骨骼层级（父骨骼索引、循环引用、根骨骼）"""
        has_root = False
        for i, bone in enumerate(bones):
            parent = bone.get("parent_index", -1)
            if parent == -1:
                has_root = True
            elif parent >= len(bones):
                self.issues.append(ValidationIssue(
                    category="skeleton", severity="critical",
                    title="父骨骼索引越界",
                    description=f"骨骼'{bone.get('name', i)}'的父骨骼索引{parent}超出范围",
                    location=bone.get("name", f"bone[{i}]"),
                    expected=f"0-{len(bones)-1}或-1",
                    actual=str(parent),
                ))
            elif parent == i:
                self.issues.append(ValidationIssue(
                    category="skeleton", severity="critical",
                    title="骨骼自引用",
                    description=f"骨骼'{bone.get('name', i)}'的父骨骼是自己",
                    location=bone.get("name", f"bone[{i}]"),
                ))

        if not has_root:
            self.issues.append(ValidationIssue(
                category="skeleton", severity="medium",
                title="无根骨骼",
                description="模型没有父骨骼为-1的根骨骼，动画可能无法正确变换",
            ))

        # 循环引用检测
        self._detect_cycles(bones)

    def _detect_cycles(self, bones: List[Dict]):
        """检测骨骼层级循环引用"""
        visited = set()
        bone_count = len(bones)
        for start in range(bone_count):
            if start in visited:
                continue
            path = []
            current = start
            while current != -1 and current not in visited and 0 <= current < bone_count:
                if current in path:
                    cycle_bones = [bones[i].get('name', i) for i in path[path.index(current):]]
                    self.issues.append(ValidationIssue(
                        category="skeleton", severity="critical",
                        title="骨骼层级循环引用",
                        description=f"骨骼层级存在循环: {' -> '.join(cycle_bones)}",
                        location=", ".join(cycle_bones),
                    ))
                    return
                path.append(current)
                parent_idx = bones[current].get("parent_index", -1)
                # 确保 parent_index 是整数且在有效范围内
                if not isinstance(parent_idx, int):
                    try:
                        parent_idx = int(parent_idx)
                    except (ValueError, TypeError):
                        parent_idx = -1
                if parent_idx < -1 or parent_idx >= bone_count:
                    # 无效的父骨骼索引，记录问题并终止遍历
                    if parent_idx != -1:
                        bone_name = bones[current].get('name', current)
                        self.issues.append(ValidationIssue(
                            category="skeleton", severity="medium",
                            title="父骨骼索引越界",
                            description=f"骨骼'{bone_name}'的父骨骼索引{parent_idx}超出范围(0-{bone_count-1})",
                            location=bone_name,
                            expected=f"0-{bone_count-1}或-1",
                            actual=str(parent_idx),
                            auto_fixable=True,
                            fix_suggestion="将父骨骼索引设置为-1（根骨骼）或有效的骨骼索引"
                        ))
                    current = -1
                else:
                    current = parent_idx
            visited.update(path)

    def _check_bone_positions(self, bones: List[Dict]):
        """检查骨骼位置（NaN/Inf/异常距离）"""
        for i, bone in enumerate(bones):
            pos = bone.get("position", (0, 0, 0))
            if not isinstance(pos, (list, tuple)) or len(pos) != 3:
                continue
            for j, v in enumerate(pos):
                if math.isnan(v) or math.isinf(v):
                    self.issues.append(ValidationIssue(
                        category="skeleton", severity="critical",
                        title="骨骼位置包含NaN/Inf",
                        description=f"骨骼'{bone.get('name', i)}'位置的第{j}分量是{['x','y','z'][j]}={v}",
                        location=bone.get("name", f"bone[{i}]"),
                    ))

            # 检查与父骨骼的距离
            parent = bone.get("parent_index", -1)
            if parent >= 0 and parent < len(bones):
                parent_pos = bones[parent].get("position", (0, 0, 0))
                if isinstance(parent_pos, (list, tuple)) and len(parent_pos) == 3:
                    dist = Math3D.vec3_length((
                        pos[0]-parent_pos[0], pos[1]-parent_pos[1], pos[2]-parent_pos[2]
                    ))
                    if dist > 100:
                        self.issues.append(ValidationIssue(
                            category="skeleton", severity="medium",
                            title="骨骼距离父骨骼过远",
                            description=f"骨骼'{bone.get('name', i)}'距离父骨骼{dist:.1f}单位，可能导致拉伸",
                            location=bone.get("name", f"bone[{i}]"),
                            expected="<100单位",
                            actual=f"{dist:.1f}单位",
                        ))

    def _check_bone_transforms(self, bones: List[Dict]):
        """检查骨骼变换（旋转/缩放异常）"""
        for i, bone in enumerate(bones):
            # 检查四元数
            rot = bone.get("rotation", (0, 0, 0, 1))
            if isinstance(rot, (list, tuple)) and len(rot) == 4:
                if not Math3D.quaternion_is_valid(rot, tolerance=0.1):
                    l = math.sqrt(sum(x*x for x in rot))
                    self.issues.append(ValidationIssue(
                        category="skeleton", severity="high",
                        title="骨骼旋转四元数未归一化",
                        description=f"骨骼'{bone.get('name', i)}'的四元数长度为{l:.4f}，应为1.0",
                        location=bone.get("name", f"bone[{i}]"),
                        expected="1.0",
                        actual=f"{l:.4f}",
                        auto_fixable=True,
                        fix_suggestion="对四元数进行归一化处理",
                    ))

            # 检查缩放
            scale = bone.get("scale", (1, 1, 1))
            if isinstance(scale, (list, tuple)) and len(scale) == 3:
                for j, v in enumerate(scale):
                    if v <= 0:
                        self.issues.append(ValidationIssue(
                            category="skeleton", severity="high",
                            title="骨骼缩放为零或负数",
                            description=f"骨骼'{bone.get('name', i)}'的{['x','y','z'][j]}缩放为{v}，会导致模型消失或镜像",
                            location=bone.get("name", f"bone[{i}]"),
                            expected=">0",
                            actual=str(v),
                        ))
                    elif abs(v - 1.0) > 10:
                        self.issues.append(ValidationIssue(
                            category="skeleton", severity="medium",
                            title="骨骼缩放过小或过大",
                            description=f"骨骼'{bone.get('name', i)}'的{['x','y','z'][j]}缩放为{v}，可能导致变形",
                            location=bone.get("name", f"bone[{i}]"),
                        ))

    def _check_duplicate_bones(self, bones: List[Dict]):
        """检查重复骨骼名称"""
        name_count = defaultdict(list)
        for i, bone in enumerate(bones):
            name = bone.get("name", "")
            if name:
                name_count[name].append(i)
        for name, indices in name_count.items():
            if len(indices) > 1:
                self.issues.append(ValidationIssue(
                    category="skeleton", severity="high",
                    title="重复骨骼名称",
                    description=f"骨骼名称'{name}'出现{len(indices)}次（索引: {indices}），动作数据可能引用错误",
                    location=name,
                    expected="唯一",
                    actual=f"{len(indices)}次",
                ))

    def _check_vrm_humanoid(self, bones: List[Dict]):
        """检查VRM Humanoid标准骨骼"""
        bone_names = set(b.get("name", "") for b in bones)
        missing = []
        for required in self.VRM_REQUIRED_BONES:
            if required not in bone_names:
                missing.append(required)
        if missing:
            severity = "critical" if len(missing) > 5 else "high"
            self.issues.append(ValidationIssue(
                category="skeleton", severity=severity,
                title="缺少VRM Humanoid标准骨骼",
                description=f"缺少{len(missing)}个必需骨骼: {', '.join(missing[:10])}{'...' if len(missing) > 10 else ''}",
                expected=f"包含{len(self.VRM_REQUIRED_BONES)}个标准骨骼",
                actual=f"缺少{len(missing)}个",
            ))

    def _check_mmd_standard(self, bones: List[Dict]):
        """检查MMD标准骨骼"""
        bone_names = set(b.get("name", "") for b in bones)
        missing = []
        for jp_name, en_name in self.MMD_STANDARD_BONES.items():
            if jp_name not in bone_names and en_name not in bone_names:
                missing.append(f"{jp_name}({en_name})")
        if len(missing) > 10:
            self.issues.append(ValidationIssue(
                category="skeleton", severity="medium",
                title="缺少MMD标准骨骼",
                description=f"缺少{len(missing)}个MMD标准骨骼，部分MMD动作可能无法播放",
                actual=f"缺少{len(missing)}个",
            ))

    def _check_symmetry(self, bones: List[Dict]):
        """检查左右对称性（手脚无法行动的常见原因）"""
        left_bones = [b for b in bones if 'left' in b.get('name', '').lower() or '左' in b.get('name', '')]
        right_bones = [b for b in bones if 'right' in b.get('name', '').lower() or '右' in b.get('name', '')]

        if left_bones and not right_bones:
            self.issues.append(ValidationIssue(
                category="skeleton", severity="high",
                title="缺少右侧骨骼",
                description=f"有{len(left_bones)}个左侧骨骼但没有右侧骨骼，右侧手脚无法活动",
                expected="左右对称",
                actual=f"左:{len(left_bones)}, 右:0",
            ))
        elif right_bones and not left_bones:
            self.issues.append(ValidationIssue(
                category="skeleton", severity="high",
                title="缺少左侧骨骼",
                description=f"有{len(right_bones)}个右侧骨骼但没有左侧骨骼，左侧手脚无法活动",
                expected="左右对称",
                actual=f"左:0, 右:{len(right_bones)}",
            ))

class SkinWeightValidator:
    """蒙皮权重验证器

    检查顶点蒙皮权重的正确性，这是模型变形异常的主要原因。
    """

    def __init__(self):
        self.issues: List[ValidationIssue] = []

    def validate(self, vertices: List[Dict], bone_count: int) -> List[ValidationIssue]:
        """验证蒙皮权重

        Args:
            vertices: 顶点列表，每个顶点包含 weights: [(bone_index, weight), ...]
            bone_count: 骨骼总数
        """
        self.issues = []

        if not vertices:
            self.issues.append(ValidationIssue(
                category="skin_weight", severity="critical",
                title="模型无顶点",
                description="模型不包含任何顶点",
            ))
            return self.issues

        weighted_count = 0
        for i, vertex in enumerate(vertices):
            weights = vertex.get("weights", [])
            if not weights:
                continue
            weighted_count += 1

            # 检查权重和
            weight_sum = sum(w[1] for w in weights)
            if abs(weight_sum - 1.0) > 0.01 and weight_sum > 0:
                self.issues.append(ValidationIssue(
                    category="skin_weight", severity="high",
                    title="顶点蒙皮权重和不为1",
                    description=f"顶点{i}的权重和为{weight_sum:.4f}，会导致变形异常",
                    location=f"vertex[{i}]",
                    expected="1.0",
                    actual=f"{weight_sum:.4f}",
                    auto_fixable=True,
                    fix_suggestion="对权重进行归一化（每个权重除以权重和）",
                ))

            # 检查影响骨骼数
            if len(weights) > 4:
                self.issues.append(ValidationIssue(
                    category="skin_weight", severity="medium",
                    title="顶点受过多骨骼影响",
                    description=f"顶点{i}受{len(weights)}个骨骼影响，大多数渲染器只支持4骨骼蒙皮",
                    location=f"vertex[{i}]",
                    expected="<=4",
                    actual=str(len(weights)),
                    auto_fixable=True,
                    fix_suggestion="只保留权重最大的4个骨骼并重新归一化",
                ))

            # 检查骨骼索引
            for bone_idx, weight in weights:
                if bone_idx < 0 or bone_idx >= bone_count:
                    self.issues.append(ValidationIssue(
                        category="skin_weight", severity="critical",
                        title="蒙皮权重引用不存在的骨骼",
                        description=f"顶点{i}的权重引用骨骼索引{bone_idx}，超出范围(0-{bone_count-1})",
                        location=f"vertex[{i}]",
                        expected=f"0-{bone_count-1}",
                        actual=str(bone_idx),
                    ))

                if weight < 0:
                    self.issues.append(ValidationIssue(
                        category="skin_weight", severity="high",
                        title="负蒙皮权重",
                        description=f"顶点{i}对骨骼{bone_idx}的权重为{weight}，会导致反向变形",
                        location=f"vertex[{i}]",
                        expected=">=0",
                        actual=str(weight),
                        auto_fixable=True,
                        fix_suggestion="将负权重设为0并重新归一化",
                    ))

        # 统计无权重顶点
        no_weight = len(vertices) - weighted_count
        if no_weight > 0 and no_weight / len(vertices) > 0.1:
            self.issues.append(ValidationIssue(
                category="skin_weight", severity="medium",
                title="大量顶点无蒙皮权重",
                description=f"{no_weight}/{len(vertices)}({no_weight/len(vertices)*100:.1f}%)个顶点没有蒙皮权重，这些顶点不会随骨骼移动",
                expected="<10%",
                actual=f"{no_weight/len(vertices)*100:.1f}%",
            ))

        return self.issues
