"""意图路由职责：singleton。"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import uuid
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from libertas.ai.intent_classifier import ClassificationResult, get_intent_classifier
from libertas.foundation.config import get_data_dir

from .core import IntentRouter

def get_intent_router() -> IntentRouter:
    return _intent_router

def route_intent(user_input: str, **kwargs) -> Dict[str, Any]:
    return _intent_router.process(user_input, **kwargs)
