"""插件扩展基础设施: 插件依赖解析。"""

from __future__ import annotations

import os
import sys
import json
import time
import uuid
import math
import hashlib
import threading
import importlib
import importlib.util
import traceback
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter, defaultdict
from enum import Enum

from libertas.foundation.config import get_data_dir
from libertas.foundation.byte_stream import safe_decode
from libertas.foundation.terminal import terminal

from .manifest import PluginManifest



class PluginDependencyResolver:
    """插件依赖解析器"""

    def __init__(self):
        self.resolver_id = f"dep_{uuid.uuid4().hex[:8]}"
        self.known_plugins: Dict[str, PluginManifest] = {}
        self._lock = threading.RLock()

    def register_plugin(self, manifest: PluginManifest):
        with self._lock:
            self.known_plugins[manifest.plugin_id] = manifest

    def resolve_dependencies(self, plugin_id: str) -> Tuple[List[str], List[str]]:
        """解析依赖，返回 (加载顺序, 缺失依赖)"""
        manifest = self.known_plugins.get(plugin_id)
        if not manifest:
            return [], [plugin_id]

        resolved = []
        missing = []
        visiting = set()

        def resolve(pid: str):
            if pid in resolved:
                return
            if pid in visiting:
                # 循环依赖
                return
            visiting.add(pid)
            m = self.known_plugins.get(pid)
            if not m:
                missing.append(pid)
                visiting.discard(pid)
                return
            for dep in m.dependencies:
                resolve(dep)
            visiting.discard(pid)
            resolved.append(pid)

        resolve(plugin_id)
        return resolved, missing

    def check_conflicts(self, plugin_id: str) -> List[str]:
        """检查版本冲突"""
        conflicts = []
        manifest = self.known_plugins.get(plugin_id)
        if not manifest:
            return conflicts
        # 简化检查：检查是否有多个版本
        for other_id, other in self.known_plugins.items():
            if other_id != plugin_id and other.name == manifest.name:
                if other.version != manifest.version:
                    conflicts.append(
                        f"版本冲突: {other_id} (v{other.version}) vs {plugin_id} (v{manifest.version})"
                    )
        return conflicts

    def get_dependency_graph(self) -> Dict[str, List[str]]:
        graph = {}
        for pid, manifest in self.known_plugins.items():
            graph[pid] = manifest.dependencies
        return graph

    def get_stats(self) -> Dict[str, Any]:
        total_deps = sum(len(m.dependencies) for m in self.known_plugins.values())
        return {
            "resolver_id": self.resolver_id,
            "known_plugins": len(self.known_plugins),
            "total_dependencies": total_deps,
            "avg_dependencies": round(total_deps / max(len(self.known_plugins), 1), 2),
        }
