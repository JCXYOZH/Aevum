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


class AgentPhase(Enum):
    """Agent循环阶段"""
    PERCEIVE = "perceive"        # 感知：收集输入和环境信息
    THINK = "think"              # 思考：理解需求，分析问题
    PLAN = "plan"                # 规划：分解任务，制定计划
    DECIDE = "decide"            # 决策：选择下一步行动
    EXECUTE = "execute"          # 执行：调用工具/修改代码/生成内容
    OBSERVE = "observe"          # 观察：收集执行结果
    REFLECT = "reflect"          # 反思：评估结果，总结经验
    LEARN = "learn"              # 学习：更新记忆和策略
    IDLE = "idle"                # 空闲：等待新任务
    PAUSED = "paused"            # 暂停：人工干预中
    ERROR = "error"              # 错误：异常状态
    COMPLETE = "complete"        # 完成：任务完成

class TaskStatus(Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    BLOCKED = "blocked"

class TaskPriority(Enum):
    CRITICAL = 0
    HIGH = 1
    MEDIUM = 2
    LOW = 3

class DecisionStrategy(Enum):
    GREEDY = "greedy"            # 贪心：选当前最优
    EXPLORATORY = "exploratory"  # 探索：尝试新方法
    CONSERVATIVE = "conservative" # 保守：选最稳妥
    AGGRESSIVE = "aggressive"    # 激进：选最快路径
    ADAPTIVE = "adaptive"        # 自适应：根据情况切换

class GoalType(Enum):
    LONG_TERM = "long_term"      # 长期目标
    SHORT_TERM = "short_term"    # 短期目标
    SUB_GOAL = "sub_goal"        # 子目标
    ACTION = "action"            # 具体行动
