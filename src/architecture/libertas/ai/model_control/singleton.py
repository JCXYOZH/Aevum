"""
模型控制层

统一管理AI模型的调用、路由、限流、降级、缓存、成本控制、模型切换。
"""
import os
import re
import json
import time
import uuid
import hashlib
import threading
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

from .controller import ModelController
from .models import ModelConfig, ModelRequest, ModelStatus

_model_controller = ModelController()


def get_model_controller() -> ModelController:
    return _model_controller


def generate_model_response(prompt: str, **kwargs) -> Dict[str, Any]:
    return _model_controller.generate(prompt, **kwargs)

# 兼容别名
get_control_layer = get_model_controller
ModelControlLayer = ModelController
