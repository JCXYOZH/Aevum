"""模型解析职责：vrm。"""

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

class VRMParser:
    """VRM格式解析器

    VRM基于glTF 2.0，包含JSON元数据和二进制buffer。
    重点解析Humanoid骨骼映射、形态键、元数据。
    """

    def parse(self, filepath: str) -> ParsedModel:
        """解析VRM文件"""
        model = ParsedModel(format="vrm")

        try:
            with open(filepath, 'rb') as f:
                data = f.read()
        except Exception as e:
            model.parse_errors.append(f"无法读取文件: {e}")
            return model

        # VRM是glTF格式，可能是.glb(二进制)或.gltf(JSON)
        if filepath.lower().endswith('.glb') or data[:4] == b'glTF':
            self._parse_glb(data, model)
        else:
            self._parse_gltf_json(data, model)

        return model

    def _parse_glb(self, data: bytes, model: ParsedModel):
        """解析GLB二进制格式"""
        reader = BinaryReader(data)

        # GLB头
        magic = reader.read(4)
        if magic != b'glTF':
            model.parse_errors.append("不是有效的GLB文件")
            return

        version = reader.read_uint()
        length = reader.read_uint()
        model.format_version = f"glTF {version}"

        # 读取chunks
        json_data = None
        while reader.remaining() > 0:
            chunk_length = reader.read_uint()
            chunk_type = reader.read(4)
            chunk_data = reader.read(chunk_length)

            if chunk_type == b'JSON':
                try:
                    json_data = json.loads(chunk_data.decode('utf-8'))
                except Exception as e:
                    model.parse_errors.append(f"JSON解析失败: {e}")
            elif chunk_type == b'BIN\0':
                model.metadata["binary_buffer_size"] = len(chunk_data)

        if json_data:
            self._parse_gltf_data(json_data, model)

    def _parse_gltf_json(self, data: bytes, model: ParsedModel):
        """解析glTF JSON格式"""
        try:
            json_data = json.loads(data.decode('utf-8'))
            self._parse_gltf_data(json_data, model)
        except Exception as e:
            model.parse_errors.append(f"JSON解析失败: {e}")

    def _parse_gltf_data(self, gltf: Dict, model: ParsedModel):
        """解析glTF数据"""
        # 基本信息
        asset = gltf.get("asset", {})
        model.format_version = asset.get("version", "2.0")

        # VRM扩展
        vrm_ext = gltf.get("extensions", {}).get("VRM", {})
        if vrm_ext:
            model.name = vrm_ext.get("meta", {}).get("title", "")
            model.metadata["vrm_version"] = vrm_ext.get("exporterVersion", "")
            model.metadata["author"] = vrm_ext.get("meta", {}).get("author", "")
            model.metadata["contact"] = vrm_ext.get("meta", {}).get("contactInformation", "")
            model.metadata["reference"] = vrm_ext.get("meta", {}).get("reference", "")
            model.metadata["allowed_user"] = vrm_ext.get("meta", {}).get("allowedUserName", "")
            model.metadata["violent"] = vrm_ext.get("meta", {}).get("violentUssageName", "")
            model.metadata["sexual"] = vrm_ext.get("meta", {}).get("sexualUssageName", "")
            model.metadata["commercial"] = vrm_ext.get("meta", {}).get("commercialUssageName", "")
            model.metadata["license"] = vrm_ext.get("meta", {}).get("licenseName", "")

        # 解析骨骼
        nodes = gltf.get("nodes", [])
        skins = gltf.get("skins", [])

        if skins:
            skin = skins[0]
            joints = skin.get("joints", [])
            for i, joint_idx in enumerate(joints):
                if joint_idx < len(nodes):
                    node = nodes[joint_idx]
                    bone = {
                        "index": i,
                        "name": node.get("name", f"bone_{i}"),
                        "parent_index": -1,
                        "position": node.get("translation", [0, 0, 0]),
                        "rotation": node.get("rotation", [0, 0, 0, 1]),
                        "scale": node.get("scale", [1, 1, 1]),
                    }
                    model.bones.append(bone)

            # 建立父子关系
            for i, joint_idx in enumerate(joints):
                if joint_idx < len(nodes):
                    node = nodes[joint_idx]
                    children = node.get("children", [])
                    for child_idx in children:
                        for j, j2 in enumerate(joints):
                            if j2 == child_idx:
                                model.bones[j]["parent_index"] = i
                                break

        # VRM Humanoid骨骼映射
        if vrm_ext:
            humanoid = vrm_ext.get("humanoid", {})
            human_bones = humanoid.get("humanBones", [])
            bone_name_map = {}
            for hb in human_bones:
                bone_name_map[hb.get("bone", "")] = hb.get("node", -1)
            model.metadata["humanoid_bones"] = bone_name_map

        # 解析形态键
        meshes = gltf.get("meshes", [])
        for mesh in meshes:
            primitives = mesh.get("primitives", [])
            for prim in primitives:
                targets = prim.get("targets", [])
                for i, target in enumerate(targets):
                    name = mesh.get("name", f"morph_{i}")
                    model.morphs.append({
                        "index": len(model.morphs),
                        "name": name,
                        "type": 0,
                        "element_count": 0,
                    })

        # VRM形态键组
        if vrm_ext:
            blend_shape = vrm_ext.get("blendShapeGroups", [])
            for bs in blend_shape:
                model.metadata.setdefault("blend_shape_groups", []).append({
                    "name": bs.get("name", ""),
                    "preset": bs.get("presetName", ""),
                    "is_binary": bs.get("isBinary", False),
                })

        # 材质
        mat_list = gltf.get("materials", [])
        for i, mat in enumerate(mat_list):
            model.materials.append({
                "index": i,
                "name": mat.get("name", f"material_{i}"),
                "alpha": mat.get("alphaMode", "OPAQUE"),
                "double_sided": mat.get("doubleSided", False),
            })

        # 统计
        model.metadata["node_count"] = len(nodes)
        model.metadata["mesh_count"] = len(meshes)
        model.metadata["skin_count"] = len(skins)
