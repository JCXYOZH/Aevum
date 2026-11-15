"""模型解析职责：models。"""

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


@dataclass
class ParsedModel:
    """解析后的统一模型数据结构"""
    format: str = ""  # pmx/vrm/pmd
    format_version: str = ""
    name: str = ""
    name_en: str = ""
    comment: str = ""
    comment_en: str = ""
    vertices: List[Dict] = field(default_factory=list)
    faces: List[Tuple[int, int, int]] = field(default_factory=list)
    materials: List[Dict] = field(default_factory=list)
    bones: List[Dict] = field(default_factory=list)
    ik_chains: List[Dict] = field(default_factory=list)
    morphs: List[Dict] = field(default_factory=list)
    rigid_bodies: List[Dict] = field(default_factory=list)
    joints: List[Dict] = field(default_factory=list)
    textures: List[str] = field(default_factory=list)
    metadata: Dict = field(default_factory=dict)
    parse_errors: List[str] = field(default_factory=list)
    parse_warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "format": self.format,
            "format_version": self.format_version,
            "name": self.name,
            "name_en": self.name_en,
            "comment": self.comment[:500] if self.comment else "",
            "vertex_count": len(self.vertices),
            "face_count": len(self.faces),
            "material_count": len(self.materials),
            "bone_count": len(self.bones),
            "ik_chain_count": len(self.ik_chains),
            "morph_count": len(self.morphs),
            "rigid_body_count": len(self.rigid_bodies),
            "joint_count": len(self.joints),
            "texture_count": len(self.textures),
            "bones": self.bones,
            "vertices": self.vertices[:1000],  # 限制数量
            "materials": self.materials,
            "ik_chains": self.ik_chains,
            "morphs": self.morphs,
            "rigid_bodies": self.rigid_bodies,
            "joints": self.joints,
            "metadata": self.metadata,
            "parse_errors": self.parse_errors,
            "parse_warnings": self.parse_warnings,
        }
