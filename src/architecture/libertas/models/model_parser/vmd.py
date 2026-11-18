"""模型解析职责：vmd。"""

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

class VMDParser:
    """VMD动作数据解析器"""

    MAGIC = b"Vocaloid Motion Data 0002"

    def parse(self, filepath: str) -> Dict:
        """解析VMD文件，返回动作数据"""
        result = {
            "format": "vmd",
            "model_name": "",
            "bone_frames": {},
            "morph_frames": {},
            "camera_frames": [],
            "light_frames": [],
            "frame_count": 0,
            "parse_errors": [],
        }

        try:
            with open(filepath, 'rb') as f:
                data = f.read()
        except Exception as e:
            result["parse_errors"].append(f"无法读取文件: {e}")
            return result

        reader = BinaryReader(data)

        try:
            magic = reader.read(30)
            if self.MAGIC.encode() not in magic:
                result["parse_errors"].append("不是有效的VMD文件")

            result["model_name"] = reader.read_text_bytes(20)

            # 骨骼关键帧
            bone_count = reader.read_uint()
            for _ in range(bone_count):
                bone_name = reader.read_text_bytes(15)
                frame = reader.read_uint()
                position = reader.read_vec3()
                rotation = reader.read_vec4()
                interpolation = reader.read(64)  # 插值曲线

                if bone_name not in result["bone_frames"]:
                    result["bone_frames"][bone_name] = []
                result["bone_frames"][bone_name].append({
                    "frame": frame,
                    "position": position,
                    "rotation": rotation,
                })
                result["frame_count"] = max(result["frame_count"], frame)

            # 形态键关键帧
            morph_count = reader.read_uint()
            for _ in range(morph_count):
                morph_name = reader.read_text_bytes(15)
                frame = reader.read_uint()
                weight = reader.read_float()

                if morph_name not in result["morph_frames"]:
                    result["morph_frames"][morph_name] = []
                result["morph_frames"][morph_name].append({
                    "frame": frame, "weight": weight,
                })

            # 相机关键帧
            camera_count = reader.read_uint()
            for _ in range(camera_count):
                frame = reader.read_uint()
                distance = reader.read_float()
                position = reader.read_vec3()
                rotation = reader.read_vec3()
                interpolation = reader.read(24)
                fov = reader.read_uint()
                perspective = reader.read_byte()
                result["camera_frames"].append({
                    "frame": frame, "distance": distance,
                    "position": position, "rotation": rotation, "fov": fov,
                })

            # 光照关键帧
            light_count = reader.read_uint()
            for _ in range(light_count):
                frame = reader.read_uint()
                color = reader.read_vec3()
                direction = reader.read_vec3()
                result["light_frames"].append({
                    "frame": frame, "color": color, "direction": direction,
                })

        except Exception as e:
            result["parse_errors"].append(f"解析错误: {e}")

        # 排序关键帧
        for bone_name in result["bone_frames"]:
            result["bone_frames"][bone_name].sort(key=lambda x: x["frame"])
        for morph_name in result["morph_frames"]:
            result["morph_frames"][morph_name].sort(key=lambda x: x["frame"])

        return result
