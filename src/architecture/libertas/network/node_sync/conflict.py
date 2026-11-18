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

from .constants import MAX_PUSH_BYTES, MAX_FILE_BYTES, _project_root, _resolve_config_paths, _find_wordlist_dirs, _format_size
from .models import NodeSyncStatus, SyncItem


class NodeSyncConflictMixin:
    """冲突检测、解决与同步编排。"""

    def detect_conflicts(self) -> List[SyncItem]:
        """检测冲突"""
        return [i for i in self._items.values() if i.conflict]

    def resolve_conflict(self, key: str, resolution: str = "latest_wins",
                         custom_value: Any = None) -> bool:
        """解决冲突"""
        item = self.get_item(key)
        if not item or not item.conflict:
            return False
    
        if resolution == "latest_wins":
            item.conflict = False
            item.conflict_version = ""
            item.sync_status = "pending"
        elif resolution == "custom" and custom_value is not None:
            item.value = custom_value
            item.version += 1
            item.conflict = False
            item.compute_hash()
            item.sync_status = "pending"
        elif resolution == "keep_local":
            item.conflict = False
            item.sync_status = "pending"
        else:
            return False
    
        self._save()
        return True

    def sync(self, target_node: str = "") -> Dict[str, Any]:
        """执行同步（将待同步项标记为已同步，实际网络同步通过 push/pull 完成）"""
        if self._syncing:
            return {"success": False, "error": "同步正在进行中"}
    
        self._syncing = True
        start = time.time()
        terminal.info(f"开始节点同步..." + (f" -> {target_node}" if target_node else ""), "node_sync")
    
        pending = self.get_pending_items()
        synced = 0
        conflicts = 0
        errors = []
    
        for item in pending:
            try:
                item.compute_hash()
                item.last_synced = time.time()
                item.sync_status = "synced"
                synced += 1
    
                for callback in self._sync_callbacks:
                    try:
                        callback(item, "synced")
                    except Exception:
                        pass
            except Exception as e:
                errors.append({"key": item.key, "error": str(e)})
                item.sync_status = "error"
    
        self._last_sync = time.time()
        self._syncing = False
        self._save()
    
        duration = time.time() - start
        result = {
            "success": len(errors) == 0,
            "synced": synced,
            "conflicts": conflicts,
            "errors": errors,
            "duration_ms": round(duration * 1000, 1),
            "timestamp": time.time(),
            "note": "实际网络同步通过 push/pull 方法完成，此方法只更新本地同步状态",
        }
        terminal.success(f"节点同步完成: {synced}项, {len(errors)}个错误", "node_sync")
        return result

    def on_sync(self, callback: Callable):
        self._sync_callbacks.append(callback)
