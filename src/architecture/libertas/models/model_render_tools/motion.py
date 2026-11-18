"""模型渲染工具职责：motion。"""

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
from typing import Any, Dict, List, Optional, Tuple

from .models import MotionParamIssue

class MotionParamValidator:
    """程序化动作参数验证器

    验证MMD/VRM模型的程序化动作参数是否正确：
    - 关节角度限制（人体工学范围）
    - 重心轨迹合理性
    - 手脚协调性
    - 循环动作首尾帧匹配
    - 物理参数（质量/弹性/摩擦）
    - IK参数（迭代次数/限制角度）
    - 关键帧时间间隔
    """

    # 人体关节角度限制（度）
    JOINT_LIMITS = {
        "shoulder": {"flexion": (-30, 180), "abduction": (-10, 180), "rotation": (-90, 90)},
        "elbow": {"flexion": (0, 150), "rotation": (-90, 90)},
        "wrist": {"flexion": (-90, 90), "abduction": (-45, 45)},
        "hip": {"flexion": (-30, 120), "abduction": (-30, 60), "rotation": (-45, 45)},
        "knee": {"flexion": (0, 150)},
        "ankle": {"flexion": (-45, 45), "abduction": (-20, 20)},
        "neck": {"flexion": (-45, 45), "rotation": (-60, 60)},
        "spine": {"flexion": (-30, 30), "rotation": (-30, 30)},
    }

    def __init__(self):
        self.issues: List[MotionParamIssue] = []

    def validate(self, motion_data: Dict, model_data: Dict = None) -> List[MotionParamIssue]:
        """验证程序化动作参数

        Args:
            motion_data: 动作数据（bone_frames, morph_frames, camera_frames等）
            model_data: 模型数据（bones, ik_chains, rigid_bodies, joints等）
        """
        self.issues = []

        bone_frames = motion_data.get("bone_frames", {})
        if not bone_frames:
            self.issues.append(MotionParamIssue(
                category="motion", severity="critical",
                title="动作数据无骨骼关键帧",
                description="动作数据不包含任何骨骼关键帧",
            ))
            return self.issues

        # 1. 关节角度限制验证
        self._validate_joint_angles(bone_frames)

        # 2. 关键帧时间间隔验证
        self._validate_frame_intervals(bone_frames)

        # 3. 重心轨迹验证
        self._validate_center_of_mass(bone_frames, model_data)

        # 4. 手脚协调性验证
        self._validate_limb_coordination(bone_frames)

        # 5. 循环动作首尾帧匹配
        self._validate_loop_matching(bone_frames, motion_data)

        # 6. 物理参数验证
        if model_data:
            self._validate_physics_params(model_data)

        # 7. IK参数验证
        if model_data:
            self._validate_ik_params(model_data)

        # 8. 形态键参数验证
        self._validate_morph_params(motion_data)

        return self.issues

    def _validate_joint_angles(self, bone_frames: Dict):
        """验证关节角度是否在人体工学范围内"""
        for bone_name, frames in bone_frames.items():
            joint_type = self._detect_joint_type(bone_name)
            if not joint_type:
                continue

            limits = self.JOINT_LIMITS.get(joint_type, {})
            for frame in frames:
                rotation = frame.get("rotation", (0, 0, 0, 1))
                angles = self._quaternion_to_euler(rotation)

                for axis, angle in enumerate(angles):
                    axis_name = ["x", "y", "z"][axis]
                    angle_deg = math.degrees(angle)

                    # 检查是否超出限制
                    for motion_type, (min_angle, max_angle) in limits.items():
                        if abs(angle_deg) > max(max_angle, abs(min_angle)) + 10:
                            self.issues.append(MotionParamIssue(
                                category="joint_angle", severity="high",
                                title=f"{bone_name}关节角度超出人体工学范围",
                                description=f"{bone_name}的{axis_name}轴旋转{angle_deg:.1f}度，超出{motion_type}范围({min_angle}~{max_angle}度)",
                                parameter=f"{bone_name}.rotation.{axis_name}",
                                expected=f"{min_angle}~{max_angle}度",
                                actual=f"{angle_deg:.1f}度",
                                frame=frame.get("frame", 0),
                                bone=bone_name,
                                fix_suggestion=f"将{bone_name}的{axis_name}轴旋转限制在{min_angle}~{max_angle}度范围内",
                            ))
                            break

    def _validate_frame_intervals(self, bone_frames: Dict):
        """验证关键帧时间间隔合理性"""
        for bone_name, frames in bone_frames.items():
            if len(frames) < 2:
                continue

            for i in range(1, len(frames)):
                interval = frames[i]["frame"] - frames[i-1]["frame"]

                if interval == 0:
                    self.issues.append(MotionParamIssue(
                        category="frame_interval", severity="medium",
                        title=f"{bone_name}存在重复帧号",
                        description=f"{bone_name}在第{frames[i]['frame']}帧有重复关键帧",
                        parameter=f"{bone_name}.frame",
                        expected="唯一帧号",
                        actual=str(frames[i]["frame"]),
                        frame=frames[i]["frame"],
                        bone=bone_name,
                    ))
                elif interval < 1:
                    self.issues.append(MotionParamIssue(
                        category="frame_interval", severity="low",
                        title=f"{bone_name}关键帧间隔过小",
                        description=f"{bone_name}第{frames[i-1]['frame']}到{frames[i]['frame']}帧间隔{interval}帧",
                        parameter=f"{bone_name}.frame_interval",
                        expected=">=1帧",
                        actual=f"{interval}帧",
                        frame=frames[i]["frame"],
                        bone=bone_name,
                    ))

    def _validate_center_of_mass(self, bone_frames: Dict, model_data: Dict):
        """验证重心轨迹合理性"""
        # 简化：检查hips骨骼的垂直位移
        hips_frames = None
        for name in bone_frames:
            if 'hip' in name.lower() or '腰' in name or '下半身' in name:
                hips_frames = bone_frames[name]
                break

        if not hips_frames or len(hips_frames) < 2:
            return

        # 检查重心垂直位移是否过大
        positions = [f.get("position", (0, 0, 0)) for f in hips_frames]
        y_positions = [p[1] for p in positions]
        y_range = max(y_positions) - min(y_positions)

        if y_range > 2.0:  # 超过2米
            self.issues.append(MotionParamIssue(
                category="center_of_mass", severity="medium",
                title="重心垂直位移过大",
                description=f"重心垂直位移{y_range:.2f}米，可能导致动作不自然或穿模",
                parameter="hips.position.y",
                expected="<=2.0米",
                actual=f"{y_range:.2f}米",
                fix_suggestion="减小重心垂直位移，确保动作在合理范围内",
            ))

        # 检查重心水平位移
        x_positions = [p[0] for p in positions]
        z_positions = [p[2] for p in positions]
        x_range = max(x_positions) - min(x_positions)
        z_range = max(z_positions) - min(z_positions)

        if x_range > 10 or z_range > 10:
            self.issues.append(MotionParamIssue(
                category="center_of_mass", severity="low",
                title="重心水平位移过大",
                description=f"重心水平位移X:{x_range:.1f}米, Z:{z_range:.1f}米，动作范围可能过大",
                parameter="hips.position.xz",
                expected="<=10米",
                actual=f"X:{x_range:.1f}, Z:{z_range:.1f}",
            ))

    def _validate_limb_coordination(self, bone_frames: Dict):
        """验证手脚协调性（行走时手脚交替）"""
        left_arm = None
        right_arm = None
        left_leg = None
        right_leg = None

        for name in bone_frames:
            lower = name.lower()
            if 'left' in lower and ('arm' in lower or '腕' in name or '手' in name):
                left_arm = bone_frames[name]
            elif 'right' in lower and ('arm' in lower or '腕' in name or '手' in name):
                right_arm = bone_frames[name]
            elif 'left' in lower and ('leg' in lower or '足' in name or '脚' in name):
                left_leg = bone_frames[name]
            elif 'right' in lower and ('leg' in lower or '足' in name or '脚' in name):
                right_leg = bone_frames[name]

        # 检查左右手脚是否都有关键帧
        missing = []
        if not left_arm:
            missing.append("左手臂")
        if not right_arm:
            missing.append("右手臂")
        if not left_leg:
            missing.append("左腿")
        if not right_leg:
            missing.append("右腿")

        if missing and len(missing) < 4:
            self.issues.append(MotionParamIssue(
                category="limb_coordination", severity="medium",
                title="部分肢体缺少关键帧",
                description=f"以下肢体缺少动作关键帧: {', '.join(missing)}，可能导致这些肢体无法活动",
                parameter="bone_frames",
                expected="四肢都有关键帧",
                actual=f"缺少: {', '.join(missing)}",
                fix_suggestion="为缺少关键帧的肢体添加动作数据，或设置初始姿势关键帧",
            ))

    def _validate_loop_matching(self, bone_frames: Dict, motion_data: Dict):
        """验证循环动作首尾帧是否匹配"""
        total_frames = motion_data.get("frame_count", 0)
        if total_frames == 0:
            return

        # 检查是否有第0帧和最后一帧
        for bone_name, frames in bone_frames.items():
            if not frames:
                continue

            first_frame = frames[0]["frame"]
            last_frame = frames[-1]["frame"]

            if first_frame != 0:
                self.issues.append(MotionParamIssue(
                    category="loop_matching", severity="low",
                    title=f"{bone_name}首帧不在第0帧",
                    description=f"{bone_name}的第一个关键帧在第{first_frame}帧，循环动作可能不连贯",
                    parameter=f"{bone_name}.first_frame",
                    expected="0",
                    actual=str(first_frame),
                    bone=bone_name,
                ))

            # 检查首尾帧姿势是否相近（用于循环动作）
            if first_frame == 0 and last_frame == total_frames - 1:
                first_rot = frames[0].get("rotation", (0, 0, 0, 1))
                last_rot = frames[-1].get("rotation", (0, 0, 0, 1))
                rot_diff = self._quaternion_distance(first_rot, last_rot)
                if rot_diff > 0.5:
                    self.issues.append(MotionParamIssue(
                        category="loop_matching", severity="medium",
                        title=f"{bone_name}循环动作首尾帧不匹配",
                        description=f"{bone_name}首尾帧旋转差异{rot_diff:.2f}，循环播放时会有跳变",
                        parameter=f"{bone_name}.rotation",
                        expected="首尾帧旋转相近(<0.5)",
                        actual=f"{rot_diff:.2f}",
                        bone=bone_name,
                        fix_suggestion="调整最后一帧姿势使其与第一帧相近，或添加过渡帧",
                    ))

    def _validate_physics_params(self, model_data: Dict):
        """验证物理参数（刚体/关节）"""
        rigid_bodies = model_data.get("rigid_bodies", [])
        joints = model_data.get("joints", [])

        for i, rb in enumerate(rigid_bodies):
            name = rb.get("name", f"rigid_body_{i}")
            mass = rb.get("mass", 1.0)

            if mass <= 0:
                self.issues.append(MotionParamIssue(
                    category="physics", severity="high",
                    title=f"刚体'{name}'质量为0或负数",
                    description=f"刚体质量{mass}，物理模拟会出错",
                    parameter=f"{name}.mass",
                    expected=">0",
                    actual=str(mass),
                    fix_suggestion="设置合理的质量（通常0.1~10kg）",
                ))
            elif mass > 100:
                self.issues.append(MotionParamIssue(
                    category="physics", severity="medium",
                    title=f"刚体'{name}'质量过大",
                    description=f"刚体质量{mass}kg，可能导致物理模拟不稳定",
                    parameter=f"{name}.mass",
                    expected="<=100kg",
                    actual=f"{mass}kg",
                ))

            # 检查弹性和摩擦
            repulsion = rb.get("repulsion", 0.0)
            friction = rb.get("friction", 0.0)
            if repulsion > 1.0:
                self.issues.append(MotionParamIssue(
                    category="physics", severity="low",
                    title=f"刚体'{name}'弹性系数过大",
                    description=f"弹性系数{repulsion}，物理模拟可能不稳定",
                    parameter=f"{name}.repulsion",
                    expected="0~1.0",
                    actual=str(repulsion),
                ))

        for i, joint in enumerate(joints):
            name = joint.get("name", f"joint_{i}")
            lower = joint.get("lower_limit", (0, 0, 0))
            upper = joint.get("upper_limit", (0, 0, 0))

            for axis in range(3):
                if lower[axis] > upper[axis]:
                    axis_name = ["x", "y", "z"][axis]
                    self.issues.append(MotionParamIssue(
                        category="physics", severity="high",
                        title=f"关节'{name}'{axis_name}轴限制范围错误",
                        description=f"下限{lower[axis]}大于上限{upper[axis]}",
                        parameter=f"{name}.limit.{axis_name}",
                        expected="下限<=上限",
                        actual=f"下限{lower[axis]}, 上限{upper[axis]}",
                    ))

    def _validate_ik_params(self, model_data: Dict):
        """验证IK参数"""
        ik_chains = model_data.get("ik_chains", [])

        for i, ik in enumerate(ik_chains):
            target = ik.get("target_bone", f"ik_{i}")
            iterations = ik.get("iterations", 20)
            limit_angle = ik.get("limit_angle", 0.0)
            chain_bones = ik.get("chain_bones", [])

            if iterations < 1:
                self.issues.append(MotionParamIssue(
                    category="ik", severity="high",
                    title=f"IK链'{target}'迭代次数过少",
                    description=f"迭代次数{iterations}，IK求解可能不收敛",
                    parameter=f"{target}.iterations",
                    expected=">=10",
                    actual=str(iterations),
                    fix_suggestion="设置迭代次数>=10（通常20~50）",
                ))
            elif iterations > 1000:
                self.issues.append(MotionParamIssue(
                    category="ik", severity="low",
                    title=f"IK链'{target}'迭代次数过多",
                    description=f"迭代次数{iterations}，影响性能",
                    parameter=f"{target}.iterations",
                    expected="<=1000",
                    actual=str(iterations),
                ))

            if limit_angle <= 0:
                self.issues.append(MotionParamIssue(
                    category="ik", severity="medium",
                    title=f"IK链'{target}'限制角度为0",
                    description=f"限制角度{limit_angle}，IK链骨骼无法旋转",
                    parameter=f"{target}.limit_angle",
                    expected=">0（通常0.01~0.1弧度）",
                    actual=str(limit_angle),
                ))

            if not chain_bones:
                self.issues.append(MotionParamIssue(
                    category="ik", severity="critical",
                    title=f"IK链'{target}'无链骨骼",
                    description=f"IK链没有链骨骼，IK无法求解",
                    parameter=f"{target}.chain_bones",
                    expected="至少1个链骨骼",
                    actual="0个",
                ))

    def _validate_morph_params(self, motion_data: Dict):
        """验证形态键参数"""
        morph_frames = motion_data.get("morph_frames", {})
        for morph_name, frames in morph_frames.items():
            for frame in frames:
                weight = frame.get("weight", 0.0)
                if weight < 0 or weight > 1.0:
                    self.issues.append(MotionParamIssue(
                        category="morph", severity="medium",
                        title=f"形态键'{morph_name}'权重超出范围",
                        description=f"第{frame.get('frame', 0)}帧权重{weight}，应在0~1之间",
                        parameter=f"{morph_name}.weight",
                        expected="0~1.0",
                        actual=str(weight),
                        frame=frame.get("frame", 0),
                        fix_suggestion="将形态键权重限制在0~1范围内",
                    ))

    def _detect_joint_type(self, bone_name: str) -> Optional[str]:
        """从骨骼名称检测关节类型"""
        lower = bone_name.lower()
        if any(k in lower for k in ['shoulder', '肩']):
            return "shoulder"
        elif any(k in lower for k in ['elbow', '肘', 'ひじ']):
            return "elbow"
        elif any(k in lower for k in ['wrist', '腕', '手首']):
            return "wrist"
        elif any(k in lower for k in ['hip', '腰', '股']):
            return "hip"
        elif any(k in lower for k in ['knee', '膝', 'ひざ']):
            return "knee"
        elif any(k in lower for k in ['ankle', '踝', '足首']):
            return "ankle"
        elif any(k in lower for k in ['neck', '首']):
            return "neck"
        elif any(k in lower for k in ['spine', '背', '上半身', '下半身']):
            return "spine"
        return None

    def _quaternion_to_euler(self, q: Tuple[float, float, float, float]) -> Tuple[float, float, float]:
        """四元数转欧拉角（弧度）"""
        x, y, z, w = q

        # Roll (x-axis rotation)
        sinr_cosp = 2 * (w * x + y * z)
        cosr_cosp = 1 - 2 * (x * x + y * y)
        roll = math.atan2(sinr_cosp, cosr_cosp)

        # Pitch (y-axis rotation)
        sinp = 2 * (w * y - z * x)
        if abs(sinp) >= 1:
            pitch = math.copysign(math.pi / 2, sinp)
        else:
            pitch = math.asin(sinp)

        # Yaw (z-axis rotation)
        siny_cosp = 2 * (w * z + x * y)
        cosy_cosp = 1 - 2 * (y * y + z * z)
        yaw = math.atan2(siny_cosp, cosy_cosp)

        return (roll, pitch, yaw)

    def _quaternion_distance(self, q1: Tuple, q2: Tuple) -> float:
        """计算两个四元数的距离（0~1）"""
        dot = abs(sum(a * b for a, b in zip(q1, q2)))
        return 1.0 - min(1.0, dot)

    def generate_report(self, issues: List[MotionParamIssue] = None) -> str:
        """生成验证报告"""
        issues = issues or self.issues
        lines = ["# 程序化动作参数验证报告", ""]
        lines.append(f"**问题总数**: {len(issues)}")
        by_severity = defaultdict(int)
        by_category = defaultdict(int)
        for issue in issues:
            by_severity[issue.severity] += 1
            by_category[issue.category] += 1
        lines.append(f"**严重**: {by_severity.get('critical', 0)}, "
                      f"高危: {by_severity.get('high', 0)}, "
                      f"中危: {by_severity.get('medium', 0)}, "
                      f"低危: {by_severity.get('low', 0)}")
        lines.append("")
        lines.append("## 按类别")
        lines.append("")
        for cat, count in sorted(by_category.items()):
            lines.append(f"- **{cat}**: {count}")
        lines.append("")
        lines.append("## 问题详情")
        lines.append("")
        for i, issue in enumerate(issues[:100], 1):
            lines.append(f"### {i}. [{issue.severity.upper()}] {issue.title}")
            lines.append("")
            lines.append(f"- **类别**: {issue.category}")
            lines.append(f"- **骨骼/参数**: {issue.bone or issue.parameter}")
            if issue.frame:
                lines.append(f"- **帧**: {issue.frame}")
            lines.append(f"- **描述**: {issue.description}")
            if issue.expected:
                lines.append(f"- **期望**: {issue.expected}")
            if issue.actual:
                lines.append(f"- **实际**: {issue.actual}")
            if issue.fix_suggestion:
                lines.append(f"- **修复建议**: {issue.fix_suggestion}")
            lines.append("")
        return "\n".join(lines)
