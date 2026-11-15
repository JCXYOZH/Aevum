"""工作流职责：singleton。"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

from .engine import WorkflowEngine
from .models import WorkflowExecution

def get_workflow_engine() -> WorkflowEngine:
    return _workflow_engine

def execute_workflow(workflow_id: str, **kwargs) -> Optional[WorkflowExecution]:
    return _workflow_engine.execute(workflow_id, **kwargs)
