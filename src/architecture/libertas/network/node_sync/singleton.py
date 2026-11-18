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

from .models import NodeSyncStatus, SyncItem
from .manager import NodeSyncManager

_node_sync_manager = None


def get_node_sync_manager() -> NodeSyncManager:
    return _node_sync_manager


def sync_node_data(**kwargs) -> Dict[str, Any]:
    return _node_sync_manager.sync(**kwargs)
