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


class NodeSyncTransferMixin:
    """推送、接收、拉取、变更预览、备份与回滚。"""

    def push(self, data_type: str, file_name: str = "",
             target_peer_id: str = "", title: str = "",
             description: str = "", tags: str = "") -> Dict:
        """推送本地数据到WAN房间
    
        Args:
            data_type: wordlists / tool_config / rules / workflows / memory / tools
            file_name: 可选，指定要推送的文件名
            target_peer_id: 目标用户ID，空=广播给所有人
            title: 共享标题
            description: 自定义介绍信息
            tags: 标签（逗号分隔）
        """
        data = self._collect_data(data_type, file_name)
        if not data.get("success"):
            return data
        if not self._wan or not getattr(self._wan, "_running", False):
            return {"success": False, "error": "未连接广域网，请先加入房间"}
    
        payload = {
            "type": "node_sync",
            "data_type": data_type,
            "peer_id": getattr(self._wan, "peer_id", ""),
            "nickname": getattr(self._wan, "nickname", ""),
            "file_name": data.get("file_name", ""),
            "data": data["content"],
            "timestamp": time.time(),
            "target_peer_id": target_peer_id or "",
            "title": (title or "").strip()[:200],
            "description": (description or "").strip()[:2000],
            "tags": [t.strip() for t in (tags or "").split(",") if t.strip()][:10],
        }
    
        try:
            raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            if len(raw) > MAX_PUSH_BYTES:
                return {"success": False, "error": f"数据太大（{len(raw)}字节），请选择较小的文件"}
    
            if hasattr(self._wan, '_publish'):
                self._wan._publish("msg", payload)
            else:
                self._wan.client.publish(
                    f"{self._wan.topic_base}/sync", raw
                )
    
            # 发送者本地也显示一条系统消息
            type_labels = {
                "wordlists": "[DOC] 字典",
                "tool_config": "[TOOL] 配置",
                "rules": "[INFO] 规则",
                "workflows": "[SYNC] 工作流",
                "memory": "[AI] 记忆",
                "tools": "[TOOL] 工具",
            }
            label = type_labels.get(data_type, data_type)
            fn = data.get("file_name", "")
            target_str = "所有人" if not target_peer_id else f"→ {target_peer_id[:12]}"
    
            if title:
                local_text = f"[PACK] [{target_str}] {title}"
                if fn:
                    local_text += f"（{label}: {fn}）"
            elif fn:
                local_text = f"[PACK] [{target_str}] 已共享 {label}: {fn}"
            else:
                content = data["content"]
                if isinstance(content, list):
                    local_text = f"[PACK] [{target_str}] 已共享 {label}列表（{len(content)}项）"
                else:
                    local_text = f"[PACK] [{target_str}] 已共享 {label}"
    
            if description:
                local_text += f"\n[MSG] {description[:100]}"
            if payload["tags"]:
                local_text += "\n[TAG] " + " ".join(f"#{t}" for t in payload["tags"][:5])
    
            with self._wan._lock:
                self._wan.messages.append({
                    "type": "message",
                    "peer_id": self._wan.peer_id,
                    "nickname": self._wan.nickname,
                    "text": local_text,
                    "timestamp": datetime.now().strftime("%H:%M:%S"),
                    "direction": "out",
                    "is_system": True,
                })
    
            # 记录到同步项
            self.set_item(
                key=f"push_{data_type}_{int(time.time())}",
                value={"data_type": data_type, "file_name": fn, "target": target_peer_id},
                data_type="sync_log",
            )
    
            return {
                "success": True,
                "message": data.get("message", f"已推送 {data_type} 到房间"),
                "size": len(raw),
            }
        except Exception as e:
            return {"success": False, "error": f"推送失败: {e}"}

    def receive(self, payload: Dict):
        """接收其他节点推送的数据并缓存"""
        data_type = payload.get("data_type", "unknown")
        peer_id = payload.get("peer_id", "")
        file_name = payload.get("file_name", "")
        try:
            safe_name = file_name.replace("/", "_").replace("\\", "_")[:50] if file_name else "default"
            cache_file = os.path.join(self.cache_dir, f"{data_type}_{safe_name}_{peer_id}.json")
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def list_available(self) -> List[Dict]:
        """列出房间内其他节点共享的数据"""
        items = []
        if not os.path.isdir(self.cache_dir):
            return items
        now = time.time()
        for fn in os.listdir(self.cache_dir):
            if not fn.endswith(".json"):
                continue
            try:
                with open(os.path.join(self.cache_dir, fn), "r", encoding="utf-8") as f:
                    d = json.load(f)
                if now - d.get("timestamp", 0) > 3600:
                    continue
                data = d.get("data")
                preview = ""
                if isinstance(data, str):
                    preview = data[:200]
                elif isinstance(data, list):
                    preview = f"{len(data)} 项"
                    if data and isinstance(data[0], dict):
                        preview = json.dumps(data[0], ensure_ascii=False)[:200]
                elif isinstance(data, dict):
                    preview = json.dumps(data, ensure_ascii=False)[:200]
                items.append({
                    "data_type": d.get("data_type"),
                    "peer_id": d.get("peer_id"),
                    "nickname": d.get("nickname", "未知"),
                    "file_name": d.get("file_name", ""),
                    "timestamp": d.get("timestamp"),
                    "time_str": time.strftime("%H:%M:%S", time.localtime(d.get("timestamp", 0))),
                    "preview": preview,
                })
            except Exception:
                pass
        items.sort(key=lambda x: x["timestamp"], reverse=True)
        return items

    def pull(self, data_type: str, peer_id: str, file_name: str = "",
             confirmed: bool = False) -> Dict:
        """拉取指定节点的数据并应用（confirmed=False 时只预览）"""
        cache_file = None
        if file_name:
            safe_name = file_name.replace("/", "_").replace("\\", "_")[:50]
            candidate = os.path.join(self.cache_dir, f"{data_type}_{safe_name}_{peer_id}.json")
            if os.path.isfile(candidate):
                cache_file = candidate
        if cache_file is None:
            for fn in os.listdir(self.cache_dir):
                if fn.startswith(f"{data_type}_") and fn.endswith(f"_{peer_id}.json"):
                    cache_file = os.path.join(self.cache_dir, fn)
                    break
        if cache_file is None or not os.path.isfile(cache_file):
            return {"success": False, "error": "缓存中未找到该数据"}
    
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                payload = json.load(f)
            data = payload.get("data")
    
            changes = self._preview_changes(data_type, data, payload.get("file_name", ""))
    
            if not confirmed:
                return {"success": True, "preview": True, "changes": changes,
                        "message": f"将应用 {len(changes)} 项变更，请确认"}
    
            self._backup_current(data_type, changes)
    
            if data_type == "tool_config":
                result = self._apply_tool_config(data)
            elif data_type == "wordlists":
                result = self._apply_wordlist(data, payload.get("file_name", ""))
            elif data_type == "rules":
                result = self._apply_rule(data, payload.get("file_name", ""))
            elif data_type == "workflows":
                result = self._apply_workflows(data)
            elif data_type == "memory":
                result = self._apply_memory(data)
            else:
                result = {"success": True, "data": data}
    
            result["changes"] = changes
    
            # 记录到同步项
            self.set_item(
                key=f"pull_{data_type}_{int(time.time())}",
                value={"data_type": data_type, "peer_id": peer_id, "file_name": payload.get("file_name", "")},
                data_type="sync_log",
            )
    
            return result
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _preview_changes(self, data_type: str, data, file_name: str) -> List[Dict]:
        """预览拉取会产生的文件变更"""
        changes = []
        if data_type == "wordlists" and isinstance(data, str) and file_name:
            safe_name = os.path.basename(file_name)
            if ".." in safe_name or "/" in safe_name:
                return [{"action": "reject", "path": file_name, "reason": "非法文件名"}]
            fp = os.path.join(self.data_dir, "wordlists", safe_name)
            exists = os.path.isfile(fp)
            changes.append({
                "action": "overwrite" if exists else "create",
                "path": fp, "type": "wordlist",
                "size": len(data.encode('utf-8')),
            })
        elif data_type == "rules" and isinstance(data, str) and file_name:
            safe_name = os.path.basename(file_name)
            if ".." in safe_name or "/" in safe_name:
                return [{"action": "reject", "path": file_name, "reason": "非法文件名"}]
            fp = os.path.join(self.data_dir, "rules", safe_name)
            exists = os.path.isfile(fp)
            changes.append({
                "action": "overwrite" if exists else "create",
                "path": fp, "type": "rule",
                "size": len(data.encode('utf-8')),
            })
        elif data_type == "workflows" and isinstance(data, list):
            wf_dir = os.path.join(self.data_dir, "workflows")
            for wf in data:
                wf_id = wf.get("id", "")
                if wf_id:
                    if ".." in wf_id or "/" in wf_id:
                        changes.append({"action": "reject", "path": wf_id,
                                        "reason": "非法工作流ID"})
                        continue
                    fp = os.path.join(wf_dir, f"{wf_id}.json")
                    exists = os.path.isfile(fp)
                    changes.append({
                        "action": "skip" if exists else "create",
                        "path": fp, "type": "workflow",
                        "name": wf.get("name", wf_id),
                    })
        elif data_type == "tool_config":
            fp = os.path.join(self.data_dir, "config.yaml")
            exists = os.path.isfile(fp)
            content = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
            changes.append({
                "action": "overwrite" if exists else "create",
                "path": fp, "type": "config",
                "size": len(content.encode('utf-8')),
            })
        elif data_type == "memory":
            mem_dir = os.path.join(self.data_dir, "MemorySystem", "记忆河流")
            if isinstance(data, list):
                for mem in data:
                    mem_id = mem.get("memory_id", mem.get("id", ""))
                    if mem_id:
                        fp = os.path.join(mem_dir, f"{mem_id}.json")
                        exists = os.path.isfile(fp)
                        changes.append({
                            "action": "skip" if exists else "create",
                            "path": fp, "type": "memory",
                        })
        return changes

    def _backup_current(self, data_type: str, changes: List[Dict]):
        """应用前备份将被覆盖的文件"""
        backup_dir = os.path.join(self.data_dir, "backup",
                                  f"nodesync_{int(time.time())}")
        os.makedirs(backup_dir, exist_ok=True)
        for ch in changes:
            if ch.get("action") == "overwrite" and os.path.isfile(ch.get("path", "")):
                try:
                    rel = os.path.relpath(ch["path"], self.data_dir)
                    dst = os.path.join(backup_dir, rel)
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copy2(ch["path"], dst)
                except Exception:
                    pass

    def rollback_last(self) -> Dict:
        """回滚最近一次节点同步"""
        backup_base = os.path.join(self.data_dir, "backup")
        if not os.path.isdir(backup_base):
            return {"success": False, "error": "没有备份记录"}
        backups = sorted([d for d in os.listdir(backup_base)
                          if d.startswith("nodesync_")])
        if not backups:
            return {"success": False, "error": "没有备份记录"}
        latest = os.path.join(backup_base, backups[-1])
        restored = 0
        for root, _dirs, files in os.walk(latest):
            for fn in files:
                src = os.path.join(root, fn)
                rel = os.path.relpath(src, latest)
                dst = os.path.join(self.data_dir, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)
                restored += 1
        return {"success": True, "message": f"已回滚 {restored} 个文件",
                "backup": backups[-1]}
