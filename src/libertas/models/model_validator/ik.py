"""模型验证职责：ik。"""

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

from .models import ValidationIssue

class IKValidator:
    """IK/FK计算验证器

    检查IK链结构、目标、限制、求解稳定性。
    手脚无法活动的常见原因是IK配置错误。
    """

    def __init__(self):
        self.issues: List[ValidationIssue] = []

    def validate(self, ik_chains: List[Dict], bones: List[Dict]) -> List[ValidationIssue]:
        """验证IK链

        Args:
            ik_chains: IK链列表，每个包含 target_bone, effector_bone, chain_bones, iterations, limit_angle等
            bones: 骨骼列表
        """
        self.issues = []

        if not ik_chains:
            self.issues.append(ValidationIssue(
                category="ik", severity="info",
                title="模型无IK链",
                description="模型不包含IK链，只能使用FK动画",
            ))
            return self.issues

        bone_names = [b.get("name", "") for b in bones]

        for i, chain in enumerate(ik_chains):
            target = chain.get("target_bone", "")
            effector = chain.get("effector_bone", "")
            chain_bones = chain.get("chain_bones", [])
            iterations = chain.get("iterations", 20)

            # 检查目标骨骼
            if target not in bone_names:
                self.issues.append(ValidationIssue(
                    category="ik", severity="critical",
                    title=f"IK链{i}目标骨骼不存在",
                    description=f"IK链{i}的目标骨骼'{target}'不存在，IK求解将失败",
                    location=f"ik_chain[{i}]",
                    expected="存在的骨骼名称",
                    actual=target,
                ))

            # 检查末端骨骼
            if effector not in bone_names:
                self.issues.append(ValidationIssue(
                    category="ik", severity="critical",
                    title=f"IK链{i}末端骨骼不存在",
                    description=f"IK链{i}的末端骨骼'{effector}'不存在",
                    location=f"ik_chain[{i}]",
                ))

            # 检查链骨骼
            for cb in chain_bones:
                cb_name = cb.get("bone", "") if isinstance(cb, dict) else cb
                if cb_name and cb_name not in bone_names:
                    self.issues.append(ValidationIssue(
                        category="ik", severity="high",
                        title=f"IK链{i}链骨骼不存在",
                        description=f"IK链{i}的链骨骼'{cb_name}'不存在",
                        location=f"ik_chain[{i}]",
                    ))

            # 检查迭代次数
            if iterations < 1:
                self.issues.append(ValidationIssue(
                    category="ik", severity="high",
                    title=f"IK链{i}迭代次数过少",
                    description=f"IK链{i}的迭代次数为{iterations}，IK求解可能不收敛",
                    location=f"ik_chain[{i}]",
                    expected=">=10",
                    actual=str(iterations),
                ))
            elif iterations > 1000:
                self.issues.append(ValidationIssue(
                    category="ik", severity="low",
                    title=f"IK链{i}迭代次数过多",
                    description=f"IK链{i}的迭代次数为{iterations}，可能影响性能",
                    location=f"ik_chain[{i}]",
                ))

            # 检查链长度
            if len(chain_bones) == 0:
                self.issues.append(ValidationIssue(
                    category="ik", severity="critical",
                    title=f"IK链{i}无链骨骼",
                    description=f"IK链{i}没有链骨骼，IK无法求解",
                    location=f"ik_chain[{i}]",
                ))
            elif len(chain_bones) > 10:
                self.issues.append(ValidationIssue(
                    category="ik", severity="medium",
                    title=f"IK链{i}链骨骼过多",
                    description=f"IK链{i}有{len(chain_bones)}个链骨骼，IK求解可能不稳定",
                    location=f"ik_chain[{i}]",
                ))

            # 检查旋转限制
            for cb in chain_bones:
                if isinstance(cb, dict):
                    limit = cb.get("limit_angle", (0, 0, 0))
                    if isinstance(limit, (list, tuple)) and len(limit) == 3:
                        for j, v in enumerate(limit):
                            if v < 0:
                                self.issues.append(ValidationIssue(
                                    category="ik", severity="medium",
                                    title=f"IK链{i}旋转限制为负",
                                    description=f"骨骼'{cb.get('bone', '')}'的{['x','y','z'][j]}旋转限制为{v}度",
                                    location=f"ik_chain[{i}]",
                                    expected=">=0",
                                    actual=str(v),
                                ))

        # 检查手脚IK
        self._check_limb_ik(ik_chains, bone_names)

        return self.issues

    def _check_limb_ik(self, ik_chains: List[Dict], bone_names: List[str]):
        """检查手脚IK（手脚无法活动的主要原因）"""
        has_arm_ik = False
        has_leg_ik = False
        for chain in ik_chains:
            target = chain.get("target_bone", "").lower()
            if any(k in target for k in ["hand", "wrist", "手首", "手"]):
                has_arm_ik = True
            if any(k in target for k in ["foot", "ankle", "足首", "足"]):
                has_leg_ik = True

        if not has_arm_ik:
            self.issues.append(ValidationIssue(
                category="ik", severity="medium",
                title="无手部IK",
                description="模型没有手部IK链，手部动画只能使用FK，操作不便",
                location="arms",
            ))
        if not has_leg_ik:
            self.issues.append(ValidationIssue(
                category="ik", severity="medium",
                title="无脚部IK",
                description="模型没有脚部IK链，脚部动画只能使用FK，行走动画难以控制",
                location="legs",
            ))
