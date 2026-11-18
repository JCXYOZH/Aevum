"""
融合版认知网络系统

融合0.1.5版本的记忆关联功能和现在版本的通用概念网络架构：
- 概念节点、关联边、传播激活、路径推理、聚类分析（通用概念网络）
- 记忆关系图、情感网络、语义关联查找、深度思考触发（记忆关联）
"""
import os
import re
import json
import time
import uuid
import math
import random
import threading
from typing import Any, Dict, List, Optional, Set, Tuple
from collections import defaultdict, deque
from datetime import datetime
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

# 可选依赖
try:
    import jieba
except ImportError:
    jieba = None


class ConceptNode:
    """概念节点"""

    def __init__(self, name: str = "", node_type: str = "concept",
                 description: str = ""):
        self.node_id = f"node_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.node_type = node_type  # concept / entity / action / attribute / emotion
        self.description = description
        self.created_at = time.time()
        self.updated_at = time.time()
        self.activation = 0.0
        self.weights: Dict[str, float] = {}  # 上下文权重
        self.tags: List[str] = []
        self.metadata: Dict[str, Any] = {}
        self.access_count = 0
        self.last_accessed = 0.0

    def activate(self, amount: float = 1.0, decay: float = 0.1):
        self.activation = min(1.0, self.activation + amount)
        self.access_count += 1
        self.last_accessed = time.time()

    def decay(self, rate: float = 0.05):
        self.activation = max(0.0, self.activation - rate)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "node_id": self.node_id, "name": self.name,
            "node_type": self.node_type, "description": self.description,
            "created_at": self.created_at, "activation": self.activation,
            "tags": self.tags, "access_count": self.access_count,
        }

class ConceptEdge:
    """概念关联边"""

    def __init__(self, source: str = "", target: str = "",
                 relation: str = "related", weight: float = 0.5):
        self.edge_id = f"edge_{uuid.uuid4().hex[:8]}"
        self.source = source
        self.target = target
        self.relation = relation  # related / is_a / part_of / causes / similar / opposite
        self.weight = weight
        self.created_at = time.time()
        self.updated_at = time.time()
        self.access_count = 0
        self.directional = True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "edge_id": self.edge_id, "source": self.source,
            "target": self.target, "relation": self.relation,
            "weight": self.weight, "created_at": self.created_at,
            "access_count": self.access_count,
        }
