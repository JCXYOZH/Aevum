"""模型验证职责：core。"""

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

from .calculation import CalculationVerifier
from .ik import IKValidator
from .motion import MotionValidator
from .rendering import RenderingValidator
from .skeleton import SkeletonValidator
from .skeleton import SkinWeightValidator
from .models import ValidationIssue
from .models import ValidationReport

class ModelValidator:
    """统一3D模型验证入口

    整合所有验证器，提供完整的模型和渲染计算验证。
    支持PMX/PMD/VRM/glTF格式。
    """

    def __init__(self):
        self.skeleton_validator = SkeletonValidator()
        self.skin_weight_validator = SkinWeightValidator()
        self.ik_validator = IKValidator()
        self.motion_validator = MotionValidator()
        self.rendering_validator = RenderingValidator()
        self.calculation_verifier = CalculationVerifier()
        self.reports: List[ValidationReport] = []

    def validate_model(self, model_data: Dict, format_type: str = "auto") -> ValidationReport:
        """验证3D模型

        Args:
            model_data: 模型数据，包含 bones, vertices, materials, ik_chains, morphs, physics等
            format_type: pmx/pmd/vrm/gltf/auto
        """
        start_time = time.time()

        report = ValidationReport(
            model_path=model_data.get("path", ""),
            model_format=format_type,
            model_name=model_data.get("name", ""),
        )

        all_issues = []
        total_checks = 0
        import traceback as _tb

        # 1. 骨骼结构验证
        bones = model_data.get("bones", [])
        if bones:
            try:
                total_checks += 1
                issues = self.skeleton_validator.validate(bones, format_type)
                all_issues.extend(issues)
                print(f"[ModelValidator] 骨骼验证完成，发现{len(issues)}个问题")
            except Exception as e:
                print(f"[ModelValidator] 骨骼验证失败: {e}")
                print(_tb.format_exc())
                all_issues.append(ValidationIssue(
                    category="skeleton", severity="high",
                    title="骨骼验证器内部错误",
                    description=f"验证过程中发生异常: {str(e)}",
                    auto_fixable=False
                ))

        # 2. 蒙皮权重验证
        vertices = model_data.get("vertices", [])
        if vertices and bones:
            try:
                total_checks += 1
                issues = self.skin_weight_validator.validate(vertices, len(bones))
                all_issues.extend(issues)
                print(f"[ModelValidator] 蒙皮权重验证完成，发现{len(issues)}个问题")
            except Exception as e:
                print(f"[ModelValidator] 蒙皮权重验证失败: {e}")
                print(_tb.format_exc())
                all_issues.append(ValidationIssue(
                    category="skin_weight", severity="high",
                    title="蒙皮权重验证器内部错误",
                    description=f"验证过程中发生异常: {str(e)}",
                    auto_fixable=False
                ))

        # 3. IK验证
        ik_chains = model_data.get("ik_chains", [])
        if ik_chains and bones:
            try:
                total_checks += 1
                issues = self.ik_validator.validate(ik_chains, bones)
                all_issues.extend(issues)
                print(f"[ModelValidator] IK验证完成，发现{len(issues)}个问题")
            except Exception as e:
                print(f"[ModelValidator] IK验证失败: {e}")
                print(_tb.format_exc())
                all_issues.append(ValidationIssue(
                    category="ik", severity="high",
                    title="IK验证器内部错误",
                    description=f"验证过程中发生异常: {str(e)}",
                    auto_fixable=False
                ))

        # 4. 材质验证
        materials = model_data.get("materials", [])
        if materials:
            try:
                total_checks += 1
                issues = self._validate_materials(materials)
                all_issues.extend(issues)
                print(f"[ModelValidator] 材质验证完成，发现{len(issues)}个问题")
            except Exception as e:
                print(f"[ModelValidator] 材质验证失败: {e}")
                print(_tb.format_exc())
                all_issues.append(ValidationIssue(
                    category="material", severity="high",
                    title="材质验证器内部错误",
                    description=f"验证过程中发生异常: {str(e)}",
                    auto_fixable=False
                ))

        # 5. 形态键验证
        morphs = model_data.get("morphs", [])
        if morphs:
            try:
                total_checks += 1
                issues = self._validate_morphs(morphs, vertices)
                all_issues.extend(issues)
                print(f"[ModelValidator] 形态键验证完成，发现{len(issues)}个问题")
            except Exception as e:
                print(f"[ModelValidator] 形态键验证失败: {e}")
                print(_tb.format_exc())
                all_issues.append(ValidationIssue(
                    category="morph", severity="high",
                    title="形态键验证器内部错误",
                    description=f"验证过程中发生异常: {str(e)}",
                    auto_fixable=False
                ))

        # 6. 物理验证
        physics = model_data.get("physics", {})
        if physics:
            try:
                total_checks += 1
                issues = self._validate_physics(physics, bones)
                all_issues.extend(issues)
                print(f"[ModelValidator] 物理验证完成，发现{len(issues)}个问题")
            except Exception as e:
                print(f"[ModelValidator] 物理验证失败: {e}")
                print(_tb.format_exc())
                all_issues.append(ValidationIssue(
                    category="physics", severity="high",
                    title="物理验证器内部错误",
                    description=f"验证过程中发生异常: {str(e)}",
                    auto_fixable=False
                ))

        # 7. 模型统计
        report.model_stats = {
            "bone_count": len(bones),
            "vertex_count": len(vertices),
            "material_count": len(materials),
            "ik_chain_count": len(ik_chains),
            "morph_count": len(morphs),
            "texture_count": len(model_data.get("textures", [])),
        }

        report.issues = all_issues
        report.total_checks = total_checks
        report.duration = time.time() - start_time
        self.reports.append(report)

        return report

    def validate_motion(self, motion_data: Dict, model_bones: List[str]) -> ValidationReport:
        """验证动作数据"""
        start_time = time.time()
        report = ValidationReport(
            model_path=motion_data.get("path", ""),
            model_format="vmd",
            model_name=motion_data.get("name", ""),
        )
        issues = self.motion_validator.validate(motion_data, model_bones)
        report.issues = issues
        report.total_checks = 1
        report.duration = time.time() - start_time
        self.reports.append(report)
        return report

    def validate_rendering(self, render_data: Dict) -> ValidationReport:
        """验证前端渲染计算结果"""
        start_time = time.time()
        report = ValidationReport(
            model_path=render_data.get("model_path", ""),
            model_format="render_result",
            model_name=render_data.get("model_name", ""),
        )
        issues = self.rendering_validator.validate_render_result(render_data)
        report.issues = issues
        report.total_checks = 1
        report.duration = time.time() - start_time
        self.reports.append(report)
        return report

    def verify_calculation(self, calculation_type: str, data: Dict) -> Dict:
        """校验前端计算结果

        Args:
            calculation_type: bone_matrix / vertex_skinning / normal_transform / ik_solution
            data: 计算数据
        """
        if calculation_type == "bone_matrix":
            return self.calculation_verifier.verify_bone_matrix(
                data.get("bone", {}),
                data.get("reported_matrix", []),
                data.get("tolerance", 0.01),
            )
        elif calculation_type == "vertex_skinning":
            return self.calculation_verifier.verify_vertex_skinning(
                data.get("vertex", {}),
                data.get("bone_matrices", []),
                data.get("reported_position", (0, 0, 0)),
                data.get("tolerance", 0.01),
            )
        elif calculation_type == "normal_transform":
            return self.calculation_verifier.verify_normal_transform(
                data.get("normal", (0, 0, 1)),
                data.get("bone_matrix", []),
                data.get("reported_normal", (0, 0, 1)),
                data.get("tolerance", 0.01),
            )
        elif calculation_type == "ik_solution":
            return self.calculation_verifier.verify_ik_solution(
                data.get("ik_chain", {}),
                data.get("bone_positions", {}),
                data.get("reported_effector_pos", (0, 0, 0)),
                data.get("tolerance", 0.1),
            )
        return {"error": f"未知计算类型: {calculation_type}"}

    def _validate_materials(self, materials: List[Dict]) -> List[ValidationIssue]:
        """验证材质"""
        issues = []
        for i, mat in enumerate(materials):
            name = mat.get("name", f"material[{i}]")
            # 检查透明度
            alpha = mat.get("alpha", 1.0)
            if alpha <= 0:
                issues.append(ValidationIssue(
                    category="material", severity="medium",
                    title="材质透明度为0",
                    description=f"材质'{name}'的透明度为0，完全不可见",
                    location=name,
                ))
            # 检查纹理路径
            texture = mat.get("texture", "")
            if texture and not os.path.exists(texture):
                issues.append(ValidationIssue(
                    category="texture", severity="high",
                    title="纹理文件不存在",
                    description=f"材质'{name}'引用的纹理文件不存在: {texture}",
                    location=name,
                    expected="存在的文件路径",
                    actual=texture,
                ))
            # 检查shader
            shader = mat.get("shader", "")
            if shader and "error" in shader.lower():
                issues.append(ValidationIssue(
                    category="material", severity="high",
                    title="Shader编译错误",
                    description=f"材质'{name}'的Shader包含错误",
                    location=name,
                ))
        return issues

    def _validate_morphs(self, morphs: List[Dict], vertices: List[Dict]) -> List[ValidationIssue]:
        """验证形态键"""
        issues = []
        for i, morph in enumerate(morphs):
            name = morph.get("name", f"morph[{i}]")
            offsets = morph.get("vertex_offsets", [])
            for offset in offsets:
                vertex_idx = offset.get("vertex_index", 0)
                if vertex_idx >= len(vertices):
                    issues.append(ValidationIssue(
                        category="morph", severity="high",
                        title="形态键引用不存在的顶点",
                        description=f"形态键'{name}'引用顶点索引{vertex_idx}，超出范围(0-{len(vertices)-1})",
                        location=name,
                    ))
                    break
        return issues

    def _validate_physics(self, physics: Dict, bones: List[Dict]) -> List[ValidationIssue]:
        """验证物理刚体/关节"""
        issues = []
        rigid_bodies = physics.get("rigid_bodies", [])
        joints = physics.get("joints", [])
        bone_names = [b.get("name", "") for b in bones]

        for i, rb in enumerate(rigid_bodies):
            name = rb.get("name", f"rigid_body[{i}]")
            related_bone = rb.get("related_bone", "")
            if related_bone and related_bone not in bone_names:
                issues.append(ValidationIssue(
                    category="physics", severity="high",
                    title="刚体关联骨骼不存在",
                    description=f"刚体'{name}'关联的骨骼'{related_bone}'不存在，物理模拟将失败",
                    location=name,
                ))
            mass = rb.get("mass", 1.0)
            if mass <= 0:
                issues.append(ValidationIssue(
                    category="physics", severity="medium",
                    title="刚体质量为0或负数",
                    description=f"刚体'{name}'的质量为{mass}，物理模拟会出错",
                    location=name,
                    expected=">0",
                    actual=str(mass),
                ))

        for i, joint in enumerate(joints):
            name = joint.get("name", f"joint[{i}]")
            rb_a = joint.get("rigid_body_a", "")
            rb_b = joint.get("rigid_body_b", "")
            rb_names = [rb.get("name", "") for rb in rigid_bodies]
            if rb_a and rb_a not in rb_names:
                issues.append(ValidationIssue(
                    category="physics", severity="high",
                    title="关节关联刚体A不存在",
                    description=f"关节'{name}'关联的刚体A'{rb_a}'不存在",
                    location=name,
                ))
            if rb_b and rb_b not in rb_names:
                issues.append(ValidationIssue(
                    category="physics", severity="high",
                    title="关节关联刚体B不存在",
                    description=f"关节'{name}'关联的刚体B'{rb_b}'不存在",
                    location=name,
                ))

        return issues

    def generate_report_markdown(self, report: ValidationReport) -> str:
        """生成Markdown格式验证报告"""
        data = report.to_dict()
        lines = ["# 3D模型验证报告", ""]
        lines.append(f"**模型**: {report.model_name or report.model_path}")
        lines.append(f"**格式**: {report.model_format}")
        lines.append(f"**检查项**: {report.total_checks}")
        lines.append(f"**问题总数**: {report.total_issues}")
        lines.append(f"**模型可用**: {'是' if report.is_usable() else '否'}")
        lines.append(f"**耗时**: {report.duration:.2f}秒")
        lines.append("")

        if report.model_stats:
            lines.append("## 模型统计")
            lines.append("")
            for k, v in report.model_stats.items():
                lines.append(f"- **{k}**: {v}")
            lines.append("")

        lines.append("## 问题统计")
        lines.append("")
        lines.append("### 按严重程度")
        lines.append("")
        for sev in ["critical", "high", "medium", "low", "info"]:
            count = data["by_severity"].get(sev, 0)
            lines.append(f"- **{sev}**: {count}")
        lines.append("")
        lines.append("### 按类别")
        lines.append("")
        for cat, count in sorted(data["by_category"].items()):
            lines.append(f"- **{cat}**: {count}")
        lines.append("")

        lines.append("## 问题详情")
        lines.append("")
        for i, issue in enumerate(report.issues[:100], 1):
            lines.append(f"### {i}. [{issue.severity.upper()}] {issue.title}")
            lines.append("")
            lines.append(f"- **类别**: {issue.category}")
            lines.append(f"- **位置**: {issue.location}")
            lines.append(f"- **描述**: {issue.description}")
            if issue.expected:
                lines.append(f"- **期望**: {issue.expected}")
            if issue.actual:
                lines.append(f"- **实际**: {issue.actual}")
            if issue.auto_fixable:
                lines.append(f"- **可自动修复**: 是")
                lines.append(f"- **修复建议**: {issue.fix_suggestion}")
            lines.append(f"- **置信度**: {issue.confidence:.0%}")
            lines.append("")

        return "\n".join(lines)

    def get_stats(self) -> Dict:
        return {
            "total_reports": len(self.reports),
            "total_issues": sum(len(r.issues) for r in self.reports),
            "usable_models": sum(1 for r in self.reports if r.is_usable()),
        }
