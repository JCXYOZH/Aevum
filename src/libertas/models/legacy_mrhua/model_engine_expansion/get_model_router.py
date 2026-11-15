"""
models/model_engine_expansion.py - 模型引擎综合扩展模块

高级模型管理功能：模型路由调度器、多模型负载均衡、模型健康监控、
模型性能基准测试、模型缓存层、模型请求队列、模型成本追踪器。
"""
import os
import json
import time
import uuid
import math
import hashlib
import threading
import queue
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter
from enum import Enum
from libertas.foundation.terminal import terminal


# ================================================================
# 模型状态
# ================================================================
from .models import *  # noqa: F401,F403
from .model_router import *  # noqa: F401,F403
from .model_health_monitor import *  # noqa: F401,F403
from .model_cost_tracker import *  # noqa: F401,F403

from .model_cost_tracker import (
    _model_router,
    _model_load_balancer,
    _model_health_monitor,
    _model_cache,
    _model_request_queue,
    _model_cost_tracker,
)

_model_benchmark = ModelBenchmark()

def get_model_router() -> ModelRouter:
    return _model_router

def get_model_load_balancer() -> ModelLoadBalancer:
    return _model_load_balancer

def get_model_health_monitor() -> ModelHealthMonitor:
    return _model_health_monitor

def get_model_cache() -> ModelCache:
    return _model_cache

def get_model_request_queue() -> ModelRequestQueue:
    return _model_request_queue

def get_model_cost_tracker() -> ModelCostTracker:
    return _model_cost_tracker

def get_model_benchmark() -> ModelBenchmark:
    return _model_benchmark
