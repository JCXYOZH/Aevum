"""模型解析职责：pmd。"""

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

class PMDParser:
    """PMD格式解析器（旧版MMD格式）"""

    MAGIC = b"Pmd"

    def parse(self, filepath: str) -> ParsedModel:
        model = ParsedModel(format="pmd")

        try:
            with open(filepath, 'rb') as f:
                data = f.read()
        except Exception as e:
            model.parse_errors.append(f"无法读取文件: {e}")
            return model

        reader = BinaryReader(data)

        try:
            magic = reader.read(3)
            if magic != self.MAGIC:
                model.parse_errors.append(f"文件头不匹配: {magic}")
                return model

            model.format_version = str(reader.read_float())
            model.name = reader.read_text_bytes(20)
            model.comment = reader.read_text_bytes(256)

            # 顶点
            vertex_count = reader.read_uint()
            for i in range(vertex_count):
                position = reader.read_vec3()
                normal = reader.read_vec3()
                uv = reader.read_vec2()
                bone1 = reader.read_ushort()
                bone2 = reader.read_ushort()
                weight = reader.read_byte() / 100.0
                edge_flag = reader.read_byte()

                weights = []
                if bone1 < 65535:
                    weights.append((bone1, weight))
                if bone2 < 65535 and weight < 1.0:
                    weights.append((bone2, 1.0 - weight))

                model.vertices.append({
                    "index": i, "position": position, "normal": normal,
                    "uv": uv, "weights": weights,
                })

            # 面
            face_vertex_count = reader.read_uint()
            for i in range(face_vertex_count // 3):
                v1 = reader.read_ushort()
                v2 = reader.read_ushort()
                v3 = reader.read_ushort()
                model.faces.append((v1, v2, v3))

            # 材质
            material_count = reader.read_uint()
            for i in range(material_count):
                diffuse = reader.read_vec4()
                reader.skip(12)  # 反射率+光泽
                ambient = reader.read_vec3()
                toon_idx = reader.read_byte()
                edge_flag = reader.read_byte()
                face_count = reader.read_uint()
                texture_path = reader.read(20)

                model.materials.append({
                    "index": i, "diffuse": diffuse, "ambient": ambient,
                    "alpha": diffuse[3], "face_count": face_count // 3,
                })

            # 骨骼
            bone_count = reader.read_ushort()
            for i in range(bone_count):
                name = reader.read_text_bytes(20)
                parent = reader.read_ushort()
                tail = reader.read_ushort()
                bone_type = reader.read_byte()
                ik_parent = reader.read_ushort()
                position = reader.read_vec3()

                model.bones.append({
                    "index": i, "name": name,
                    "parent_index": parent if parent < 65535 else -1,
                    "position": position, "rotation": (0, 0, 0, 1),
                    "scale": (1, 1, 1), "bone_type": bone_type,
                })

            # IK
            ik_count = reader.read_ushort()
            for i in range(ik_count):
                target = reader.read_ushort()
                effector = reader.read_ushort()
                chain_len = reader.read_byte()
                iterations = reader.read_uint()
                limit = reader.read_float()
                chain_bones = []
                for _ in range(chain_len):
                    cb = reader.read_ushort()
                    chain_bones.append({"bone_index": cb, "has_limit": 0})

                target_name = model.bones[target]["name"] if target < len(model.bones) else ""
                model.ik_chains.append({
                    "target_bone": target_name, "target_bone_index": target,
                    "effector_bone_index": effector, "iterations": iterations,
                    "limit_angle": limit, "chain_bones": chain_bones,
                })

        except Exception as e:
            model.parse_errors.append(f"解析错误: {e}")

        return model
