"""
core/memory.py - 记忆系统（优化版）

融合两个版本的优点：
- 保留当前版本的Memory类（遗忘曲线+强度计算+6种记忆类型）
- 吸收0.1.5版本的丰富功能（哈希管理+向量索引+扫描记忆+混合检索+记忆网络+完整性验证+自动提取+系统管理）
- 短期记忆（对话上下文）、长期记忆（事实/偏好/经历）、记忆检索、遗忘曲线、记忆整合
"""
import os
import re
import json
import time
import uuid
import math
import hashlib
import shutil
import threading
from typing import Any, Dict, List, Optional, Tuple
from collections import Counter, defaultdict, deque
from datetime import datetime, timedelta
from enum import Enum
from libertas.foundation.config import get_data_dir

# 可选依赖
try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    import jieba
    HAS_JIEBA = True
except ImportError:
    HAS_JIEBA = False

# 日志记录器
import logging
logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s'))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

from .basic import MemoryBasicMixin
from .index import MemoryIndexMixin
from .index_rebuild import MemoryIndexRebuildMixin
from .maintenance import MemoryMaintenanceMixin
from .models import HAS_JIEBA, HAS_NUMPY, LibertasHashManager, Memory, MemoryType, SimpleVectorizer, _coerce_timestamp
from .network import MemoryNetworkMixin
from .record import MemoryRecordMixin
from .retrieval import MemoryRetrievalMixin
from .scan_record import MemoryScanRecordMixin
from .storage import MemoryStorageMixin
from .tagging import MemoryTagMixin
from .vectors import MemoryVectorMixin
from .stats import MemoryStatsMixin


class MemorySystem(MemoryStorageMixin, MemoryIndexMixin, MemoryVectorMixin, MemoryRetrievalMixin, MemoryBasicMixin, MemoryRecordMixin, MemoryScanRecordMixin, MemoryNetworkMixin, MemoryMaintenanceMixin, MemoryTagMixin, MemoryIndexRebuildMixin, MemoryStatsMixin):
    """记忆系统主类。"""

    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        return {
            "total_long_term": len(self._long_term),
            "total_short_term": len(self._short_term),
            "total_scan_memories": len(self._get_scan_memory_files()),
            "total_tags": len(self._tag_index),
            "total_river_memories": len([f for f in os.listdir(self.MemoryRiverDirectory)
                                          if f.endswith('.json')]) if os.path.exists(self.MemoryRiverDirectory) else 0,
            "hash_version": self.LibertasHashManager.CurrentVersion,
            "vectorizer_fitted": self._vectorizer_fitted,
            "total_vectors": len(self.scan_vectors),
            "has_cognitive_network": self._cognitive_network is not None,
            "has_affinity_engine": self.affinity_engine is not None,
            "last_consolidation": self.SystemState.get("last_consolidation", 0),
            "last_decay": self.SystemState.get("last_decay", 0),
            "last_cleanup": self.SystemMetadata.get("last_cleanup", 0),
        }
