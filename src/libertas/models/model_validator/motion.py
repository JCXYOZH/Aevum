"""模型验证职责：motion。"""

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

class MotionValidator:
    """动作数据验证器

    检查VMD等动作数据的关键帧、骨骼映射、时间轴、插值。
    """

    def __init__(self):
        self.issues: List[ValidationIssue] = []

    def validate(self, motion_data: Dict, model_bones: List[str]) -> List[ValidationIssue]:
        """验证动作数据

        Args:
            motion_data: 动作数据，包含 bone_frames: {bone_name: [{frame, position, rotation, interpolation}]}
            model_bones: 模型骨骼名称列表
        """
        self.issues = []

        bone_frames = motion_data.get("bone_frames", {})
        if not bone_frames:
            self.issues.append(ValidationIssue(
                category="motion", severity="critical",
                title="动作数据无骨骼关键帧",
                description="动作数据不包含任何骨骼关键帧",
            ))
            return self.issues

        # 检查骨骼映射
        unmapped_bones = []
        for bone_name in bone_frames:
            if bone_name not in model_bones:
                unmapped_bones.append(bone_name)
        if unmapped_bones:
            self.issues.append(ValidationIssue(
                category="motion", severity="high",
                title="动作数据引用不存在的骨骼",
                description=f"动作数据引用了{len(unmapped_bones)}个模型中不存在的骨骼: {', '.join(unmapped_bones[:10])}{'...' if len(unmapped_bones) > 10 else ''}",
                expected="所有骨骼在模型中存在",
                actual=f"{len(unmapped_bones)}个不存在",
            ))

        # 检查关键帧
        total_frames = 0
        for bone_name, frames in bone_frames.items():
            total_frames += len(frames)
            if not frames:
                continue

            # 检查帧号
            frame_numbers = sorted(f.get("frame", 0) for f in frames)
            if frame_numbers[0] < 0:
                self.issues.append(ValidationIssue(
                    category="motion", severity="high",
                    title="负帧号",
                    description=f"骨骼'{bone_name}'存在负帧号{frame_numbers[0]}",
                    location=bone_name,
                    expected=">=0",
                    actual=str(frame_numbers[0]),
                ))

            # 检查重复帧
            seen = set()
            duplicates = []
            for f in frames:
                fn = f.get("frame", 0)
                if fn in seen:
                    duplicates.append(fn)
                seen.add(fn)
            if duplicates:
                self.issues.append(ValidationIssue(
                    category="motion", severity="medium",
                    title="重复关键帧",
                    description=f"骨骼'{bone_name}'有{len(duplicates)}个重复帧号",
                    location=bone_name,
                ))

            # 检查旋转四元数
            for f in frames:
                rot = f.get("rotation", (0, 0, 0, 1))
                if isinstance(rot, (list, tuple)) and len(rot) == 4:
                    if not Math3D.quaternion_is_valid(rot, tolerance=0.1):
                        self.issues.append(ValidationIssue(
                            category="motion", severity="medium",
                            title="关键帧旋转四元数未归一化",
                            description=f"骨骼'{bone_name}'第{f.get('frame', 0)}帧的四元数未归一化",
                            location=f"{bone_name}@frame{f.get('frame', 0)}",
                            auto_fixable=True,
                            fix_suggestion="对四元数进行归一化",
                        ))

        # 检查动作长度
        max_frame = max(
            (f.get("frame", 0) for frames in bone_frames.values() for f in frames),
            default=0
        )
        if max_frame == 0:
            self.issues.append(ValidationIssue(
                category="motion", severity="medium",
                title="动作长度为0",
                description="动作数据所有关键帧都在第0帧，没有动画效果",
            ))

        return self.issues
