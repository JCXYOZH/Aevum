"""
core/kb_versioning.py - 知识库版本控制

支持语义化版本、变更追踪、分支与合并、回滚、差异对比、标签与发布。
"""
import os
import json
import time
import uuid
import threading
import difflib
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


# ================================================================
# 版本对象
# ================================================================
class KBVersion:
    """知识库版本"""

    def __init__(self, version: str = "0.1.0", description: str = "",
                 created_by: str = "", branch: str = "main"):
        self.version = version
        self.description = description
        self.created_by = created_by
        self.branch = branch
        self.created_at = time.time()
        self.entries: Dict[str, Dict[str, Any]] = {}
        self.changes: List[Dict[str, Any]] = []
        self.tags: List[str] = []
        self.parent_version = ""
        self.merge_source = ""
        self.compatible_versions: List[str] = []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version, "description": self.description,
            "created_by": self.created_by, "branch": self.branch,
            "created_at": self.created_at,
            "created_time": datetime.fromtimestamp(self.created_at).strftime("%Y-%m-%d %H:%M:%S"),
            "entry_count": len(self.entries),
            "changes": self.changes,
            "tags": self.tags,
            "parent_version": self.parent_version,
            "merge_source": self.merge_source,
            "compatible_versions": self.compatible_versions,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "KBVersion":
        v = cls(version=data.get("version", "0.1.0"),
                description=data.get("description", ""),
                created_by=data.get("created_by", ""),
                branch=data.get("branch", "main"))
        v.created_at = data.get("created_at", time.time())
        v.entries = data.get("entries", {})
        v.changes = data.get("changes", [])
        v.tags = data.get("tags", [])
        v.parent_version = data.get("parent_version", "")
        v.merge_source = data.get("merge_source", "")
        v.compatible_versions = data.get("compatible_versions", [])
        return v


# ================================================================
# 知识库版本管理器
# ================================================================
class KBVersionManager:
    """知识库版本管理器"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "kb_versions")
        os.makedirs(self.data_dir, exist_ok=True)
        self._versions: Dict[str, KBVersion] = {}
        self._branches: Dict[str, List[str]] = {"main": []}
        self._current_version = "0.1.0"
        self._current_branch = "main"
        self._lock = threading.RLock()
        self._load()

    def _load(self):
        """加载版本历史"""
        index_file = os.path.join(self.data_dir, "versions.json")
        try:
            if os.path.exists(index_file):
                with open(index_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for v_data in data.get("versions", []):
                    v = KBVersion.from_dict(v_data)
                    self._versions[v.version] = v
                    self._branches.setdefault(v.branch, []).append(v.version)
                self._current_version = data.get("current_version", "0.1.0")
                self._current_branch = data.get("current_branch", "main")
        except Exception as e:
            terminal.warn(f"加载知识库版本失败: {e}", "kb_versioning")

    def _save(self):
        """保存版本历史"""
        index_file = os.path.join(self.data_dir, "versions.json")
        try:
            data = {
                "version": "1.0",
                "updated_at": time.time(),
                "current_version": self._current_version,
                "current_branch": self._current_branch,
                "versions": [v.to_dict() for v in self._versions.values()],
                "branches": self._branches,
            }
            with open(index_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            terminal.warn(f"保存知识库版本失败: {e}", "kb_versioning")

    def create_version(self, version: str, description: str = "",
                      created_by: str = "", entries: Optional[Dict[str, Any]] = None,
                      changes: Optional[List[Dict[str, Any]]] = None,
                      branch: str = "") -> KBVersion:
        """创建新版本"""
        branch = branch or self._current_branch
        with self._lock:
            if version in self._versions:
                raise ValueError(f"版本 {version} 已存在")

            v = KBVersion(version=version, description=description,
                         created_by=created_by, branch=branch)
            v.entries = entries or {}
            v.changes = changes or []
            v.parent_version = self._current_version

            self._versions[version] = v
            self._branches.setdefault(branch, []).append(version)
            self._current_version = version
            self._current_branch = branch
            self._save()

        terminal.info(f"创建知识库版本: {version} ({description})", "kb_versioning")
        return v

    def get_version(self, version: str = "") -> Optional[KBVersion]:
        v = version or self._current_version
        return self._versions.get(v)

    def list_versions(self, branch: str = "", limit: int = 50) -> List[KBVersion]:
        with self._lock:
            versions = list(self._versions.values())
        if branch:
            versions = [v for v in versions if v.branch == branch]
        versions.sort(key=lambda v: v.created_at, reverse=True)
        return versions[:limit]

    def get_current_version(self) -> str:
        return self._current_version

    def set_current_version(self, version: str) -> bool:
        if version in self._versions:
            self._current_version = version
            self._current_branch = self._versions[version].branch
            self._save()
            return True
        return False

    def add_entry(self, key: str, value: Any, version: str = "",
                  change_type: str = "add", description: str = "") -> bool:
        """添加/更新知识条目"""
        v = self.get_version(version)
        if not v:
            return False
        old_value = v.entries.get(key)
        v.entries[key] = {"value": value, "updated_at": time.time()}
        v.changes.append({
            "type": change_type,
            "key": key,
            "old_value": str(old_value)[:200] if old_value else "",
            "new_value": str(value)[:200],
            "description": description,
            "timestamp": time.time(),
        })
        self._save()
        return True

    def remove_entry(self, key: str, version: str = "") -> bool:
        v = self.get_version(version)
        if not v or key not in v.entries:
            return False
        old_value = v.entries.pop(key)
        v.changes.append({
            "type": "delete", "key": key,
            "old_value": str(old_value)[:200],
            "timestamp": time.time(),
        })
        self._save()
        return True

    def get_entry(self, key: str, version: str = "") -> Optional[Any]:
        v = self.get_version(version)
        if v and key in v.entries:
            return v.entries[key].get("value")
        return None

    def diff_versions(self, version1: str, version2: str) -> Dict[str, Any]:
        """比较两个版本的差异"""
        v1 = self._versions.get(version1)
        v2 = self._versions.get(version2)
        if not v1 or not v2:
            return {"error": "版本不存在"}

        keys1 = set(v1.entries.keys())
        keys2 = set(v2.entries.keys())
        added = keys2 - keys1
        removed = keys1 - keys2
        modified = keys1 & keys2

        changes = []
        for key in added:
            changes.append({"type": "added", "key": key, "value": str(v2.entries[key])[:200]})
        for key in removed:
            changes.append({"type": "removed", "key": key, "value": str(v1.entries[key])[:200]})
        for key in modified:
            val1 = str(v1.entries[key].get("value", ""))
            val2 = str(v2.entries[key].get("value", ""))
            if val1 != val2:
                diff = difflib.unified_diff(
                    val1.splitlines(), val2.splitlines(),
                    fromfile=version1, tofile=version2, lineterm=""
                )
                changes.append({
                    "type": "modified", "key": key,
                    "diff": "\n".join(list(diff)[:50]),
                })

        return {
            "version1": version1, "version2": version2,
            "added": list(added), "removed": list(removed),
            "modified_count": len([c for c in changes if c["type"] == "modified"]),
            "changes": changes,
        }

    def create_branch(self, branch_name: str, from_version: str = "") -> bool:
        """创建分支"""
        with self._lock:
            if branch_name in self._branches:
                return False
            source_version = from_version or self._current_version
            self._branches[branch_name] = [source_version] if source_version else []
            self._current_branch = branch_name
            self._save()
        terminal.info(f"创建分支: {branch_name} (from {source_version})", "kb_versioning")
        return True

    def list_branches(self) -> List[str]:
        return list(self._branches.keys())

    def merge_branch(self, source_branch: str, target_branch: str = "main",
                     merge_strategy: str = "three_way") -> Dict[str, Any]:
        """合并分支"""
        if source_branch not in self._branches or target_branch not in self._branches:
            return {"success": False, "error": "分支不存在"}

        source_versions = [self._versions[v] for v in self._branches[source_branch] if v in self._versions]
        target_versions = [self._versions[v] for v in self._branches[target_branch] if v in self._versions]

        if not source_versions:
            return {"success": False, "error": "源分支无版本"}

        latest_source = source_versions[-1]
        latest_target = target_versions[-1] if target_versions else None

        # 三向合并
        merged_entries = {}
        conflicts = []

        if latest_target:
            all_keys = set(latest_source.entries.keys()) | set(latest_target.entries.keys())
            for key in all_keys:
                src_val = latest_source.entries.get(key, {}).get("value")
                tgt_val = latest_target.entries.get(key, {}).get("value")
                if src_val == tgt_val:
                    merged_entries[key] = latest_source.entries[key]
                elif src_val is not None and tgt_val is None:
                    merged_entries[key] = latest_source.entries[key]
                elif src_val is None and tgt_val is not None:
                    merged_entries[key] = latest_target.entries[key]
                else:
                    conflicts.append({"key": key, "source": str(src_val)[:100], "target": str(tgt_val)[:100]})
        else:
            merged_entries = dict(latest_source.entries)

        merge_version = f"{latest_source.version}+merge"
        v = self.create_version(
            version=merge_version,
            description=f"合并 {source_branch} -> {target_branch}",
            entries=merged_entries,
            branch=target_branch,
        )
        v.merge_source = source_branch
        v.changes.append({"type": "merge", "source": source_branch, "target": target_branch,
                          "conflicts": conflicts, "timestamp": time.time()})
        self._save()

        return {
            "success": len(conflicts) == 0,
            "merge_version": merge_version,
            "conflicts": conflicts,
            "merged_entries": len(merged_entries),
        }

    def rollback(self, version: str) -> bool:
        """回滚到指定版本"""
        if version not in self._versions:
            return False
        self._current_version = version
        self._current_branch = self._versions[version].branch
        self._save()
        terminal.info(f"回滚到版本: {version}", "kb_versioning")
        return True

    def tag_version(self, version: str, tag: str) -> bool:
        v = self._versions.get(version)
        if v and tag not in v.tags:
            v.tags.append(tag)
            self._save()
            return True
        return False

    def get_version_by_tag(self, tag: str) -> Optional[KBVersion]:
        for v in self._versions.values():
            if tag in v.tags:
                return v
        return None

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_versions": len(self._versions),
            "current_version": self._current_version,
            "current_branch": self._current_branch,
            "branches": self.list_branches(),
            "total_entries": sum(len(v.entries) for v in self._versions.values()),
            "total_changes": sum(len(v.changes) for v in self._versions.values()),
        }

    # ========== API compatible methods ==========

    def get_history(self, doc_id: str = "") -> List[Dict[str, Any]]:
        """Get version history for a document (API compatible)"""
        history = []
        for v in sorted(self._versions.values(), key=lambda x: x.timestamp, reverse=True):
            if doc_id and doc_id not in v.entries:
                continue
            entry = v.entries.get(doc_id, {}) if doc_id else None
            history.append({
                "version": v.version,
                "description": v.description,
                "timestamp": v.timestamp,
                "branch": v.branch,
                "changes": v.changes,
                "entry": entry,
            })
        return history

    def get_changed_docs(self) -> List[Dict[str, Any]]:
        """Get changed documents since last version (API compatible)"""
        versions = sorted(self._versions.values(), key=lambda x: x.timestamp, reverse=True)
        if len(versions) < 2:
            return []
        latest = versions[0]
        previous = versions[1]
        changed = []
        all_keys = set(latest.entries.keys()) | set(previous.entries.keys())
        for key in all_keys:
            new_val = latest.entries.get(key, {}).get("value")
            old_val = previous.entries.get(key, {}).get("value")
            if new_val != old_val:
                change_type = "added" if old_val is None else ("removed" if new_val is None else "modified")
                changed.append({
                    "doc_id": key,
                    "change_type": change_type,
                    "version": latest.version,
                    "timestamp": latest.timestamp,
                })
        return changed

    def diff(self, v1: str, v2: str) -> Dict[str, Any]:
        """Get diff between two versions (API compatible)"""
        ver1 = self._versions.get(v1)
        ver2 = self._versions.get(v2)
        if not ver1 or not ver2:
            return {"success": False, "error": "Version not found"}
        all_keys = set(ver1.entries.keys()) | set(ver2.entries.keys())
        added = []
        removed = []
        modified = []
        for key in all_keys:
            val1 = ver1.entries.get(key, {}).get("value")
            val2 = ver2.entries.get(key, {}).get("value")
            if val1 is None and val2 is not None:
                added.append(key)
            elif val1 is not None and val2 is None:
                removed.append(key)
            elif val1 != val2:
                modified.append(key)
        return {
            "success": True,
            "v1": v1,
            "v2": v2,
            "added": added,
            "removed": removed,
            "modified": modified,
            "total_changes": len(added) + len(removed) + len(modified),
        }


# 全局版本管理器
_kb_version_manager = KBVersionManager()


def get_kb_version_manager() -> KBVersionManager:
    return _kb_version_manager


# 向后兼容：旧版类名别名
KBVersionControl = KBVersionManager
