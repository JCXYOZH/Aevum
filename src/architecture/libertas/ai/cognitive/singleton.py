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

from .models import ConceptEdge, ConceptNode
from .network import CognitiveNetwork

_cognitive_network = None


def get_cognitive_network() -> CognitiveNetwork:
    return _cognitive_network


def relate_concepts(source: str, target: str, **kwargs) -> Optional[ConceptEdge]:
    return _cognitive_network.add_edge(source, target, **kwargs)
