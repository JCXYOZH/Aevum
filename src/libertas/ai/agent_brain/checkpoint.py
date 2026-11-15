"""
core/agent_brain.py - Agent自主循环大脑

核心能力：七阶段自主循环（感知→思考→规划→决策→执行→观察→反思→学习）、
状态机驱动、任务动态规划、多策略决策、上下文智能裁剪、反思学习闭环、
目标层级管理、注意力聚焦、自我监控、可中断可恢复。
整合记忆库、工具库、代码库三大本地化能力。
"""
import os
import sys
import json
import time
import uuid
import math
import hashlib
import threading
import re
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter, defaultdict
from enum import Enum
from libertas.foundation.terminal import terminal


from .enums import AgentPhase, DecisionStrategy, GoalType, TaskPriority, TaskStatus
from .models import AgentState, CycleRecord, Goal, Task



class CheckpointManager:
    """检查点管理器 - 保存和恢复Agent循环状态，支持断点续跑"""

    def __init__(self, checkpoint_dir: str = "checkpoints"):
        self.checkpoint_dir = checkpoint_dir
        os.makedirs(checkpoint_dir, exist_ok=True)
        self.checkpoints: Dict[str, Dict[str, Any]] = {}

    def save_checkpoint(self, cycle_number: int, state: Dict[str, Any],
                        context: Dict[str, Any] = None,
                        tasks: List[Dict[str, Any]] = None,
                        metadata: Dict[str, Any] = None) -> Dict[str, Any]:
        """保存检查点"""
        checkpoint_id = f"cp_{time.strftime('%Y%m%d_%H%M%S')}_{cycle_number}"
        checkpoint = {
            "checkpoint_id": checkpoint_id,
            "cycle_number": cycle_number,
            "timestamp": time.time(),
            "state": state,
            "context": context or {},
            "tasks": tasks or [],
            "metadata": metadata or {},
        }
        self.checkpoints[checkpoint_id] = checkpoint
        # 保存到磁盘
        path = os.path.join(self.checkpoint_dir, f"{checkpoint_id}.json")
        try:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(checkpoint, f, ensure_ascii=False, indent=2, default=str)
        except Exception as e:
            checkpoint["save_error"] = str(e)
        return {"success": True, "checkpoint_id": checkpoint_id, "cycle_number": cycle_number, "path": path}

    def load_checkpoint(self, checkpoint_id: str) -> Optional[Dict[str, Any]]:
        """加载检查点"""
        # 先从内存找
        if checkpoint_id in self.checkpoints:
            return self.checkpoints[checkpoint_id]
        # 从磁盘加载
        path = os.path.join(self.checkpoint_dir, f"{checkpoint_id}.json")
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    checkpoint = json.load(f)
                self.checkpoints[checkpoint_id] = checkpoint
                return checkpoint
            except Exception:
                return None
        return None

    def get_latest_checkpoint(self) -> Optional[Dict[str, Any]]:
        """获取最新的检查点"""
        if self.checkpoints:
            return max(self.checkpoints.values(), key=lambda x: x.get("timestamp", 0))
        # 从磁盘找最新的
        if os.path.exists(self.checkpoint_dir):
            files = [f for f in os.listdir(self.checkpoint_dir) if f.endswith('.json')]
            if files:
                latest_file = max(files)
                try:
                    with open(os.path.join(self.checkpoint_dir, latest_file), 'r', encoding='utf-8') as f:
                        return json.load(f)
                except Exception:
                    return None
        return None

    def list_checkpoints(self, limit: int = 20) -> List[Dict[str, Any]]:
        """列出所有检查点"""
        all_cps = list(self.checkpoints.values())
        # 也从磁盘扫描
        if os.path.exists(self.checkpoint_dir):
            for f in os.listdir(self.checkpoint_dir):
                if f.endswith('.json'):
                    cp_id = f[:-5]
                    if cp_id not in self.checkpoints:
                        try:
                            with open(os.path.join(self.checkpoint_dir, f), 'r', encoding='utf-8') as fh:
                                cp = json.load(fh)
                            all_cps.append(cp)
                        except Exception:
                            pass
        all_cps.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        return all_cps[:limit]

    def delete_checkpoint(self, checkpoint_id: str) -> Dict[str, Any]:
        """删除检查点"""
        deleted = False
        if checkpoint_id in self.checkpoints:
            del self.checkpoints[checkpoint_id]
            deleted = True
        path = os.path.join(self.checkpoint_dir, f"{checkpoint_id}.json")
        if os.path.exists(path):
            try:
                os.remove(path)
                deleted = True
            except Exception:
                pass
        return {"success": deleted, "checkpoint_id": checkpoint_id}

    def cleanup_old_checkpoints(self, keep_count: int = 10) -> Dict[str, Any]:
        """清理旧检查点，只保留最新的N个"""
        all_cps = self.list_checkpoints(limit=1000)
        if len(all_cps) <= keep_count:
            return {"success": True, "deleted": 0, "remaining": len(all_cps)}
        to_delete = all_cps[keep_count:]
        deleted = 0
        for cp in to_delete:
            cp_id = cp.get("checkpoint_id", "")
            if cp_id:
                result = self.delete_checkpoint(cp_id)
                if result["success"]:
                    deleted += 1
        return {"success": True, "deleted": deleted, "remaining": keep_count}

    def get_stats(self) -> Dict[str, Any]:
        """获取检查点统计"""
        all_cps = self.list_checkpoints(limit=1000)
        total_size = 0
        for cp in all_cps:
            path = os.path.join(self.checkpoint_dir, f"{cp.get('checkpoint_id', '')}.json")
            if os.path.exists(path):
                total_size += os.path.getsize(path)
        return {
            "total_checkpoints": len(all_cps),
            "memory_checkpoints": len(self.checkpoints),
            "total_size_bytes": total_size,
            "total_size_mb": round(total_size / 1024 / 1024, 2),
            "checkpoint_dir": self.checkpoint_dir,
            "latest_cycle": max((cp.get("cycle_number", 0) for cp in all_cps), default=0),
        }
