"""模型解析职责：core。"""

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

from .pmd import PMDParser
from .pmx import PMXParser
from .models import ParsedModel
from .vmd import VMDParser
from .vrm import VRMParser

class ModelParser:
    """统一模型文件解析入口

    自动识别文件格式，调用对应的解析器。
    输出统一的ParsedModel数据结构，可直接传给ModelValidator验证。
    """

    def __init__(self):
        self.pmx_parser = PMXParser()
        self.vrm_parser = VRMParser()
        self.pmd_parser = PMDParser()
        self.vmd_parser = VMDParser()

    def parse(self, filepath: str) -> ParsedModel:
        """解析模型文件（自动识别格式）"""
        ext = os.path.splitext(filepath)[1].lower()

        if ext == '.pmx':
            return self.pmx_parser.parse(filepath)
        elif ext in ('.vrm', '.glb', '.gltf'):
            return self.vrm_parser.parse(filepath)
        elif ext == '.pmd':
            return self.pmd_parser.parse(filepath)
        else:
            # 尝试通过文件头识别
            return self._detect_and_parse(filepath)

    def parse_motion(self, filepath: str) -> Dict:
        """解析动作文件（VMD）"""
        ext = os.path.splitext(filepath)[1].lower()
        if ext == '.vmd':
            return self.vmd_parser.parse(filepath)
        return {"format": "unknown", "parse_errors": [f"不支持的动作格式: {ext}"]}

    def _detect_and_parse(self, filepath: str) -> ParsedModel:
        """通过文件头自动识别格式"""
        model = ParsedModel()
        try:
            with open(filepath, 'rb') as f:
                header = f.read(4)
            if header[:3] == b'PMX':
                return self.pmx_parser.parse(filepath)
            elif header[:3] == b'Pmd':
                return self.pmd_parser.parse(filepath)
            elif header[:4] == b'glTF':
                return self.vrm_parser.parse(filepath)
            else:
                # 尝试JSON
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                if "asset" in data:
                    return self.vrm_parser.parse(filepath)
                model.parse_errors.append(f"无法识别的文件格式: {header}")
        except Exception as e:
            model.parse_errors.append(f"文件识别失败: {e}")
        return model

    def parse_and_validate(self, filepath: str, validator=None) -> Tuple[ParsedModel, Optional[Any]]:
        """解析并验证模型

        Args:
            filepath: 模型文件路径
            validator: ModelValidator实例，为None则只解析不验证

        Returns:
            (parsed_model, validation_report)
        """
        model = self.parse(filepath)

        if validator is None:
            return model, None

        # 转换为ModelValidator需要的格式
        model_data = {
            "name": model.name,
            "path": filepath,
            "bones": model.bones,
            "vertices": model.vertices,
            "materials": model.materials,
            "ik_chains": model.ik_chains,
            "morphs": model.morphs,
            "physics": {
                "rigid_bodies": model.rigid_bodies,
                "joints": model.joints,
            },
            "textures": model.textures,
        }
        report = validator.validate_model(model_data, format_type=model.format)
        return model, report

    def get_supported_formats(self) -> List[str]:
        return [".pmx", ".vrm", ".glb", ".gltf", ".pmd", ".vmd"]
