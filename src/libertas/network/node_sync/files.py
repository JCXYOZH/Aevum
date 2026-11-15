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


class NodeSyncFileMixin:
    """可共享文件列表与上传文件落盘。"""

    def list_shareable_files(self, data_type: str) -> List[Dict]:
        """列出可共享的文件（供前端选择）"""
        items = []
        if data_type == "wordlists":
            for d in _find_wordlist_dirs():
                for root, _dirs, files in os.walk(d):
                    for fn in files:
                        fp = os.path.join(root, fn)
                        try:
                            sz = os.path.getsize(fp)
                            items.append({
                                "name": fn,
                                "path": fp,
                                "relative": os.path.relpath(fp, d),
                                "size": sz,
                                "size_str": _format_size(sz),
                                "too_large": sz > MAX_FILE_BYTES,
                            })
                        except Exception:
                            pass
                    if len(items) > 500:
                        break
        elif data_type == "rules":
            rules_dir = os.path.join(self.data_dir, "rules")
            if os.path.isdir(rules_dir):
                for fn in sorted(os.listdir(rules_dir)):
                    fp = os.path.join(rules_dir, fn)
                    if os.path.isfile(fp):
                        try:
                            sz = os.path.getsize(fp)
                            items.append({
                                "name": fn,
                                "path": fp,
                                "relative": fn,
                                "size": sz,
                                "size_str": _format_size(sz),
                                "too_large": sz > MAX_FILE_BYTES,
                            })
                        except Exception:
                            pass
        elif data_type == "tool_config":
            for cp in _resolve_config_paths():
                if os.path.isfile(cp):
                    sz = os.path.getsize(cp)
                    items.append({
                        "name": "config.yaml",
                        "path": cp,
                        "relative": "config.yaml",
                        "size": sz,
                        "size_str": _format_size(sz),
                        "too_large": sz > MAX_FILE_BYTES,
                    })
                    break
        elif data_type == "workflows":
            wf_dir = os.path.join(self.data_dir, "workflows")
            if os.path.isdir(wf_dir):
                for fn in sorted(os.listdir(wf_dir)):
                    if fn.endswith(".json"):
                        fp = os.path.join(wf_dir, fn)
                        try:
                            sz = os.path.getsize(fp)
                            items.append({
                                "name": fn,
                                "path": fp,
                                "relative": fn,
                                "size": sz,
                                "size_str": _format_size(sz),
                                "too_large": sz > MAX_FILE_BYTES,
                            })
                        except Exception:
                            pass
        return items

    def save_uploaded_file(self, data_type: str, filename: str, content: bytes) -> Dict:
        """保存用户上传的文件到对应目录"""
        safe_name = os.path.basename(filename).replace("..", "_")
        if data_type == "wordlists":
            target_dir = os.path.join(self.data_dir, "wordlists")
        elif data_type == "rules":
            target_dir = os.path.join(self.data_dir, "rules")
        elif data_type == "custom_configs":
            target_dir = os.path.join(self.data_dir, "custom_configs")
        else:
            target_dir = os.path.join(self.data_dir, "uploads", data_type)
    
        os.makedirs(target_dir, exist_ok=True)
        fp = os.path.join(target_dir, safe_name)
        try:
            with open(fp, "wb") as f:
                f.write(content)
            return {"success": True, "path": fp, "size": len(content),
                    "name": safe_name}
        except Exception as e:
            return {"success": False, "error": str(e)}
