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


MAX_PUSH_BYTES = 800 * 1024

MAX_FILE_BYTES = 200 * 1024

def _project_root() -> str:
    """获取项目根目录（libertas 包的上一级）"""
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def _resolve_config_paths() -> List[str]:
    """返回可能的 config.yaml 路径列表"""
    paths = []
    paths.append(os.path.join(_project_root(), "..", "config.yaml"))
    paths.append(os.path.join(_project_root(), "config.yaml"))
    paths.append(os.path.join(os.getcwd(), "config.yaml"))
    paths.append(os.path.join(get_data_dir(), "config.yaml"))
    return [os.path.abspath(p) for p in paths]

def _find_wordlist_dirs() -> List[str]:
    """查找所有可能的字典目录"""
    dirs = []
    data_dir = get_data_dir()
    candidates = [
        os.path.join(data_dir, "wordlists"),
        os.path.join(data_dir, "SecLists"),
        os.path.join(_project_root(), "..", "SecLists"),
        os.path.join(_project_root(), "..", "wordlists"),
        os.path.join(os.getcwd(), "SecLists"),
        os.path.join(os.getcwd(), "wordlists"),
        "/usr/share/wordlists",
        "/usr/share/seclists",
    ]
    try:
        import yaml
        for cp in _resolve_config_paths():
            if os.path.isfile(cp):
                with open(cp, "r", encoding="utf-8") as f:
                    cfg = yaml.safe_load(f) or {}
                sp = cfg.get("字典", {}).get("seclists_path", "")
                if sp:
                    sp = os.path.expanduser(sp)
                    if not os.path.isabs(sp):
                        sp = os.path.join(os.path.dirname(cp), sp)
                    candidates.insert(0, sp)
                break
    except Exception:
        pass
    for d in candidates:
        if d and os.path.isdir(d) and d not in dirs:
            dirs.append(os.path.abspath(d))
    return dirs

def _format_size(sz: int) -> str:
    if sz < 1024:
        return f"{sz} B"
    elif sz < 1024 * 1024:
        return f"{sz / 1024:.1f} KB"
    else:
        return f"{sz / (1024 * 1024):.1f} MB"
