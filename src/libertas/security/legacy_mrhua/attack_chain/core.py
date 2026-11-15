"""
security/attack_chain.py - 攻击链编排器

核心能力：
- 串联信息收集→资产发现→漏洞探测→漏洞验证→利用生成→报告生成的完整攻击链路
- 支持多种预设攻击链（Web应用链、网络服务链、代码审计链、综合链）
- 自动根据目标类型选择扫描策略
- 攻击链进度追踪和中间结果保存
- 支持断点续跑
- 与四大能力（记忆/工具/代码/大脑）深度整合
"""
import os
from pathlib import Path
from datetime import datetime, date
import re
import sys
import json
import time
import uuid
import threading
from typing import Any, Dict, List, Optional, Tuple, Callable
from dataclasses import dataclass, field, asdict, is_dataclass
from enum import Enum
from collections import defaultdict


# ================================================================
# 枚举和数据结构
# ================================================================
from .chain_phase import *  # noqa: F401,F403
from .atomic_write_json import *  # noqa: F401,F403

class AttackChainOrchestratorBase:
    """攻击链编排器 - 主类

    整合所有安全模块，执行完整攻击链路。
    与四大能力深度整合：
    - 记忆：扫描结果自动保存到记忆系统，支持历史对比
    - 工具：调用工具库执行信息收集和扫描
    - 代码：静态扫描+漏洞修复代码生成
    - 大脑：根据目标类型自动选择攻击链模板
    """
