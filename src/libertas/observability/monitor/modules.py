"""监控职责：modules。"""

from __future__ import annotations

import json
import os
import shutil
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from .singleton import get_monitor_manager

class SmartModuleManager:
    """旧版智能模块管理器兼容层"""

    def __init__(self, Libertas_system=None):
        self.system = Libertas_system
        self._module_status = {}
        self._mgr = get_monitor_manager()

    def initialize_module_status(self):
        for name in self._mgr.list_services():
            self._module_status[name] = "healthy"

    def check_module_health(self, name: str) -> str:
        svc = self._mgr.get_service(name)
        if svc:
            return svc.status
        return self._module_status.get(name, "unknown")

    def safe_call_module(self, module_name: str, method_name: str,
                         *args, **kwargs):
        module = getattr(self.system, module_name, None)
        if not module:
            return None
        method = getattr(module, method_name, None)
        if not method:
            return None
        try:
            return method(*args, **kwargs)
        except Exception as e:
            self._module_status[module_name] = "error"
            return None

    def get_module_status(self, module_name: str) -> str:
        return self._module_status.get(module_name, "unknown")

    def get_system_health_report(self) -> Dict:
        return {
            "total_modules": len(self._module_status),
            "healthy": sum(1 for s in self._module_status.values() if s == "healthy"),
            "error": sum(1 for s in self._module_status.values() if s == "error"),
            "modules": self._module_status,
        }
