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


class NodeSyncStateMixin:
    """同步项、节点状态、待同步项与统计。"""

    def _load(self):
        sync_file = os.path.join(self.data_dir, "node_sync", "sync_items.json")
        try:
            if os.path.exists(sync_file):
                with open(sync_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for i_data in data.get("items", []):
                    item = SyncItem.from_dict(i_data)
                    self._items[item.item_id] = item
                self._node_states = data.get("node_states", {})
                self._last_sync = data.get("last_sync", 0.0)
        except Exception as e:
            terminal.warn(f"加载同步数据失败: {e}", "node_sync")

    def _save(self):
        sync_dir = os.path.join(self.data_dir, "node_sync")
        os.makedirs(sync_dir, exist_ok=True)
        sync_file = os.path.join(sync_dir, "sync_items.json")
        try:
            data = {
                "version": "2.0", "updated_at": time.time(),
                "items": [i.to_dict() for i in self._items.values()],
                "node_states": self._node_states,
                "last_sync": self._last_sync,
            }
            with open(sync_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def set_item(self, key: str, value: Any, data_type: str = "general",
                 node_id: str = "") -> SyncItem:
        """设置同步数据项"""
        existing = None
        for item in self._items.values():
            if item.key == key and not item.deleted:
                existing = item
                break
    
        if existing:
            existing.value = value
            existing.version += 1
            existing.updated_at = time.time()
            existing.sync_status = "pending"
            existing.conflict = False
            existing.compute_hash()
            item = existing
        else:
            item = SyncItem(key, value, data_type, node_id)
            item.compute_hash()
            with self._lock:
                self._items[item.item_id] = item
    
        self._save()
        return item

    def get_item(self, key: str) -> Optional[SyncItem]:
        for item in self._items.values():
            if item.key == key and not item.deleted:
                return item
        return None

    def get_value(self, key: str, default: Any = None) -> Any:
        item = self.get_item(key)
        return item.value if item else default

    def delete_item(self, key: str) -> bool:
        item = self.get_item(key)
        if item:
            item.deleted = True
            item.sync_status = "pending"
            item.updated_at = time.time()
            self._save()
            return True
        return False

    def list_items(self, data_type: str = "", include_deleted: bool = False,
                   pending_only: bool = False) -> List[SyncItem]:
        items = list(self._items.values())
        if not include_deleted:
            items = [i for i in items if not i.deleted]
        if data_type:
            items = [i for i in items if i.data_type == data_type]
        if pending_only:
            items = [i for i in items if i.sync_status == "pending"]
        return sorted(items, key=lambda i: i.updated_at, reverse=True)

    def get_pending_items(self) -> List[SyncItem]:
        return [i for i in self._items.values() if i.sync_status == "pending" and not i.deleted]

    def update_node_state(self, node_id: str, state: Dict[str, Any]):
        """更新节点状态"""
        with self._lock:
            self._node_states[node_id] = {
                **state,
                "last_heartbeat": time.time(),
            }
        self._save()

    def get_node_state(self, node_id: str) -> Optional[Dict[str, Any]]:
        return self._node_states.get(node_id)

    def list_nodes(self) -> List[Dict[str, Any]]:
        return [{"node_id": nid, **state} for nid, state in self._node_states.items()]

    def get_offline_nodes(self, timeout: float = 300.0) -> List[str]:
        now = time.time()
        return [nid for nid, state in self._node_states.items()
                if now - state.get("last_heartbeat", 0) > timeout]

    def get_sync_status(self) -> Dict[str, Any]:
        return {
            "status": "syncing" if self._syncing else "idle",
            "last_sync": self._last_sync,
            "last_sync_time": datetime.fromtimestamp(self._last_sync).strftime("%Y-%m-%d %H:%M:%S") if self._last_sync else "从未同步",
            "sync_interval": self._sync_interval,
            "pending_items": len(self.get_pending_items()),
            "total_items": len([i for i in self._items.values() if not i.deleted]),
            "conflicts": len(self.detect_conflicts()),
            "active_nodes": len(self._node_states),
            "offline_nodes": len(self.get_offline_nodes()),
            "wan_connected": bool(self._wan and getattr(self._wan, "_running", False)),
            "cached_shared_items": len(self.list_available()),
        }

    def get_stats(self) -> Dict[str, Any]:
        by_type = {}
        for item in self._items.values():
            if not item.deleted:
                by_type[item.data_type] = by_type.get(item.data_type, 0) + 1
        return {
            "total_items": len(self._items),
            "active_items": len([i for i in self._items.values() if not i.deleted]),
            "by_type": by_type,
            "pending": len(self.get_pending_items()),
            "conflicts": len(self.detect_conflicts()),
            "nodes": len(self._node_states),
            "last_sync": self._last_sync,
            "syncing": self._syncing,
            "wan_connected": bool(self._wan and getattr(self._wan, "_running", False)),
        }
