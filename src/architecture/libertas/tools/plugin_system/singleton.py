"""插件系统职责：singleton。"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
import threading
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from libertas.foundation.config import get_data_dir

from .manager import PluginManager

_plugin_mgr: Optional[PluginManager] = None

_plugin_mgr_lock = threading.Lock()

def get_plugin_manager() -> PluginManager:
    """获取全局PluginManager单例（线程安全）"""
    global _plugin_mgr
    if _plugin_mgr is None:
        with _plugin_mgr_lock:
            if _plugin_mgr is None:
                _plugin_mgr = PluginManager()
                _plugin_mgr.load_all()
    return _plugin_mgr
