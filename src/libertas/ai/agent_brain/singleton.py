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

from .brain import AgentBrain

def get_agent_brain(project_root: str = "", **kwargs) -> AgentBrain:
    global _agent_brain
    if _agent_brain is None:
        _agent_brain = AgentBrain(project_root, **kwargs)
    return _agent_brain


def init_agent_brain(project_root: str = "", **kwargs) -> AgentBrain:
    global _agent_brain
    _agent_brain = AgentBrain(project_root, **kwargs)
    return _agent_brain
