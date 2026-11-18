"""模型解析职责：pmx。"""

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

from .reader import BinaryReader
from .models import ParsedModel

class PMXParser:
    """PMX格式解析器（MMD标准二进制格式）

    支持PMX 2.0和2.1版本。
    PMX文件结构：头部 → 顶点 → 面 → 材质 → 骨骼 → IK → 形态键 → 显示帧 → 刚体 → 关节 → 软体
    """

    MAGIC = b"PMX "

    def parse(self, filepath: str) -> ParsedModel:
        """解析PMX文件"""
        model = ParsedModel(format="pmx")

        try:
            with open(filepath, 'rb') as f:
                data = f.read()
        except Exception as e:
            model.parse_errors.append(f"无法读取文件: {e}")
            return model

        reader = BinaryReader(data)

        try:
            self._parse_header(reader, model)
            self._parse_vertices(reader, model)
            self._parse_faces(reader, model)
            self._parse_textures(reader, model)
            self._parse_materials(reader, model)
            self._parse_bones(reader, model)
            self._parse_morphs(reader, model)
            self._parse_rigid_bodies(reader, model)
            self._parse_joints(reader, model)
        except Exception as e:
            model.parse_errors.append(f"解析错误 at offset {reader.offset}: {e}")

        return model

    def _parse_header(self, reader: BinaryReader, model: ParsedModel):
        """解析头部"""
        magic = reader.read(4)
        if magic != self.MAGIC:
            model.parse_errors.append(f"文件头不匹配: 期望{self.MAGIC}, 实际{magic}")
            return

        version = reader.read_float()
        model.format_version = str(version)

        # 全局设置
        globals_count = reader.read_byte()
        encoding = reader.read_byte()  # 0=utf-16le, 1=utf-8
        text_encoding = "utf-16-le" if encoding == 0 else "utf-8"
        reader.skip(globals_count - 1)  # 跳过其他全局设置

        # 模型信息
        model.name = reader.read_text(text_encoding)
        model.name_en = reader.read_text(text_encoding)
        model.comment = reader.read_text(text_encoding)
        model.comment_en = reader.read_text(text_encoding)

    def _parse_vertices(self, reader: BinaryReader, model: ParsedModel):
        """解析顶点"""
        count = reader.read_int()
        for i in range(count):
            position = reader.read_vec3()
            normal = reader.read_vec3()
            uv = reader.read_vec2()
            # 追加UV数量
            add_uv_count = reader.read_byte()
            reader.skip(add_uv_count * 16)  # 每个追加UV 4个float
            # 顶点权重类型
            weight_type = reader.read_byte()
            weights = []
            if weight_type == 0:  # BDEF1
                bone_idx = reader.read_int()
                weights.append((bone_idx, 1.0))
            elif weight_type == 1:  # BDEF2
                b1 = reader.read_int()
                b2 = reader.read_int()
                w1 = reader.read_float()
                weights.append((b1, w1))
                weights.append((b2, 1.0 - w1))
            elif weight_type == 2:  # BDEF4
                for _ in range(4):
                    b = reader.read_int()
                    w = reader.read_float()
                    if w > 0:
                        weights.append((b, w))
            elif weight_type == 3:  # SDEF
                b1 = reader.read_int()
                b2 = reader.read_int()
                w1 = reader.read_float()
                weights.append((b1, w1))
                weights.append((b2, 1.0 - w1))
                reader.skip(24)  # SDEF参数
            reader.read_byte()  # 边缘倍率

            model.vertices.append({
                "index": i,
                "position": position,
                "normal": normal,
                "uv": uv,
                "weights": weights,
            })

    def _parse_faces(self, reader: BinaryReader, model: ParsedModel):
        """解析面（三角形顶点索引）"""
        count = reader.read_int() // 3  # 顶点索引数 / 3 = 三角形数
        for i in range(count):
            v1 = reader.read_int()
            v2 = reader.read_int()
            v3 = reader.read_int()
            model.faces.append((v1, v2, v3))

    def _parse_textures(self, reader: BinaryReader, model: ParsedModel):
        """解析纹理路径"""
        count = reader.read_int()
        for _ in range(count):
            tex = reader.read_text()
            model.textures.append(tex)

    def _parse_materials(self, reader: BinaryReader, model: ParsedModel):
        """解析材质"""
        count = reader.read_int()
        for i in range(count):
            name = reader.read_text()
            name_en = reader.read_text()
            diffuse = reader.read_vec4()
            specular = reader.read_vec3()
            specular_power = reader.read_float()
            ambient = reader.read_vec3()
            flags = reader.read_byte()
            edge_color = reader.read_vec4()
            edge_size = reader.read_float()
            texture_idx = reader.read_int()
            sphere_texture_idx = reader.read_int()
            sphere_mode = reader.read_byte()
            shared_toon = reader.read_byte()
            toon_texture_idx = reader.read_int()
            comment = reader.read_text()
            face_vertex_count = reader.read_int()

            model.materials.append({
                "index": i,
                "name": name,
                "name_en": name_en,
                "diffuse": diffuse,
                "specular": specular,
                "ambient": ambient,
                "alpha": diffuse[3],
                "texture_index": texture_idx,
                "face_count": face_vertex_count // 3,
                "flags": flags,
            })

    def _parse_bones(self, reader: BinaryReader, model: ParsedModel):
        """解析骨骼和IK"""
        count = reader.read_int()
        bone_names = []

        for i in range(count):
            name = reader.read_text()
            name_en = reader.read_text()
            parent_idx = reader.read_int()
            transform_order = reader.read_int()
            bone_flag = reader.read_ushort()
            position = reader.read_vec3()

            bone_names.append(name)

            bone = {
                "index": i,
                "name": name,
                "name_en": name_en,
                "parent_index": parent_idx,
                "position": position,
                "rotation": (0, 0, 0, 1),
                "scale": (1, 1, 1),
                "flags": bone_flag,
            }

            # 连接先（旋转可能）
            if bone_flag & 0x0001:
                bone["tail_position"] = reader.read_vec3()
            else:
                bone["tail_bone_index"] = reader.read_int()

            # 附加偏移
            if bone_flag & 0x0100:
                reader.skip(12)  # 偏移量

            # IK
            if bone_flag & 0x0020:
                ik = self._parse_ik(reader, i, name)
                model.ik_chains.append(ik)

            model.bones.append(bone)

    def _parse_ik(self, reader: BinaryReader, bone_idx: int, bone_name: str) -> Dict:
        """解析IK链"""
        target_bone_idx = reader.read_int()
        loop_count = reader.read_int()
        limit_angle = reader.read_float()
        link_count = reader.read_int()

        chain_bones = []
        for _ in range(link_count):
            link_bone_idx = reader.read_int()
            has_limit = reader.read_byte()
            limit = None
            if has_limit:
                lower = reader.read_vec3()
                upper = reader.read_vec3()
                limit = {"lower": lower, "upper": upper}
            chain_bones.append({
                "bone_index": link_bone_idx,
                "has_limit": has_limit,
                "limit": limit,
            })

        return {
            "target_bone": bone_name,
            "target_bone_index": bone_idx,
            "effector_bone_index": target_bone_idx,
            "iterations": loop_count,
            "limit_angle": limit_angle,
            "chain_bones": chain_bones,
        }

    def _parse_morphs(self, reader: BinaryReader, model: ParsedModel):
        """解析形态键"""
        count = reader.read_int()
        for i in range(count):
            name = reader.read_text()
            name_en = reader.read_text()
            control_panel = reader.read_byte()
            morph_type = reader.read_byte()
            element_count = reader.read_int()

            morph = {
                "index": i,
                "name": name,
                "name_en": name_en,
                "type": morph_type,
                "element_count": element_count,
            }

            if morph_type == 0:  # 顶点形变
                vertex_offsets = []
                for _ in range(element_count):
                    v_idx = reader.read_int()
                    offset = reader.read_vec3()
                    vertex_offsets.append({"vertex_index": v_idx, "offset": offset})
                morph["vertex_offsets"] = vertex_offsets
            else:
                # 其他类型跳过
                reader.skip(element_count * 4)  # 粗略跳过

            model.morphs.append(morph)

    def _parse_rigid_bodies(self, reader: BinaryReader, model: ParsedModel):
        """解析刚体"""
        count = reader.read_int()
        for i in range(count):
            name = reader.read_text()
            name_en = reader.read_text()
            bone_idx = reader.read_int()
            group = reader.read_byte()
            group_mask = reader.read_ushort()
            shape_type = reader.read_byte()
            size = reader.read_vec3()
            position = reader.read_vec3()
            rotation = reader.read_vec3()
            mass = reader.read_float()
            move_damping = reader.read_float()
            rotate_damping = reader.read_float()
            repulsion = reader.read_float()
            friction = reader.read_float()
            physics_mode = reader.read_byte()

            model.rigid_bodies.append({
                "index": i,
                "name": name,
                "related_bone_index": bone_idx,
                "shape_type": shape_type,
                "size": size,
                "position": position,
                "mass": mass,
                "move_damping": move_damping,
                "rotate_damping": rotate_damping,
                "repulsion": repulsion,
                "friction": friction,
                "physics_mode": physics_mode,
            })

    def _parse_joints(self, reader: BinaryReader, model: ParsedModel):
        """解析关节"""
        count = reader.read_int()
        for i in range(count):
            name = reader.read_text()
            name_en = reader.read_text()
            joint_type = reader.read_byte()
            rb_a = reader.read_int()
            rb_b = reader.read_int()
            position = reader.read_vec3()
            rotation = reader.read_vec3()
            lower_limit = reader.read_vec3()
            upper_limit = reader.read_vec3()
            spring_move = reader.read_vec3()
            spring_rotate = reader.read_vec3()

            model.joints.append({
                "index": i,
                "name": name,
                "joint_type": joint_type,
                "rigid_body_a": rb_a,
                "rigid_body_b": rb_b,
                "position": position,
                "lower_limit": lower_limit,
                "upper_limit": upper_limit,
                "spring_move": spring_move,
                "spring_rotate": spring_rotate,
            })
