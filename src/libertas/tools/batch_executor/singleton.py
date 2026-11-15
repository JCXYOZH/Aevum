"""职责模块：singleton。"""

from __future__ import annotations

from typing import Dict, List, Any, Optional, Callable
import threading

from .executor import BatchExecutor
from .models import ToolTask

_batch_executor_instance = None

_batch_executor_lock = threading.Lock()

def get_batch_executor() -> BatchExecutor:
    """获取批量执行器单例"""
    global _batch_executor_instance
    if _batch_executor_instance is None:
        with _batch_executor_lock:
            if _batch_executor_instance is None:
                _batch_executor_instance = BatchExecutor()
    return _batch_executor_instance

def execute_batch(name: str, tasks: List[ToolTask], **kwargs) -> Dict[str, Any]:
    """便捷函数：创建作业并执行"""
    executor = get_batch_executor()
    job_id = executor.create_job(name=name)
    for task in tasks:
        executor.add_task(job_id, task)
    return executor.execute_job(job_id)
