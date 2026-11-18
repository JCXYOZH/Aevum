"""
远程节点同步

结合0.1.5版本的实际同步功能和现在版本的抽象设计：
- 与广域网（WAN）集成，支持节点间数据同步
- 支持推送（push）、拉取（pull）、接收（receive）数据
- 支持变更预览、备份、回滚
- 支持多种数据类型：配置、字典、规则、工作流、记忆、工具
- SyncItem 抽象和冲突检测/解决
- 节点状态管理和统计监控
"""
import os
import json
import time
import uuid
import hashlib
import shutil
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple
from datetime import datetime
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


class NodeSyncStatus(Enum):
    IDLE = "idle"
    SYNCING = "syncing"
    CONFLICT = "conflict"
    ERROR = "error"
    UP_TO_DATE = "up_to_date"

class SyncItem:
    """同步数据项"""

    def __init__(self, key: str = "", value: Any = None,
                 data_type: str = "general", node_id: str = ""):
        self.item_id = f"sync_{uuid.uuid4().hex[:8]}"
        self.key = key
        self.value = value
        self.data_type = data_type
        self.node_id = node_id
        self.version = 1
        self.hash = ""
        self.created_at = time.time()
        self.updated_at = time.time()
        self.last_synced = 0.0
        self.sync_status = "pending"
        self.conflict = False
        self.conflict_version = ""
        self.deleted = False
        self.metadata: Dict[str, Any] = {}

    def compute_hash(self) -> str:
        content = json.dumps({"key": self.key, "value": self.value, "version": self.version},
                            sort_keys=True, default=str)
        self.hash = hashlib.sha256(content.encode()).hexdigest()[:16]
        return self.hash

    def to_dict(self) -> Dict[str, Any]:
        return {
            "item_id": self.item_id,
            "key": self.key,
            "value": self.value,
            "data_type": self.data_type,
            "node_id": self.node_id,
            "version": self.version,
            "hash": self.hash,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_synced": self.last_synced,
            "sync_status": self.sync_status,
            "conflict": self.conflict,
            "deleted": self.deleted,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SyncItem":
        item = cls(
            key=data.get("key", ""),
            value=data.get("value"),
            data_type=data.get("data_type", "general"),
            node_id=data.get("node_id", ""),
        )
        item.item_id = data.get("item_id", item.item_id)
        item.version = data.get("version", 1)
        item.hash = data.get("hash", "")
        item.created_at = data.get("created_at", time.time())
        item.updated_at = data.get("updated_at", time.time())
        item.last_synced = data.get("last_synced", 0.0)
        item.sync_status = data.get("sync_status", "pending")
        item.conflict = data.get("conflict", False)
        item.deleted = data.get("deleted", False)
        return item
