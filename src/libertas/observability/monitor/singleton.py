"""监控职责：singleton。"""

from __future__ import annotations

import json
import os
import shutil
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from .manager import MonitorManager

_monitor_manager = MonitorManager()


def get_monitor_manager() -> MonitorManager:
    return _monitor_manager


def monitor_service(name: str, **kwargs):
    return _monitor_manager.register_service(name, **kwargs)
