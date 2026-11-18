"""任务规划职责：singleton。"""

from __future__ import annotations

import threading
import time
import uuid
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from libertas.foundation.terminal import terminal

from .models import TaskPlan
from .planner import TaskPlanner

def get_task_planner() -> TaskPlanner:
    return _task_planner

def plan_task(goal: str, **kwargs) -> TaskPlan:
    return _task_planner.decompose(goal, **kwargs)
