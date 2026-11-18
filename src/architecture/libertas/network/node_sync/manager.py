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

from .collect import NodeSyncCollectMixin
from .conflict import NodeSyncConflictMixin
from .constants import MAX_PUSH_BYTES, MAX_FILE_BYTES, _project_root, _resolve_config_paths, _find_wordlist_dirs, _format_size
from .files import NodeSyncFileMixin
from .models import NodeSyncStatus, SyncItem
from .state import NodeSyncStateMixin
from .transfer import NodeSyncTransferMixin


class NodeSyncManager(NodeSyncStateMixin, NodeSyncTransferMixin, NodeSyncFileMixin, NodeSyncCollectMixin, NodeSyncConflictMixin):
    """远程节点同步管理器。"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or get_data_dir()
        self.cache_dir = os.path.join(self.data_dir, "node_sync_cache")
        os.makedirs(self.cache_dir, exist_ok=True)
    
        # 抽象同步项（现在版本的设计）
        self._items: Dict[str, SyncItem] = {}
        self._node_states: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()
        self._syncing = False
        self._last_sync = 0.0
        self._sync_interval = 300.0
        self._conflict_resolution = "latest_wins"
        self._sync_callbacks: List[Callable] = []
    
        # 广域网实例（0.1.5版本的设计）
        self._wan = None
    
        self._load()

    def set_wan(self, wan):
        """设置广域网实例"""
        self._wan = wan
